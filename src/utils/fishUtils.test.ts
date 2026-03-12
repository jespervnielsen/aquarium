import { describe, it, expect } from 'vitest'
import { deriveFishData, hashColor, hashPattern, colorToCSS, FISH_COLORS, FISH_PATTERNS } from './fishUtils'
import type { MetricFamily } from './prometheusParser'

// ---------------------------------------------------------------------------
// hashColor
// ---------------------------------------------------------------------------
describe('hashColor', () => {
  it('returns a value from FISH_COLORS', () => {
    const color = hashColor('breakingNews')
    expect(FISH_COLORS).toContain(color)
  })

  it('is deterministic', () => {
    expect(hashColor('serviceA')).toBe(hashColor('serviceA'))
  })
})

// ---------------------------------------------------------------------------
// colorToCSS
// ---------------------------------------------------------------------------
describe('colorToCSS', () => {
  it('converts a hex number to a CSS hex string', () => {
    expect(colorToCSS(0xff6b6b)).toBe('#ff6b6b')
    expect(colorToCSS(0x000000)).toBe('#000000')
    expect(colorToCSS(0xffffff)).toBe('#ffffff')
  })
})

// ---------------------------------------------------------------------------
// hashPattern
// ---------------------------------------------------------------------------
describe('hashPattern', () => {
  it('returns a value from FISH_PATTERNS', () => {
    const pattern = hashPattern('breakingNews')
    expect(FISH_PATTERNS).toContain(pattern)
  })

  it('is deterministic', () => {
    expect(hashPattern('serviceA')).toBe(hashPattern('serviceA'))
    expect(hashPattern('breakingNews')).toBe(hashPattern('breakingNews'))
  })

  it('handles empty string without throwing', () => {
    expect(() => hashPattern('')).not.toThrow()
  })

  it('produces different patterns for some different names', () => {
    // At least some names should differ in pattern (not all can be same)
    const patterns = ['breakingNews', 'frontPage', 'sportsApi', 'weatherFeed', 'videoStream'].map(hashPattern)
    const unique = new Set(patterns)
    expect(unique.size).toBeGreaterThan(1)
  })

  it('pattern and color can vary independently', () => {
    // Two names may share a color but differ in pattern, or vice-versa
    const names = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta']
    const pairs = names.map((n) => ({ color: hashColor(n), pattern: hashPattern(n) }))
    // Verify that not every pair is identical (color+pattern correlation is not total)
    const unique = new Set(pairs.map((p) => `${p.color}-${p.pattern}`))
    expect(unique.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// deriveFishData — `up` metric branch
// ---------------------------------------------------------------------------
describe('deriveFishData – up metric', () => {
  const upFamilies: MetricFamily[] = [
    {
      name: 'up',
      help: 'Scrape success',
      type: 'gauge',
      samples: [
        { name: 'up', labels: { job: 'serviceA', instance: 'host1' }, value: 1 },
        { name: 'up', labels: { job: 'serviceB', instance: 'host2' }, value: 0 },
      ],
    },
  ]

  it('creates one fish per up sample', () => {
    const fish = deriveFishData(upFamilies)
    expect(fish).toHaveLength(2)
  })

  it('uses job label as fish label', () => {
    const fish = deriveFishData(upFamilies)
    expect(fish.map((f) => f.label)).toContain('serviceA')
    expect(fish.map((f) => f.label)).toContain('serviceB')
  })

  it('sets isUp correctly', () => {
    const fish = deriveFishData(upFamilies)
    const a = fish.find((f) => f.label === 'serviceA')!
    const b = fish.find((f) => f.label === 'serviceB')!
    expect(a.isUp).toBe(true)
    expect(b.isUp).toBe(false)
  })

  it('each fish has a valid pattern', () => {
    const fish = deriveFishData(upFamilies)
    for (const f of fish) {
      expect(FISH_PATTERNS).toContain(f.pattern)
    }
  })

  it('defaults speedScale to 1.0 (up metric)', () => {
    const fish = deriveFishData(upFamilies)
    for (const f of fish) {
      expect(f.speedScale).toBe(1.0)
    }
  })
})

// ---------------------------------------------------------------------------
// deriveFishData — graphql_query_counter branch
// ---------------------------------------------------------------------------
describe('deriveFishData – graphql_query_counter', () => {
  const queryFamilies: MetricFamily[] = [
    {
      name: 'graphql_query_counter',
      help: 'Number of queries',
      type: 'counter',
      samples: [
        { name: 'graphql_query_counter', labels: { queryName: 'breakingNews' }, value: 19893 },
        { name: 'graphql_query_counter', labels: { queryName: 'queryAlpha' }, value: 12885 },
        { name: 'graphql_query_counter', labels: { queryName: 'queryRho' }, value: 1 },
      ],
    },
  ]

  it('creates one fish per queryName sample', () => {
    const fish = deriveFishData(queryFamilies)
    expect(fish).toHaveLength(3)
    expect(fish.map((f) => f.label)).toContain('breakingNews')
    expect(fish.map((f) => f.label)).toContain('queryRho')
  })

  it('stores the query count as value', () => {
    const fish = deriveFishData(queryFamilies)
    const bn = fish.find((f) => f.label === 'breakingNews')!
    expect(bn.value).toBe(19893)
  })

  it('highest-count query gets the highest speedScale', () => {
    const fish = deriveFishData(queryFamilies)
    const bn = fish.find((f) => f.label === 'breakingNews')!
    const rho = fish.find((f) => f.label === 'queryRho')!
    expect(bn.speedScale).toBeGreaterThan(rho.speedScale)
  })

  it('speedScale is within [0.5, 2.5]', () => {
    const fish = deriveFishData(queryFamilies)
    for (const f of fish) {
      expect(f.speedScale).toBeGreaterThanOrEqual(0.5)
      expect(f.speedScale).toBeLessThanOrEqual(2.5)
    }
  })

  it('most-used query has speedScale close to 2.5', () => {
    const fish = deriveFishData(queryFamilies)
    const bn = fish.find((f) => f.label === 'breakingNews')!
    // breakingNews is max → log(19893)/log(19893) = 1 → speedScale = 0.5 + 2 = 2.5
    expect(bn.speedScale).toBeCloseTo(2.5, 5)
  })

  it('all fish are marked isUp', () => {
    const fish = deriveFishData(queryFamilies)
    for (const f of fish) {
      expect(f.isUp).toBe(true)
    }
  })

  it('each fish has a valid pattern (graphql branch)', () => {
    const fish = deriveFishData(queryFamilies)
    for (const f of fish) {
      expect(FISH_PATTERNS).toContain(f.pattern)
    }
  })
})

// ---------------------------------------------------------------------------
// deriveFishData — fallback (generic families)
// ---------------------------------------------------------------------------
describe('deriveFishData – fallback', () => {
  const genericFamilies: MetricFamily[] = [
    { name: 'some_metric', help: '', type: 'gauge', samples: [{ name: 'some_metric', labels: {}, value: 42 }] },
    { name: 'other_metric', help: '', type: 'counter', samples: [] },
  ]

  it('creates one fish per family', () => {
    const fish = deriveFishData(genericFamilies)
    expect(fish).toHaveLength(2)
  })

  it('defaults speedScale to 1.0', () => {
    const fish = deriveFishData(genericFamilies)
    for (const f of fish) {
      expect(f.speedScale).toBe(1.0)
    }
  })

  it('each fish has a valid pattern (fallback branch)', () => {
    const fish = deriveFishData(genericFamilies)
    for (const f of fish) {
      expect(FISH_PATTERNS).toContain(f.pattern)
    }
  })

  it('returns empty array for empty families', () => {
    expect(deriveFishData([])).toHaveLength(0)
  })
})
