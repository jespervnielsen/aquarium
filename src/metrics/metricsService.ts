import type { MetricSample, DerivedMetrics } from './types.ts'
import { parsePrometheusText } from './prometheusParser.ts'

/** Internal snapshot used to compute deltas between polls */
interface PollSnapshot {
  timestamp: number
  /** Map of "metricName{label=value,...}" → raw value */
  values: Map<string, number>
}

const WARMUP_INTERVAL_MS = 1_000
/** Number of rapid 1-second polls performed on start before switching to the configured interval. */
export const WARMUP_COUNT = 60

/**
 * Builds a stable string key for a MetricSample so it can be looked up
 * across consecutive polls.
 */
function sampleKey(sample: MetricSample): string {
  const labelPart = Object.entries(sample.labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
  return labelPart ? `${sample.metric}{${labelPart}}` : sample.metric
}

/**
 * Converts a raw MetricSample array into a lookup map keyed by sampleKey.
 */
function buildSnapshotValues(samples: MetricSample[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const sample of samples) {
    map.set(sampleKey(sample), sample.value)
  }
  return map
}

/**
 * MetricsService polls a Prometheus `/metrics` endpoint, parses the
 * response, and computes derived application metrics.
 *
 * Usage:
 *   const svc = new MetricsService('http://localhost:9090/metrics')
 *   svc.onUpdate = (metrics) => console.log(metrics)
 *   svc.start()
 *   // later:
 *   svc.stop()
 */
export class MetricsService {
  private readonly url: string
  private readonly intervalMs: number
  private readonly warmupCount: number
  private previousSnapshot: PollSnapshot | null = null
  private timerId: ReturnType<typeof setInterval> | null = null
  private warmupTimerId: ReturnType<typeof setInterval> | null = null

  /** Callback invoked after each successful poll with the derived metrics */
  onUpdate: ((metrics: DerivedMetrics) => void) | null = null

  /** Callback invoked when a poll fails */
  onError: ((error: unknown) => void) | null = null

  /**
   * @param url - The Prometheus `/metrics` endpoint URL to poll.
   * @param intervalMs - Polling interval in milliseconds (default: 5000).
   * @param warmupCount - Number of rapid 1-second polls on start before switching to intervalMs (default: 60).
   */
  constructor(url: string, intervalMs = 5000, warmupCount = WARMUP_COUNT) {
    this.url = url
    this.intervalMs = intervalMs
    this.warmupCount = warmupCount
  }

  /** Start polling the metrics endpoint. */
  start(): void {
    if (this.timerId !== null || this.warmupTimerId !== null) return
    void this.poll()
    if (this.warmupCount > 0) {
      let warmupRemaining = this.warmupCount
      const warmupId = setInterval(() => {
        void this.poll()
        warmupRemaining--
        if (warmupRemaining <= 0) {
          clearInterval(warmupId)
          this.warmupTimerId = null
          this.timerId = setInterval(() => void this.poll(), this.intervalMs)
        }
      }, WARMUP_INTERVAL_MS)
      this.warmupTimerId = warmupId
    } else {
      this.timerId = setInterval(() => void this.poll(), this.intervalMs)
    }
  }

  /** Stop polling. */
  stop(): void {
    if (this.warmupTimerId !== null) {
      clearInterval(this.warmupTimerId)
      this.warmupTimerId = null
    }
    if (this.timerId !== null) {
      clearInterval(this.timerId)
      this.timerId = null
    }
  }

  /** Exposed for testing – processes raw Prometheus text directly. */
  process(text: string, now = Date.now()): DerivedMetrics {
    const samples = parsePrometheusText(text)
    const values = buildSnapshotValues(samples)

    const current: PollSnapshot = { timestamp: now, values }
    const derived = this.computeDerivedMetrics(samples, current)
    this.previousSnapshot = current
    return derived
  }

  private async poll(): Promise<void> {
    try {
      const response = await fetch(this.url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }
      const text = await response.text()
      const derived = this.process(text)
      this.onUpdate?.(derived)
    } catch (err) {
      this.onError?.(err)
    }
  }

  private computeDerivedMetrics(
    samples: MetricSample[],
    current: PollSnapshot,
  ): DerivedMetrics {
    const prev = this.previousSnapshot
    const elapsedSeconds =
      prev !== null ? (current.timestamp - prev.timestamp) / 1000 : null

    // ── helpers ────────────────────────────────────────────────────────────

    const getValue = (key: string): number => current.values.get(key) ?? 0

    const delta = (key: string): number => {
      if (prev === null) return 0
      const cur = current.values.get(key) ?? 0
      const old = prev.values.get(key) ?? 0
      return Math.max(0, cur - old)
    }

    const rate = (key: string): number => {
      if (elapsedSeconds === null || elapsedSeconds <= 0) return 0
      return delta(key) / elapsedSeconds
    }

    // ── requestRate ────────────────────────────────────────────────────────
    const requestRate = rate('requests_total')

    // ── eventLoopLag ───────────────────────────────────────────────────────
    const eventLoopLag = getValue('nodejs_eventloop_lag_seconds')

    // ── cacheHitRate ───────────────────────────────────────────────────────
    const cacheHits = getValue('graphql_query_type_cache_counter{cached="hit"}')
    const cacheMisses = getValue(
      'graphql_query_type_cache_counter{cached="miss"}',
    )
    const cacheTotal = cacheHits + cacheMisses
    const cacheHitRate = cacheTotal > 0 ? cacheHits / cacheTotal : 0

    // ── queryRate ──────────────────────────────────────────────────────────
    const queries: Record<string, number> = {}
    for (const sample of samples) {
      if (sample.metric === 'graphql_query_counter' && sample.labels.queryName) {
        const key = sampleKey(sample)
        queries[sample.labels.queryName] = rate(key)
      }
    }

    // ── componentLatency ───────────────────────────────────────────────────
    const components: Record<string, number> = {}
    for (const sample of samples) {
      if (
        sample.metric === 'http_request_duration_seconds_sum' &&
        sample.labels.component
      ) {
        const componentName = sample.labels.component
        const sumKey = sampleKey(sample)
        const countKey = sampleKey({
          metric: 'http_request_duration_seconds_count',
          labels: sample.labels,
          value: 0,
        })
        const sumValue = getValue(sumKey)
        const countValue = getValue(countKey)
        components[componentName] =
          countValue > 0 ? sumValue / countValue : 0
      }
    }

    // ── errorRate ──────────────────────────────────────────────────────────
    const errors = delta('graphql_request_error_total')

    return {
      requestRate,
      eventLoopLag,
      cacheHitRate,
      queries,
      components,
      errors,
    }
  }
}
