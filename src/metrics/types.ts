/**
 * A single parsed Prometheus metric sample.
 * Timestamps present in the exposition format are intentionally omitted;
 * the ingestion service uses wall-clock time between polls instead.
 */
export interface MetricSample {
  metric: string
  labels: Record<string, string>
  value: number
}

/**
 * Derived metrics computed from raw Prometheus samples.
 */
export interface DerivedMetrics {
  /** Requests per second across all traffic */
  requestRate: number
  /** Current event loop lag in seconds */
  eventLoopLag: number
  /** Cache hit ratio (0–1) */
  cacheHitRate: number
  /** Per-query request rate (requests/second) keyed by queryName */
  queries: Record<string, number>
  /** Per-component average latency in seconds keyed by component name */
  components: Record<string, number>
  /** Number of new errors since the last poll */
  errors: number
}
