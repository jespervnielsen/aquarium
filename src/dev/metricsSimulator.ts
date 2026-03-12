/**
 * Local development metrics simulator.
 *
 * Generates realistic Prometheus exposition text matching the format of
 * docs/example-metrics.txt so the aquarium visualisation can run without a
 * real backend `/metrics` endpoint.
 *
 * Call `generateMetricsText()` on each request; the module maintains internal
 * state so counters increase realistically over time.
 *
 * Simulation events (traffic spike, breaking-news spike, dependency slowdown,
 * error spike) fire randomly every few minutes to make the aquarium visually
 * interesting.  They can also be forced via the `options` argument, which is
 * used by the Vite dev-server middleware to honour query-parameter controls
 * from the TestMetricsControls UI.
 */

/** Options for forcing specific simulation events on the next poll. */
export interface SimulatorOptions {
  trafficSpike?: boolean
  breakingNewsSpike?: boolean
  dependencySlowdown?: boolean
  errorSpike?: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1))
}

// ─── metric definitions ────────────────────────────────────────────────────────

/** Histogram bucket upper bounds for http_request_duration_seconds */
const HTTP_BUCKETS = ['0.05', '0.5', '1', '2', '4', '+Inf'] as const

/** Histogram bucket upper bounds for graphql_request_duration_seconds */
const GQL_BUCKETS = ['0.01', '0.05', '0.1', '0.25', '0.5', '1', '2', '+Inf'] as const

/** HTTP components (matching docs/example-metrics.txt) */
const HTTP_COMPONENTS = [
  'ServiceAlpha', 'ServiceBeta', 'ServiceGamma', 'ServiceDelta',
  'ServiceEpsilon', 'ServiceZeta', 'ServiceEta', 'ServiceTheta',
  'ServiceIota', 'ServiceKappa', 'ServiceLambda',
] as const

/**
 * Cumulative distribution function fractions for each component, in
 * HTTP_BUCKETS order.  Derived from the proportions in example-metrics.txt.
 */
const HTTP_CDF: Record<string, readonly number[]> = {
  ServiceAlpha:   [0.084, 0.626, 0.799, 0.943, 1.000, 1.000],
  ServiceBeta:    [0.012, 0.571, 0.795, 0.936, 1.000, 1.000],
  ServiceGamma:   [0.010, 0.537, 0.835, 0.938, 1.000, 1.000],
  ServiceDelta:   [0.062, 0.620, 0.839, 0.934, 1.000, 1.000],
  ServiceEpsilon: [0.000, 0.167, 0.500, 0.667, 1.000, 1.000],
  ServiceZeta:    [0.012, 0.362, 0.598, 0.725, 0.887, 1.000],
  ServiceEta:     [0.398, 0.871, 1.000, 1.000, 1.000, 1.000],
  ServiceTheta:   [0.398, 0.871, 1.000, 1.000, 1.000, 1.000],
  ServiceIota:    [0.000, 0.800, 0.800, 1.000, 1.000, 1.000],
  ServiceKappa:   [0.000, 1.000, 1.000, 1.000, 1.000, 1.000],
  ServiceLambda:  [0.000, 1.000, 1.000, 1.000, 1.000, 1.000],
}

/** Average latency in seconds per component (used to compute histogram sum). */
const HTTP_AVG_S: Record<string, number> = {
  ServiceAlpha:   0.568,
  ServiceBeta:    0.622,
  ServiceGamma:   1.124,
  ServiceDelta:   0.551,
  ServiceEpsilon: 0.740,
  ServiceZeta:    1.013,
  ServiceEta:     0.189,
  ServiceTheta:   0.189,
  ServiceIota:    0.435,
  ServiceKappa:   0.176,
  ServiceLambda:  0.201,
}

/** Services affected by the dependency-slowdown simulation event. */
const SLOWDOWN_SERVICES = new Set(['ServiceAlpha', 'ServiceBeta', 'ServiceGamma', 'ServiceZeta'])

/** CDF used for affected services during a dependency-slowdown event. */
const HTTP_CDF_SLOWDOWN: readonly number[] = [0.000, 0.050, 0.350, 0.700, 0.950, 1.000]

/** GraphQL operation names (matching docs/example-metrics.txt) */
const GQL_OPERATIONS = ['BreakingNews', 'QueryA'] as const

/**
 * CDF fractions per operation for graphql_request_duration_seconds,
 * in GQL_BUCKETS order.
 */
