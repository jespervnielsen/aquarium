import type { MetricFamily } from './prometheusParser';

export const MAX_FISH = 30;
export const MAX_CORALS = 12;

export const FISH_COLORS = [
  0xff6b6b, 0xffa07a, 0xffd700, 0x98fb98, 0x87ceeb,
  0xda70d6, 0xff69b4, 0x20b2aa, 0xf0e68c, 0x7b68ee,
];

export function hashColor(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return FISH_COLORS[Math.abs(hash) % FISH_COLORS.length];
}

export function colorToCSS(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** Visual patterns that can be drawn on a fish body. */
export const FISH_PATTERNS = ['plain', 'stripes', 'spots', 'patch', 'bands'] as const;
export type FishPattern = (typeof FISH_PATTERNS)[number];

/**
 * Deterministically pick a pattern for the given label.
 * Uses a different multiplier than {@link hashColor} so pattern and color
 * vary independently, maximising visual distinctiveness between fish.
 */
export function hashPattern(str: string): FishPattern {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 37 + str.charCodeAt(i)) | 0;
  }
  return FISH_PATTERNS[Math.abs(hash) % FISH_PATTERNS.length];
}

export interface FishInfo {
  label: string;
  color: number;
  pattern: FishPattern;
  isUp: boolean;
  value: number | null;
  speedScale: number;
}

export function deriveFishData(families: MetricFamily[]): FishInfo[] {
  const result: FishInfo[] = [];

  // Look for `up` metric — each unique job/instance is a fish
  const upFamily = families.find((f) => f.name === 'up');
  if (upFamily && upFamily.samples.length > 0) {
    for (const sample of upFamily.samples) {
      const label = sample.labels.job ?? sample.labels.instance ?? 'service';
      const isUp = sample.value === 1;
      result.push({ label, color: hashColor(label), pattern: hashPattern(label), isUp, value: sample.value, speedScale: 1.0 });
    }
    return result.slice(0, MAX_FISH);
  }

  // Use graphql_query_counter for query-based fish with count-driven speed scaling.
  // Aggregate by queryName so multiple container instances are summed into one fish.
  const queryFamily = families.find((f) => f.name === 'graphql_query_counter');
  if (queryFamily && queryFamily.samples.length > 0) {
    const queryTotals = new Map<string, number>();
    for (const sample of queryFamily.samples) {
      const queryName = sample.labels['queryName'];
      if (!queryName) continue;
      queryTotals.set(queryName, (queryTotals.get(queryName) ?? 0) + sample.value);
    }

    let maxCount = 0;
    for (const count of queryTotals.values()) {
      if (count > maxCount) maxCount = count;
    }
    const logMax = Math.log(maxCount + 1);

    for (const [queryName, total] of queryTotals) {
      const logCount = Math.log(total + 1);
      // Scale from 0.5 (rare query) to 2.5 (most-used query)
      const speedScale = 0.5 + (logMax > 0 ? logCount / logMax : 0) * 2.0;
      result.push({ label: queryName, color: hashColor(queryName), pattern: hashPattern(queryName), isUp: true, value: total, speedScale });
    }
    if (result.length > 0) return result.slice(0, MAX_FISH);
  }

  // Fallback: one fish per metric family
  const seen = new Set<string>();
  for (const family of families) {
    if (!seen.has(family.name)) {
      seen.add(family.name);
      const firstValue = family.samples.length > 0 ? family.samples[0].value : null;
      result.push({ label: family.name, color: hashColor(family.name), pattern: hashPattern(family.name), isUp: true, value: firstValue, speedScale: 1.0 });
    }
    if (result.length >= MAX_FISH) break;
  }
  return result;
}

/** Coral types that can be rendered in the aquarium. */
export const CORAL_TYPES = ['fan', 'branch', 'dome', 'tube', 'star'] as const;
export type CoralType = (typeof CORAL_TYPES)[number];

/** Deterministically pick a coral type for the given component name. */
export function hashCoralType(str: string): CoralType {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return CORAL_TYPES[Math.abs(hash) % CORAL_TYPES.length];
}

export interface CoralInfo {
  name: string;
  type: CoralType;
  color: number;
  avgLatency: number;
}

const HTTP_DURATION_PREFIX = 'http_request_duration_seconds';

/** Derive one CoralInfo entry per HTTP component found in the metric families. */
export function deriveCoralData(families: MetricFamily[]): CoralInfo[] {
  const seen = new Set<string>();
  const sumMap: Record<string, number> = {};
  const countMap: Record<string, number> = {};
  for (const family of families) {
    if (!family.name.startsWith(HTTP_DURATION_PREFIX)) continue;
    for (const sample of family.samples) {
      const component = sample.labels['component'];
      if (!component) continue;
      seen.add(component);
      if (sample.name.endsWith('_sum')) sumMap[component] = sample.value;
      else if (sample.name.endsWith('_count')) countMap[component] = sample.value;
    }
  }
  return Array.from(seen)
    .slice(0, MAX_CORALS)
    .map((name) => {
      const avgLatency =
        sumMap[name] !== undefined && countMap[name] !== undefined && countMap[name] > 0
          ? sumMap[name] / countMap[name]
          : 0;
      return { name, type: hashCoralType(name), color: hashColor(name), avgLatency };
    });
}
