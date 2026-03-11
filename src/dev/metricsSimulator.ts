/**
 * Local development metrics simulator.
 *
 * Generates realistic Prometheus exposition text so the aquarium
 * visualisation can run without a real backend `/metrics` endpoint.
 * Call `generateMetricsText()` on each request; the module maintains
 * internal state so counters increase realistically over time.
 *
 * Simulation events (traffic spike, breaking-news spike, dependency
 * slowdown) fire randomly every few minutes to keep the aquarium
 * visually interesting.
 */

// ─── helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1))
}

// ─── types ────────────────────────────────────────────────────────────────────

interface ComponentCounters {
  sum: number
  count: number
}

interface ContainerState {
  startTime: number
  cpuSeconds: number
  requestsTotal: number
  queries: Record<string, number>
  cacheHits: number
  cacheMisses: number
  errorTotal: number
  components: Record<string, ComponentCounters>
  eventLoopLag: number
  residentMemory: number
}

interface ActiveEvent {
  active: boolean
  endsAt: number
}

interface SimulatorState {
  containers: ContainerState[]
  trafficSpike: ActiveEvent
  breakingNewsSpike: ActiveEvent
  dependencySlowdown: ActiveEvent
  lastEventCheck: number
}

// ─── state initialisation ─────────────────────────────────────────────────────

function createContainer(): ContainerState {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    startTime: nowSec - randInt(60, 86_400),
    cpuSeconds: rand(5, 50),
    requestsTotal: randInt(1_000, 20_000),
    queries: {
      breakingNews: randInt(100, 2_000),
      frontPage: randInt(200, 5_000),
      article: randInt(50, 1_000),
      liveBlog: randInt(20, 300),
    },
    cacheHits: randInt(5_000, 10_000),
    cacheMisses: randInt(50, 200),
    errorTotal: randInt(0, 5),
    components: {
      BrightcoveApi: { sum: rand(2, 10), count: randInt(10, 30) },
      MetadataApi: { sum: rand(1, 5), count: randInt(5, 20) },
      Redis: { sum: rand(0.1, 0.5), count: randInt(20, 60) },
    },
    eventLoopLag: rand(0.002, 0.005),
    residentMemory: randInt(50, 120) * 1_024 * 1_024,
  }
}

function initState(): SimulatorState {
  const containerCount = randInt(10, 20)
  const containers: ContainerState[] = []
  for (let i = 0; i < containerCount; i++) {
    containers.push(createContainer())
  }
  const inactive: ActiveEvent = { active: false, endsAt: 0 }
  return {
    containers,
    trafficSpike: { ...inactive },
    breakingNewsSpike: { ...inactive },
    dependencySlowdown: { ...inactive },
    lastEventCheck: Date.now(),
  }
}

const state: SimulatorState = initState()

// ─── simulation event logic ────────────────────────────────────────────────────

function maybeFireEvents(now: number): void {
  const elapsed = now - state.lastEventCheck
  state.lastEventCheck = now

  // Expire ended events.
  if (state.trafficSpike.active && now > state.trafficSpike.endsAt) {
    state.trafficSpike.active = false
  }
  if (state.breakingNewsSpike.active && now > state.breakingNewsSpike.endsAt) {
    state.breakingNewsSpike.active = false
  }
  if (state.dependencySlowdown.active && now > state.dependencySlowdown.endsAt) {
    state.dependencySlowdown.active = false
  }

  // Randomly start new events — roughly one event type per ~3 minutes on average.
  const prob = elapsed / (3 * 60 * 1_000)

  if (!state.trafficSpike.active && Math.random() < prob) {
    // Traffic spike lasts ~10 seconds.
    state.trafficSpike = { active: true, endsAt: now + 10_000 }
  }
  if (!state.breakingNewsSpike.active && Math.random() < prob) {
    // Breaking-news spike lasts ~15 seconds.
    state.breakingNewsSpike = { active: true, endsAt: now + 15_000 }
  }
  if (!state.dependencySlowdown.active && Math.random() < prob) {
    // Dependency slowdown lasts ~15 seconds.
    state.dependencySlowdown = { active: true, endsAt: now + 15_000 }
  }
}

