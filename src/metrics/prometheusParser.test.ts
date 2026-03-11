import { describe, it, expect } from 'vitest'
import { parsePrometheusText } from './prometheusParser.ts'

const SAMPLE_TEXT = `
# HELP graphql_query_counter Total number of GraphQL queries
# TYPE graphql_query_counter counter
graphql_query_counter{queryName="breakingNews"} 1903
graphql_query_counter{queryName="frontPage"} 5321

http_request_duration_seconds_sum{component="BrightcoveApi"} 5.21
http_request_duration_seconds_count{component="BrightcoveApi"} 18

graphql_query_type_cache_counter{cached="hit"} 8421
graphql_query_type_cache_counter{cached="miss"} 132

nodejs_eventloop_lag_seconds 0.0031
graphql_request_error_total 2
requests_total 15805
`

describe('parsePrometheusText', () => {
  it('ignores comment and blank lines', () => {
    const samples = parsePrometheusText(SAMPLE_TEXT)
    const metrics = samples.map((s) => s.metric)
    expect(metrics).not.toContain('HELP')
    expect(metrics).not.toContain('TYPE')
  })

  it('parses metrics with labels', () => {
    const samples = parsePrometheusText(SAMPLE_TEXT)
    const breakingNews = samples.find(
      (s) =>
        s.metric === 'graphql_query_counter' &&
        s.labels.queryName === 'breakingNews',
    )
    expect(breakingNews).toBeDefined()
    expect(breakingNews?.value).toBe(1903)
    expect(breakingNews?.labels).toEqual({ queryName: 'breakingNews' })
  })

  it('parses metrics without labels', () => {
    const samples = parsePrometheusText(SAMPLE_TEXT)
    const total = samples.find((s) => s.metric === 'requests_total')
    expect(total).toBeDefined()
    expect(total?.value).toBe(15805)
    expect(total?.labels).toEqual({})
  })

  it('parses floating-point values', () => {
    const samples = parsePrometheusText(SAMPLE_TEXT)
    const durationSum = samples.find(
      (s) => s.metric === 'http_request_duration_seconds_sum',
    )
    expect(durationSum?.value).toBeCloseTo(5.21)
  })

  it('parses all expected samples from the example text', () => {
    const samples = parsePrometheusText(SAMPLE_TEXT)
    // 2 query counters + sum + count + 2 cache + eventloop + error + requests_total
    expect(samples).toHaveLength(9)
  })

  it('handles multiple labels', () => {
    const text = 'my_metric{a="1",b="2"} 42\n'
    const [sample] = parsePrometheusText(text)
    expect(sample.labels).toEqual({ a: '1', b: '2' })
    expect(sample.value).toBe(42)
  })

  it('handles escaped quotes in label values', () => {
    const text = 'my_metric{path="/foo\\"bar"} 1\n'
    const [sample] = parsePrometheusText(text)
    expect(sample.labels.path).toBe('/foo"bar')
  })

  it('returns an empty array for empty input', () => {
    expect(parsePrometheusText('')).toEqual([])
  })

  it('skips lines with no space between name and value', () => {
    const text = 'malformed_line\n'
    expect(parsePrometheusText(text)).toHaveLength(0)
  })

  it('skips lines with non-numeric values', () => {
    const text = 'metric_name{} notanumber\n'
    expect(parsePrometheusText(text)).toHaveLength(0)
  })

  it('ignores optional timestamp field', () => {
    const text = 'requests_total 42 1609459200000\n'
    const [sample] = parsePrometheusText(text)
    expect(sample.value).toBe(42)
  })
})
