/**
 * Deterministic hash of a string name.
 * Uses a simple polynomial rolling hash (djb2-style).
 *
 * @param name - The string to hash.
 * @returns An unsigned 32-bit integer hash value.
 */
export function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0
  }
  return hash >>> 0 // convert to unsigned 32-bit integer
}

/**
 * Generate a deterministic HSL color string for the given name.
 * Algorithm: hash(name) → hue (0–359) → hsl(hue, 70%, 60%)
 *
 * @param name - The string to derive a color from.
 * @returns CSS color string, e.g. "hsl(217, 70%, 60%)"
 */
export function generateColor(name: string): string {
  const hue = hashName(name) % 360
  return `hsl(${hue}, 70%, 60%)`
}

/** Fish shapes available for species assignment. */
export const FISH_SHAPES = ['triangle', 'oval', 'round', 'flat', 'long'] as const
export type FishShape = (typeof FISH_SHAPES)[number]

/** Coral types available for component assignment. */
export const CORAL_TYPES = ['fan', 'branch', 'dome', 'tube', 'star'] as const
export type CoralType = (typeof CORAL_TYPES)[number]

/**
 * Deterministically pick an item from a readonly array based on the name hash.
 */
function pickFromArray<T>(name: string, items: readonly T[]): T {
  return items[hashName(name) % items.length]
}

/** A single fish species entry in the registry. */
export interface SpeciesEntry {
  color: string
  shape: FishShape
}

/** A single coral entry in the registry. */
export interface CoralEntry {
  type: CoralType
}

/** The full species registry structure. */
export interface Registry {
  queries: Record<string, SpeciesEntry>
  components: Record<string, CoralEntry>
}

/** Parsed result from {@link parseMetrics}. */
export interface ParsedMetrics {
  queryNames: string[]
  componentNames: string[]
}

/**
 * Manual override config for a query species entry.
 * Either or both fields may be omitted; missing fields fall back to auto-generation.
 */
export interface QueryOverride {
  color?: string
  shape?: FishShape
}

/**
 * Manual override config for a coral entry.
 * The type field may be omitted; it then falls back to auto-generation.
 */
export interface CoralOverride {
  type?: CoralType
}

/** Options accepted by {@link SpeciesRegistry}. */
export interface SpeciesRegistryOptions {
  /** Manual overrides for query → fish species mappings (from queries.json). */
  queriesConfig?: Record<string, QueryOverride>
  /** Manual overrides for component → coral mappings (from components.json). */
  componentsConfig?: Record<string, CoralOverride>
  /**
   * A localStorage-compatible storage interface.
   * Pass `window.localStorage` in the browser; omit (or pass `null`) in Node.js
   * or test environments.
   */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}

/**
 * Parse a Prometheus text-format metrics string and extract:
 *   - GraphQL query names  (graphql_query_counter{queryName="..."})
 *   - HTTP component names (http_request_duration_seconds_*{component="..."})
 *
 * @param metricsText - Raw Prometheus metrics text.
 * @returns Deduplicated arrays of discovered query and component names.
 */
export function parseMetrics(metricsText: string): ParsedMetrics {
  const queryNames = new Set<string>()
  const componentNames = new Set<string>()

  for (const rawLine of metricsText.split('\n')) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Match graphql_query_counter{queryName="<name>"}
    const queryMatch = trimmed.match(
      /^graphql_query_counter\{[^}]*queryName="([^"]+)"[^}]*\}/,
    )
    if (queryMatch) {
      queryNames.add(queryMatch[1])
      continue
    }

    // Match http_request_duration_seconds_*{component="<name>"}
    const componentMatch = trimmed.match(
      /^http_request_duration_seconds_[a-z]+\{[^}]*component="([^"]+)"[^}]*\}/,
    )
    if (componentMatch) {
      componentNames.add(componentMatch[1])
    }
  }

  return {
    queryNames: Array.from(queryNames),
    componentNames: Array.from(componentNames),
  }
}

/**
 * Species registry that maps discovered query names → fish species and
 * component names → corals.
 *
 * Precedence for a name's attributes (highest first):
 *   1. Manual override supplied via config (queries.json / components.json)
 *   2. Previously persisted entry in localStorage (browser) / in-memory cache (Node)
 *   3. Auto-generated values (deterministic color + shape/type)
 */
export class SpeciesRegistry {
  private readonly queriesConfig: Record<string, QueryOverride>
  private readonly componentsConfig: Record<string, CoralOverride>
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null
  private readonly registry: Registry

  constructor({
    queriesConfig = {},
    componentsConfig = {},
    storage = null,
  }: SpeciesRegistryOptions = {}) {
    this.queriesConfig = queriesConfig
    this.componentsConfig = componentsConfig
    this.storage = storage
    this.registry = this.load()
  }

  /**
   * Load the persisted registry from storage (if available), falling back to
   * an empty registry.
   */
  private load(): Registry {
    if (this.storage) {
      try {
        const raw = this.storage.getItem('aquarium_species_registry')
        if (raw) {
          return JSON.parse(raw) as Registry
        }
      } catch {
        // Ignore parse errors and start fresh
      }
    }
    return { queries: {}, components: {} }
  }

  /** Persist the current registry to storage. */
  private save(): void {
    this.storage?.setItem('aquarium_species_registry', JSON.stringify(this.registry))
  }

  /**
   * Process a parsed metrics result and register any new species / corals.
   * Existing entries are never overwritten.
   */
  processMetrics({ queryNames, componentNames }: ParsedMetrics): void {
    let dirty = false

    for (const name of queryNames) {
      if (!this.registry.queries[name]) {
        this.registry.queries[name] = this.buildSpecies(name)
        dirty = true
      }
    }

    for (const name of componentNames) {
      if (!this.registry.components[name]) {
        this.registry.components[name] = this.buildCoral(name)
        dirty = true
      }
    }

    if (dirty) this.save()
  }

  /** Build a species entry for the given query name. */
  private buildSpecies(name: string): SpeciesEntry {
    const override = this.queriesConfig[name] ?? {}
    return {
      color: override.color ?? generateColor(name),
      shape: override.shape ?? pickFromArray(name, FISH_SHAPES),
    }
  }

  /** Build a coral entry for the given component name. */
  private buildCoral(name: string): CoralEntry {
    const override = this.componentsConfig[name] ?? {}
    return {
      type: override.type ?? pickFromArray(name, CORAL_TYPES),
    }
  }

  /** Return the full registry snapshot. */
  getRegistry(): Registry {
    return this.registry
  }

  /** Return the species entry for a specific query name, or undefined. */
  getSpecies(name: string): SpeciesEntry | undefined {
    return this.registry.queries[name]
  }

  /** Return the coral entry for a specific component name, or undefined. */
  getCoral(name: string): CoralEntry | undefined {
    return this.registry.components[name]
  }
}
