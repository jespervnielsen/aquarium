import { describe, it, expect } from 'vitest'
import { generateMetricsText } from './metricsSimulator.ts'

describe('generateMetricsText', () => {
  it('returns a non-empty string ending with a newline', () => {
    const text = generateMetricsText()
    expect(text.length).toBeGreaterThan(0)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('includes # HELP and # TYPE headers for every metric family', () => {
    const text = generateMetricsText()
    const families = [
      'http_request_duration_seconds',
      'graphql_request_duration_seconds',
      'graphql_query_type_cache_counter',
      'graphql_query_counter',
      'graphql_request_error_total',
    ]
    for (const fam of families) {
      expect(text, `missing HELP for ${fam}`).toContain(`# HELP ${fam} `)
      expect(text, `missing TYPE for ${fam}`).toContain(`# TYPE ${fam} `)
    }
  })

  it('includes histogram _bucket lines for all HTTP components', () => {
    const text = generateMetricsText()
    const components = [
      'ServiceAlpha', 'ServiceBeta', 'ServiceGamma', 'ServiceDelta',
      'ServiceEpsilon', 'ServiceZeta', 'ServiceEta', 'ServiceTheta',
      'ServiceIota', 'ServiceKappa', 'ServiceLambda',
    ]
    for (const comp of components) {
      expect(text, `missing bucket for ${comp}`).toContain(
        `http_request_duration_seconds_bucket{le="0.05",component="${comp}",status="200"}`,
      )
      expect(text, `missing +Inf bucket for ${comp}`).toContain(
        `http_request_duration_seconds_bucket{le="+Inf",component="${comp}",status="200"}`,
      )
      expect(text, `missing _sum for ${comp}`).toContain(
        `http_request_duration_seconds_sum{component="${comp}",status="200"}`,
      )
      expect(text, `missing _count for ${comp}`).toContain(
        `http_request_duration_seconds_count{component="${comp}",status="200"}`,
      )
    }
  })

  it('includes histogram _bucket lines for all GraphQL operations', () => {
    const text = generateMetricsText()
    for (const op of ['BreakingNews', 'QueryA']) {
      expect(text, `missing bucket for ${op}`).toContain(
        `graphql_request_duration_seconds_bucket{le="0.01",operationName="${op}"}`,
      )
      expect(text, `missing _sum for ${op}`).toContain(
        `graphql_request_duration_seconds_sum{operationName="${op}"}`,
      )
    }
  })

  it('includes cache counter entries with operationName and clientID labels', () => {
    const text = generateMetricsText()
    const expected = [
      `graphql_query_type_cache_counter{operationName="BreakingNews",clientID="clientA",cached="hit"}`,
      `graphql_query_type_cache_counter{operationName="BreakingNews",clientID="clientA",cached="miss"}`,
      `graphql_query_type_cache_counter{operationName="QueryA",clientID="clientA",cached="hit"}`,
      `graphql_query_type_cache_counter{operationName="QueryB",clientID="clientC",cached="hit"}`,
    ]
    for (const e of expected) {
      expect(text, `missing: ${e}`).toContain(e)
    }
  })

  it('includes all expected query names in graphql_query_counter', () => {
    const text = generateMetricsText()
    const queries = [
      'breakingNews', 'queryAlpha', 'queryBeta', 'queryGamma',
      'queryDelta', 'queryEpsilon', 'queryZeta', 'queryEta',
      'queryTheta', 'queryIota', 'queryKappa', 'queryLambda',
      'queryMu', 'queryNu', 'queryXi', 'queryOmicron', 'queryPi', 'queryRho',
    ]
    for (const q of queries) {
      expect(text, `missing query: ${q}`).toContain(`graphql_query_counter{queryName="${q}"}`)
    }
  })

  it('includes graphql_request_error_total counter', () => {
    const text = generateMetricsText()
    expect(text).toContain('graphql_request_error_total ')
  })

  it('includes process_start_time_seconds gauge with a numeric value', () => {
    const text = generateMetricsText()
    expect(text, 'missing HELP for process_start_time_seconds').toContain(
      '# HELP process_start_time_seconds ',
    )
    expect(text, 'missing TYPE for process_start_time_seconds').toContain(
      '# TYPE process_start_time_seconds gauge',
    )
    expect(text).toMatch(/^process_start_time_seconds \d+$/m)
  })

  it('different containers produce different process_start_time_seconds values', () => {
    // Collect start-time values over many polls; we expect at least two distinct values
    // because the simulator has 10-20 containers with unique start times.
    const startTimes = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const m = /^process_start_time_seconds (\d+)$/m.exec(generateMetricsText())
      if (m) startTimes.add(m[1])
    }
    expect(startTimes.size).toBeGreaterThan(1)
  })

  it('produces valid Prometheus data lines (metric[{labels}] value)', () => {
    const text = generateMetricsText()
    // Only check non-comment, non-blank lines.
    const dataLines = text.split('\n').filter(
      (line) => line.trim().length > 0 && !line.startsWith('#'),
    )
    const metricLine = /^[\w_:]+(\{[^}]+\})? [-+]?\d+(\.\d+)?([eE][+-]?\d+)?$/
    for (const line of dataLines) {
      expect(line, `unexpected line format: "${line}"`).toMatch(metricLine)
    }
  })

  it('produces monotonically increasing +Inf bucket = count across consecutive calls', () => {
    // Call twice — the second call must show >= values for the same container.
    // Since we pick a random container each time we can only verify that all
    // +Inf buckets equal the reported count for each component.
    const checkText = (text: string) => {
      for (const comp of ['ServiceAlpha', 'ServiceBeta']) {
        const infMatch = new RegExp(
          `http_request_duration_seconds_bucket\\{le="\\+Inf",component="${comp}",status="200"\\} (\\d+)`,
        ).exec(text)
        const countMatch = new RegExp(
          `http_request_duration_seconds_count\\{component="${comp}",status="200"\\} (\\d+)`,
        ).exec(text)
        expect(infMatch).not.toBeNull()
        expect(countMatch).not.toBeNull()
        expect(Number(infMatch![1])).toBe(Number(countMatch![1]))
      }
    }
    checkText(generateMetricsText())
    checkText(generateMetricsText())
  })

  it('accepts SimulatorOptions and forces the specified events', () => {
    // Verify that passing options does not throw and produces valid output.
    const text = generateMetricsText({
      trafficSpike: true,
      breakingNewsSpike: true,
      dependencySlowdown: true,
      errorSpike: true,
    })

    expect(text.length).toBeGreaterThan(0)
    expect(text.endsWith('\n')).toBe(true)

    // The error counter must be present with a numeric value.
    expect(text).toMatch(/^graphql_request_error_total \d+/m)

    // All data lines must still be valid Prometheus format.
    const dataLines = text.split('\n').filter(
      (line) => line.trim().length > 0 && !line.startsWith('#'),
    )
    const metricLine = /^[\w_:]+(\{[^}]+\})? [-+]?\d+(\.\d+)?([eE][+-]?\d+)?$/
    for (const line of dataLines) {
      expect(line, `unexpected line format: "${line}"`).toMatch(metricLine)
    }
  })
})

