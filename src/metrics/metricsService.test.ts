import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MetricsService, WARMUP_COUNT } from './metricsService.ts'

const FIRST_POLL = `
graphql_query_counter{queryName="breakingNews"} 1000
graphql_query_counter{queryName="frontPage"} 4000
http_request_duration_seconds_sum{component="BrightcoveApi"} 5.0
http_request_duration_seconds_count{component="BrightcoveApi"} 10
graphql_query_type_cache_counter{cached="hit"} 800
graphql_query_type_cache_counter{cached="miss"} 200
nodejs_eventloop_lag_seconds 0.002
graphql_request_error_total 5
requests_total 10000
`

const SECOND_POLL = `
graphql_query_counter{queryName="breakingNews"} 1100
graphql_query_counter{queryName="frontPage"} 4200
http_request_duration_seconds_sum{component="BrightcoveApi"} 6.0
http_request_duration_seconds_count{component="BrightcoveApi"} 12
graphql_query_type_cache_counter{cached="hit"} 850
graphql_query_type_cache_counter{cached="miss"} 250
nodejs_eventloop_lag_seconds 0.005
graphql_request_error_total 7
requests_total 10500
`

describe('MetricsService.process', () => {
  let svc: MetricsService

  beforeEach(() => {
    svc = new MetricsService('http://localhost:9090/metrics')
  })

  it('returns zero rates on the first poll (no previous snapshot)', () => {
    const result = svc.process(FIRST_POLL, 1000)
    expect(result.requestRate).toBe(0)
    expect(result.queries['breakingNews']).toBe(0)
    expect(result.queries['frontPage']).toBe(0)
    expect(result.errors).toBe(0)
  })

  it('computes requestRate correctly on subsequent polls', () => {
    svc.process(FIRST_POLL, 0)
    // 500 new requests over 10 seconds → 50 req/s
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.requestRate).toBeCloseTo(50)
  })

  it('computes per-query rates correctly', () => {
    svc.process(FIRST_POLL, 0)
    // breakingNews: +100 over 10s → 10/s; frontPage: +200 over 10s → 20/s
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.queries['breakingNews']).toBeCloseTo(10)
    expect(result.queries['frontPage']).toBeCloseTo(20)
  })

  it('computes componentLatency as sum/count', () => {
    svc.process(FIRST_POLL, 0)
    // sum=6.0, count=12 → 0.5s
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.components['BrightcoveApi']).toBeCloseTo(0.5)
  })

  it('computes cacheHitRate from absolute values', () => {
    svc.process(FIRST_POLL, 0)
    // hit=850, miss=250, total=1100 → 850/1100
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.cacheHitRate).toBeCloseTo(850 / 1100)
  })

  it('computes errors as delta of error counter', () => {
    svc.process(FIRST_POLL, 0)
    // error_total went from 5 to 7 → delta 2
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.errors).toBe(2)
  })

  it('reads eventLoopLag directly from the current snapshot', () => {
    const result = svc.process(SECOND_POLL, 10_000)
    expect(result.eventLoopLag).toBeCloseTo(0.005)
  })

  it('returns 0 cacheHitRate when both hit and miss are 0', () => {
    const text = 'requests_total 100\n'
    const result = svc.process(text, 0)
    expect(result.cacheHitRate).toBe(0)
  })

  it('returns 0 componentLatency when count is 0', () => {
    const text =
      'http_request_duration_seconds_sum{component="Api"} 5.0\n' +
      'http_request_duration_seconds_count{component="Api"} 0\n'
    const result = svc.process(text, 0)
    expect(result.components['Api']).toBe(0)
  })

  it('clamps delta to 0 for counter resets', () => {
    svc.process(SECOND_POLL, 0)
    // Feed first poll (lower counter) next → delta should be 0, not negative
    const result = svc.process(FIRST_POLL, 10_000)
    expect(result.requestRate).toBe(0)
    expect(result.errors).toBe(0)
  })
})

describe('MetricsService start/stop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('calls onUpdate after each poll interval', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(FIRST_POLL),
    })
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 5000, 0)
    const onUpdate = vi.fn()
    svc.onUpdate = onUpdate

    svc.start()
    // Flush the initial immediate poll (fire all pending microtasks + timers once)
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).toHaveBeenCalledTimes(1)

    // Advance one interval
    await vi.advanceTimersByTimeAsync(5000)
    expect(onUpdate).toHaveBeenCalledTimes(2)

    svc.stop()
  })

  it('calls onError when fetch fails', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 5000, 0)
    const onError = vi.fn()
    svc.onError = onError

    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))

    svc.stop()
  })

  it('calls onError when the HTTP response is not OK', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    })
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 5000, 0)
    const onError = vi.fn()
    svc.onError = onError

    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))

    svc.stop()
  })

  it('does not start duplicate intervals when start() called twice', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(FIRST_POLL),
    })
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 5000, 0)
    svc.start()
    svc.start() // second call should be a no-op

    // Initial poll fires immediately, then one interval tick
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5000)

    // Only 2 calls: initial poll + one interval tick (not 4)
    expect(mockFetch).toHaveBeenCalledTimes(2)

    svc.stop()
  })
})

describe('MetricsService warm-up', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('polls at 1-second intervals during the warm-up phase', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(FIRST_POLL),
    })
    vi.stubGlobal('fetch', mockFetch)

    // Use a long regular interval and a small warmupCount for a fast test
    const svc = new MetricsService('http://localhost:9090/metrics', 60_000, 3)
    const onUpdate = vi.fn()
    svc.onUpdate = onUpdate

    svc.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onUpdate).toHaveBeenCalledTimes(1) // initial poll

    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(2) // warm-up tick #1

    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(3) // warm-up tick #2

    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(4) // warm-up tick #3 (last)

    // Warm-up complete – next tick is at 60 000 ms, not 1 000 ms
    await vi.advanceTimersByTimeAsync(1000)
    expect(onUpdate).toHaveBeenCalledTimes(4)

    svc.stop()
  })

  it('switches to the configured interval after warm-up completes', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(FIRST_POLL),
    })
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 10_000, 2)
    const onUpdate = vi.fn()
    svc.onUpdate = onUpdate

    svc.start()
    await vi.advanceTimersByTimeAsync(0)    // initial poll
    await vi.advanceTimersByTimeAsync(2000) // 2 warm-up ticks → total 3
    expect(onUpdate).toHaveBeenCalledTimes(3)

    // First regular-interval tick
    await vi.advanceTimersByTimeAsync(10_000)
    expect(onUpdate).toHaveBeenCalledTimes(4)

    svc.stop()
  })

  it('does not start duplicate warm-up intervals when start() called twice', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(FIRST_POLL),
    })
    vi.stubGlobal('fetch', mockFetch)

    const svc = new MetricsService('http://localhost:9090/metrics', 60_000, 3)
    svc.start()
    svc.start() // second call should be a no-op

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3000)

    // Only 4 calls: initial + 3 warm-up ticks (not 8)
    expect(mockFetch).toHaveBeenCalledTimes(4)

    svc.stop()
  })

  it('uses WARMUP_COUNT as the default number of rapid polls', () => {
    expect(WARMUP_COUNT).toBe(60)
  })
})
