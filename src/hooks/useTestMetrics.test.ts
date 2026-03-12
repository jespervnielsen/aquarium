import { describe, it, expect } from 'vitest'
import { generateMetricsText } from '../dev/metricsSimulator'
import { parsePrometheusText } from '../utils/prometheusParser'

/**
 * Integration tests that validate the logic used by useTestMetrics:
 * generateMetricsText (simulator) → parsePrometheusText (parser) → MetricFamily[].
 *
 * These cover the behaviour that the hook depends on so that test-scenario
 * toggles actually produce meaningful, parseable metrics in the browser.
 */
describe('useTestMetrics integration (simulator → parser)', () => {
  const defaultScenarios = {
    trafficSpike: false,
    breakingNewsSpike: false,
    dependencySlowdown: false,
    errorSpike: false,
  }

  it('generates parseable metrics with no scenarios active', () => {
    const text = generateMetricsText(defaultScenarios)
    const families = parsePrometheusText(text)
    expect(families.length).toBeGreaterThan(0)
  })

  it('parsed families include graphql_query_counter', () => {
    const families = parsePrometheusText(generateMetricsText(defaultScenarios))
    const queryFamily = families.find((f) => f.name === 'graphql_query_counter')
    expect(queryFamily).toBeDefined()
    expect(queryFamily!.samples.length).toBeGreaterThan(0)
  })

  it('graphql_query_counter samples carry queryName labels', () => {
    const families = parsePrometheusText(generateMetricsText(defaultScenarios))
    const queryFamily = families.find((f) => f.name === 'graphql_query_counter')!
    for (const sample of queryFamily.samples) {
      expect(sample.labels['queryName']).toBeDefined()
    }
  })

  it('parsed families include http_request_duration_seconds', () => {
    const families = parsePrometheusText(generateMetricsText(defaultScenarios))
    const httpFamily = families.find((f) => f.name === 'http_request_duration_seconds')
    expect(httpFamily).toBeDefined()
  })

  it('breakingNewsSpike produces valid metrics with breakingNews query present', () => {
    const families = parsePrometheusText(
      generateMetricsText({ ...defaultScenarios, breakingNewsSpike: true }),
    )
    const queryFamily = families.find((f) => f.name === 'graphql_query_counter')
    expect(queryFamily).toBeDefined()
    const bn = queryFamily!.samples.find((s) => s.labels['queryName'] === 'breakingNews')
    expect(bn).toBeDefined()
    expect(bn!.value).toBeGreaterThan(0)
  })

  it('errorSpike produces elevated error counter', () => {
    // Collect the error counter values over several normal and spike polls.
    const normalErrors: number[] = []
    const spikeErrors: number[] = []

    for (let i = 0; i < 10; i++) {
      const families = parsePrometheusText(generateMetricsText(defaultScenarios))
      const ef = families.find((f) => f.name === 'graphql_request_error_total')
      if (ef && ef.samples.length > 0) normalErrors.push(ef.samples[0].value)
    }

    for (let i = 0; i < 10; i++) {
      const families = parsePrometheusText(
        generateMetricsText({ ...defaultScenarios, errorSpike: true }),
      )
      const ef = families.find((f) => f.name === 'graphql_request_error_total')
      if (ef && ef.samples.length > 0) spikeErrors.push(ef.samples[0].value)
    }

    // The spike polls must have produced at least some errors.
    const spikeTotal = spikeErrors.at(-1) ?? 0
    const normalTotal = normalErrors.at(-1) ?? 0
    expect(spikeTotal).toBeGreaterThan(normalTotal)
  })

  it('all scenarios produce valid parseable output', () => {
    const allActive = {
      trafficSpike: true,
      breakingNewsSpike: true,
      dependencySlowdown: true,
      errorSpike: true,
    }
    const families = parsePrometheusText(generateMetricsText(allActive))
    expect(families.length).toBeGreaterThan(0)
    // All samples must have finite numeric values.
    for (const family of families) {
      for (const sample of family.samples) {
        expect(Number.isFinite(sample.value)).toBe(true)
      }
    }
  })
})

