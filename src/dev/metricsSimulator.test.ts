import { describe, it, expect } from 'vitest'
import { generateMetricsText } from './metricsSimulator.ts'

describe('generateMetricsText', () => {
  it('returns a non-empty string', () => {
    const text = generateMetricsText()
    expect(text.length).toBeGreaterThan(0)
  })

  it('includes all required metric names', () => {
    const text = generateMetricsText()

    const required = [
      'process_cpu_seconds_total',
      'process_start_time_seconds',
      'nodejs_eventloop_lag_seconds',
      'process_resident_memory_bytes',
      'requests_total',
      'graphql_query_counter{queryName="breakingNews"}',
      'graphql_query_counter{queryName="frontPage"}',
      'graphql_query_counter{queryName="article"}',
      'graphql_query_counter{queryName="liveBlog"}',
      'graphql_query_type_cache_counter{cached="hit"}',
      'graphql_query_type_cache_counter{cached="miss"}',
      'graphql_request_error_total',
      'http_request_duration_seconds_sum{component="BrightcoveApi"}',
      'http_request_duration_seconds_count{component="BrightcoveApi"}',
      'http_request_duration_seconds_sum{component="MetadataApi"}',
      'http_request_duration_seconds_count{component="MetadataApi"}',
      'http_request_duration_seconds_sum{component="Redis"}',
      'http_request_duration_seconds_count{component="Redis"}',
    ]

    for (const name of required) {
      expect(text, `missing metric: ${name}`).toContain(name)
    }
  })

  it('produces lines of the form "metric_name[{labels}] <number>"', () => {
    const text = generateMetricsText()
    const metricLine = /^[\w_]+(\{[^}]+\})? \d+(\.\d+)?$/
    const dataLines = text
      .split('\n')
      .filter((line) => line.trim().length > 0)

    for (const line of dataLines) {
      expect(line, `unexpected line format: "${line}"`).toMatch(metricLine)
    }
  })

  it('returns positive requests_total values across consecutive calls', () => {
    const extract = (text: string, metric: string) => {
      const match = new RegExp(`^${metric} (\\d+)`, 'm').exec(text)
      return match ? Number(match[1]) : null
    }

    const first = extract(generateMetricsText(), 'requests_total')
    const second = extract(generateMetricsText(), 'requests_total')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first!).toBeGreaterThan(0)
    expect(second!).toBeGreaterThan(0)
  })

  it('cache hit counter is greater than cache miss counter', () => {
    // Due to ~95% hit rate the running totals always keep hits > misses.
    const text = generateMetricsText()
    const hits = Number(/graphql_query_type_cache_counter\{cached="hit"\} (\d+)/.exec(text)?.[1])
    const misses = Number(/graphql_query_type_cache_counter\{cached="miss"\} (\d+)/.exec(text)?.[1])
    expect(hits).toBeGreaterThan(misses)
  })
})