// ─── per-poll container update ────────────────────────────────────────────────

function updateContainer(container: ContainerState): void {
  const trafficMultiplier = state.trafficSpike.active ? 5 : 1
  const newRequests = randInt(20, 80) * trafficMultiplier

  // Monotonically increasing counters.
  container.requestsTotal += newRequests
  container.cpuSeconds += rand(0.1, 0.5) * trafficMultiplier

  // Query distribution: breakingNews 30%, frontPage 40%, article 20%, liveBlog 10%.
  const breakingMultiplier = state.breakingNewsSpike.active ? 5 : 1
  container.queries['breakingNews'] += Math.round(newRequests * 0.3 * breakingMultiplier)
  container.queries['frontPage'] += Math.round(newRequests * 0.4)
  container.queries['article'] += Math.round(newRequests * 0.2)
  container.queries['liveBlog'] += Math.round(newRequests * 0.1)

  // Cache — ~95 % hit rate.
  container.cacheHits += randInt(80, 120)
  container.cacheMisses += randInt(1, 5)

  // Component latencies.
  const brightcoveAvgMs = state.dependencySlowdown.active ? 800 : rand(100, 300)
  const bcCount = randInt(5, 15)
  container.components['BrightcoveApi'].count += bcCount
  container.components['BrightcoveApi'].sum += (brightcoveAvgMs / 1_000) * bcCount

  const metaCount = randInt(3, 10)
  container.components['MetadataApi'].count += metaCount
  container.components['MetadataApi'].sum += rand(0.05, 0.15) * metaCount

  const redisCount = randInt(10, 30)
  container.components['Redis'].count += redisCount
  container.components['Redis'].sum += rand(0.005, 0.02) * redisCount

  // Errors: ~1 every 30–60 s (assuming ~10 s polling → ~15–20 % chance per poll).
  if (Math.random() < 0.15) {
    container.errorTotal += 1
  }

  // Event-loop lag: normally 2–5 ms, occasionally 20–40 ms spike.
  container.eventLoopLag =
    Math.random() < 0.05 ? rand(0.02, 0.04) : rand(0.002, 0.005)

  // Resident memory fluctuates slightly.
  container.residentMemory = randInt(50, 120) * 1_024 * 1_024
}

// ─── Prometheus text generation ───────────────────────────────────────────────

/**
 * Returns a Prometheus exposition text string for one randomly chosen
 * simulated container.  Internal state is updated on every call so
 * counters grow over time.
 */
export function generateMetricsText(): string {
  const now = Date.now()
  maybeFireEvents(now)

  // Mimic a load balancer: pick a random container for this request.
  const container =
    state.containers[Math.floor(Math.random() * state.containers.length)]
  updateContainer(container)

  const lines: string[] = []

  lines.push(`process_cpu_seconds_total ${container.cpuSeconds.toFixed(3)}`)
  lines.push(`process_start_time_seconds ${container.startTime}`)
  lines.push('')
  lines.push(`nodejs_eventloop_lag_seconds ${container.eventLoopLag.toFixed(6)}`)
  lines.push(`process_resident_memory_bytes ${container.residentMemory}`)
  lines.push('')
  lines.push(`requests_total ${container.requestsTotal}`)
  lines.push('')

  for (const [queryName, count] of Object.entries(container.queries)) {
    lines.push(`graphql_query_counter{queryName="${queryName}"} ${count}`)
  }
  lines.push('')

  lines.push(`graphql_query_type_cache_counter{cached="hit"} ${container.cacheHits}`)
  lines.push(`graphql_query_type_cache_counter{cached="miss"} ${container.cacheMisses}`)
  lines.push('')

  lines.push(`graphql_request_error_total ${container.errorTotal}`)
  lines.push('')

  for (const [component, c] of Object.entries(container.components)) {
    lines.push(
      `http_request_duration_seconds_sum{component="${component}"} ${c.sum.toFixed(3)}`,
    )
    lines.push(
      `http_request_duration_seconds_count{component="${component}"} ${c.count}`,
    )
  }

  return lines.join('\n') + '\n'
}