const GQL_CDF: Record<string, readonly number[]> = {
  BreakingNews: [0.000, 0.000, 0.000, 0.997, 1.000, 1.000, 1.000, 1.000],
  QueryA:       [0.000, 0.000, 0.989, 1.000, 1.000, 1.000, 1.000, 1.000],
}

/** Average GraphQL request duration in seconds per operation. */
const GQL_AVG_S: Record<string, number> = {
  BreakingNews: 0.221,
  QueryA:       0.147,
}

/** Cache entries modelled by graphql_query_type_cache_counter. */
const CACHE_ENTRIES: ReadonlyArray<{ operationName: string; clientID: string }> = [
  { operationName: 'BreakingNews', clientID: 'clientA' },
  { operationName: 'QueryA',       clientID: 'clientA' },
  { operationName: 'QueryB',       clientID: 'clientC' },
]

/** Query names for graphql_query_counter (matching docs/example-metrics.txt). */
const QUERY_NAMES = [
  'breakingNews', 'queryAlpha', 'queryBeta', 'queryGamma',
  'queryDelta', 'queryEpsilon', 'queryZeta', 'queryEta',
  'queryTheta', 'queryIota', 'queryKappa', 'queryLambda',
  'queryMu', 'queryNu', 'queryXi', 'queryOmicron', 'queryPi', 'queryRho',
] as const

/**
 * Traffic distribution across query names (fractions, must sum to 1.0).
 * Derived from the ratios in docs/example-metrics.txt.
 */
const QUERY_DIST: Record<string, number> = {
  breakingNews:  0.280,
  queryAlpha:    0.180,
  queryBeta:     0.070,
  queryGamma:    0.065,
  queryDelta:    0.095,
  queryEpsilon:  0.100,
  queryZeta:     0.040,
  queryEta:      0.020,
  queryTheta:    0.020,
  queryIota:     0.020,
  queryKappa:    0.020,
  queryLambda:   0.015,
  queryMu:       0.015,
  queryNu:       0.010,
  queryXi:       0.010,
  queryOmicron:  0.010,
  queryPi:       0.015,
  queryRho:      0.015,
}

// ─── state types ──────────────────────────────────────────────────────────────

interface HistogramCounter {
  /** Cumulative bucket counts, parallel with the corresponding BUCKETS array. */
  buckets: number[]
  sum: number
  count: number
}

interface ContainerState {
  /** http_request_duration_seconds histograms keyed by component name. */
  httpDuration: Record<string, HistogramCounter>
  /** graphql_request_duration_seconds histograms keyed by operationName. */
  gqlDuration: Record<string, HistogramCounter>
  /** Cache hit counts keyed by "${operationName}:${clientID}". */
  cacheHits: Record<string, number>
  /** Cache miss counts keyed by "${operationName}:${clientID}". */
  cacheMisses: Record<string, number>
  /** graphql_query_counter values keyed by queryName. */
  queryCounters: Record<string, number>
  /** graphql_request_error_total cumulative counter. */
  errorCounter: number
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
  errorSpike: ActiveEvent
  lastEventCheck: number
}

// ─── histogram helpers ─────────────────────────────────────────────────────────

/**
 * Creates a new HistogramCounter with the given initial count, deriving
 * cumulative bucket counts from the supplied CDF fractions.
 */
function createHistogram(
  cdf: readonly number[],
  avgS: number,
  initCount: number,
): HistogramCounter {
  const buckets = cdf.map((f) => Math.floor(f * initCount))
  // +Inf bucket must always equal the total count.
  buckets[buckets.length - 1] = initCount
  // Enforce monotonicity after rounding.
  for (let i = buckets.length - 2; i >= 0; i--) {
    if (buckets[i] > buckets[i + 1]) buckets[i] = buckets[i + 1]
  }
  return {
    buckets,
    sum: initCount * avgS * (0.8 + Math.random() * 0.4),
    count: initCount,
  }
}

/**
 * Adds `newCount` new observations to a histogram using the supplied CDF
 * fractions to distribute them across buckets.  The +Inf bucket is always
 * kept equal to the total count and monotonicity is enforced.
 */
function addToHistogram(
  h: HistogramCounter,
  newCount: number,
  cdf: readonly number[],
  avgS: number,
): void {
  for (let i = 0; i < cdf.length; i++) {
    h.buckets[i] += Math.round(newCount * cdf[i])
  }
  h.count += newCount
  // +Inf bucket always equals total count.
  h.buckets[cdf.length - 1] = h.count
  // Enforce monotonicity.
  for (let i = cdf.length - 2; i >= 0; i--) {
    if (h.buckets[i] > h.buckets[i + 1]) h.buckets[i] = h.buckets[i + 1]
  }
  h.sum += newCount * avgS * (0.8 + Math.random() * 0.4)
}

// ─── state initialisation ─────────────────────────────────────────────────────

function createContainer(): ContainerState {
  const httpDuration: Record<string, HistogramCounter> = {}
  for (const comp of HTTP_COMPONENTS) {
    httpDuration[comp] = createHistogram(HTTP_CDF[comp], HTTP_AVG_S[comp], randInt(10, 5_000))
  }

  const gqlDuration: Record<string, HistogramCounter> = {}
  for (const op of GQL_OPERATIONS) {
    gqlDuration[op] = createHistogram(GQL_CDF[op], GQL_AVG_S[op], randInt(10, 500))
  }

  const cacheHits: Record<string, number> = {}
  const cacheMisses: Record<string, number> = {}
  for (const { operationName, clientID } of CACHE_ENTRIES) {
    const key = `${operationName}:${clientID}`
    cacheHits[key] = randInt(500, 20_000)
    cacheMisses[key] = randInt(10, 700)
  }

  const queryCounters: Record<string, number> = {}
  for (const name of QUERY_NAMES) {
    queryCounters[name] = Math.max(1, Math.round(randInt(1, 20_000) * QUERY_DIST[name]))
  }

  return { httpDuration, gqlDuration, cacheHits, cacheMisses, queryCounters, errorCounter: 0 }
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
    errorSpike: { ...inactive },
    lastEventCheck: Date.now(),
  }
}

const state: SimulatorState = initState()

// ─── simulation event logic ────────────────────────────────────────────────────

function maybeFireEvents(now: number, forced?: SimulatorOptions): void {
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
  if (state.errorSpike.active && now > state.errorSpike.endsAt) {
    state.errorSpike.active = false
  }

  // Forced events stay active for the duration of the next poll window.
  const forcedDuration = 60_000
  if (forced?.trafficSpike) {
    state.trafficSpike = { active: true, endsAt: now + forcedDuration }
  }
  if (forced?.breakingNewsSpike) {
    state.breakingNewsSpike = { active: true, endsAt: now + forcedDuration }
  }
  if (forced?.dependencySlowdown) {
    state.dependencySlowdown = { active: true, endsAt: now + forcedDuration }
  }
  if (forced?.errorSpike) {
    state.errorSpike = { active: true, endsAt: now + forcedDuration }
  }

  // Randomly start new events (~one per event type per 3 minutes on average).
  const prob = elapsed / (3 * 60 * 1_000)
  if (!state.trafficSpike.active && Math.random() < prob) {
    state.trafficSpike = { active: true, endsAt: now + 10_000 }
  }
  if (!state.breakingNewsSpike.active && Math.random() < prob) {
    state.breakingNewsSpike = { active: true, endsAt: now + 15_000 }
  }
  if (!state.dependencySlowdown.active && Math.random() < prob) {
    state.dependencySlowdown = { active: true, endsAt: now + 15_000 }
  }
  if (!state.errorSpike.active && Math.random() < prob) {
    state.errorSpike = { active: true, endsAt: now + 15_000 }
  }
}

// ─── per-poll container update ────────────────────────────────────────────────

function updateContainer(container: ContainerState): void {
  const trafficMultiplier = state.trafficSpike.active ? 5 : 1
  const newRequests = randInt(5, 30) * trafficMultiplier

  // HTTP duration histograms — each component receives a few new observations.
  for (const comp of HTTP_COMPONENTS) {
    const isSlowed = state.dependencySlowdown.active && SLOWDOWN_SERVICES.has(comp)
    const cdf = isSlowed ? HTTP_CDF_SLOWDOWN : HTTP_CDF[comp]
    const avgS = isSlowed ? 0.9 : HTTP_AVG_S[comp]
    addToHistogram(container.httpDuration[comp], randInt(1, 8) * trafficMultiplier, cdf, avgS)
  }

  // GraphQL request duration histograms.
  for (const op of GQL_OPERATIONS) {
    const breakingMult = state.breakingNewsSpike.active && op === 'BreakingNews' ? 5 : 1
    addToHistogram(
      container.gqlDuration[op],
      randInt(1, 5) * trafficMultiplier * breakingMult,
      GQL_CDF[op],
      GQL_AVG_S[op],
    )
  }

  // Cache hits/misses (~95 % hit rate).
  for (const { operationName, clientID } of CACHE_ENTRIES) {
    const key = `${operationName}:${clientID}`
    const breakingMult =
      state.breakingNewsSpike.active && operationName === 'BreakingNews' ? 3 : 1
    container.cacheHits[key] += randInt(30, 80) * trafficMultiplier * breakingMult
    container.cacheMisses[key] += randInt(1, 4) * trafficMultiplier
  }

  // Query counters — distributed according to QUERY_DIST.
  for (const name of QUERY_NAMES) {
    const breakingMult =
      state.breakingNewsSpike.active && name === 'breakingNews' ? 5 : 1
    container.queryCounters[name] += Math.max(
      1,
      Math.round(newRequests * QUERY_DIST[name] * breakingMult),
    )
  }

  // Error counter — low normally, elevated during error spike.
  const errorIncrement = state.errorSpike.active ? randInt(5, 20) : randInt(0, 1)
  container.errorCounter += errorIncrement
}

// ─── Prometheus text generation ───────────────────────────────────────────────

/**
 * Returns a Prometheus exposition text string for one randomly chosen
 * simulated container.  Internal state is updated on every call so
 * counters grow over time, matching the format of docs/example-metrics.txt.
 *
 * @param options - Optional scenario overrides.  When a field is `true` the
 *   corresponding event is forced active for the next poll window, regardless
 *   of the normal random-fire logic.
 */
export function generateMetricsText(options?: SimulatorOptions): string {
  const now = Date.now()
  maybeFireEvents(now, options)

  // Mimic a load balancer: pick a random container for this request.
  const container =
    state.containers[Math.floor(Math.random() * state.containers.length)]
  updateContainer(container)

  const lines: string[] = []

  // ── http_request_duration_seconds ─────────────────────────────────────────
  lines.push('# HELP http_request_duration_seconds Outgoing http duration histogram')
  lines.push('# TYPE http_request_duration_seconds histogram')
  for (const comp of HTTP_COMPONENTS) {
    const h = container.httpDuration[comp]
    for (let i = 0; i < HTTP_BUCKETS.length; i++) {
      lines.push(
        `http_request_duration_seconds_bucket{le="${HTTP_BUCKETS[i]}",component="${comp}",status="200"} ${h.buckets[i]}`,
      )
    }
    lines.push(
      `http_request_duration_seconds_sum{component="${comp}",status="200"} ${h.sum.toFixed(6)}`,
    )
    lines.push(
      `http_request_duration_seconds_count{component="${comp}",status="200"} ${h.count}`,
    )
    lines.push('')
  }

  // ── graphql_request_duration_seconds ──────────────────────────────────────
  lines.push('# HELP graphql_request_duration_seconds GraphQL request duration histogram')
  lines.push('# TYPE graphql_request_duration_seconds histogram')
  for (const op of GQL_OPERATIONS) {
    const h = container.gqlDuration[op]
    for (let i = 0; i < GQL_BUCKETS.length; i++) {
      lines.push(
        `graphql_request_duration_seconds_bucket{le="${GQL_BUCKETS[i]}",operationName="${op}"} ${h.buckets[i]}`,
      )
    }
    lines.push(`graphql_request_duration_seconds_sum{operationName="${op}"} ${h.sum.toFixed(6)}`)
    lines.push(`graphql_request_duration_seconds_count{operationName="${op}"} ${h.count}`)
    lines.push('')
  }

  // ── graphql_query_type_cache_counter ──────────────────────────────────────
  lines.push('# HELP graphql_query_type_cache_counter Number of cache hits/misses')
  lines.push('# TYPE graphql_query_type_cache_counter counter')
  for (const { operationName, clientID } of CACHE_ENTRIES) {
    const key = `${operationName}:${clientID}`
    lines.push(
      `graphql_query_type_cache_counter{operationName="${operationName}",clientID="${clientID}",cached="hit"} ${container.cacheHits[key]}`,
    )
    lines.push(
      `graphql_query_type_cache_counter{operationName="${operationName}",clientID="${clientID}",cached="miss"} ${container.cacheMisses[key]}`,
    )
    lines.push('')
  }

  // ── graphql_query_counter ─────────────────────────────────────────────────
  lines.push('# HELP graphql_query_counter Number of individual queries executed')
  lines.push('# TYPE graphql_query_counter counter')
  for (const name of QUERY_NAMES) {
    lines.push(`graphql_query_counter{queryName="${name}"} ${container.queryCounters[name]}`)
  }

  // ── graphql_request_error_total ───────────────────────────────────────────
  lines.push('')
  lines.push('# HELP graphql_request_error_total Total number of GraphQL request errors')
  lines.push('# TYPE graphql_request_error_total counter')
  lines.push(`graphql_request_error_total ${container.errorCounter}`)

  return lines.join('\n') + '\n'
}

