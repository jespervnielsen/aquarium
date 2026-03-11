'use strict';

/**
 * Deterministic hash of a string name.
 * Uses a simple polynomial rolling hash (djb2-style).
 *
 * @param {string} name
 * @returns {number} unsigned 32-bit integer hash
 */
function hashName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(i)) | 0;
  }
  return hash >>> 0; // convert to unsigned 32-bit integer
}

/**
 * Generate a deterministic HSL color string for the given name.
 * Algorithm: hash(name) → hue (0–359) → hsl(hue, 70%, 60%)
 *
 * @param {string} name
 * @returns {string} CSS color string, e.g. "hsl(217, 70%, 60%)"
 */
function generateColor(name) {
  const hue = hashName(name) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

/** Fish shapes available for species assignment. */
const FISH_SHAPES = ['triangle', 'oval', 'round', 'flat', 'long'];

/** Coral types available for component assignment. */
const CORAL_TYPES = ['fan', 'branch', 'dome', 'tube', 'star'];

/**
 * Deterministically pick an item from an array based on the name hash.
 *
 * @param {string} name
 * @param {string[]} items
 * @returns {string}
 */
function pickFromArray(name, items) {
  return items[hashName(name) % items.length];
}

/**
 * Parse a Prometheus text-format metrics string and extract:
 *   - GraphQL query names  (graphql_query_counter{queryName="..."})
 *   - HTTP component names (http_request_duration_seconds_*{component="..."})
 *
 * @param {string} metricsText  Raw Prometheus metrics text
 * @returns {{ queryNames: string[], componentNames: string[] }}
 */
function parseMetrics(metricsText) {
  const queryNames = new Set();
  const componentNames = new Set();

  const lines = metricsText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Match graphql_query_counter{queryName="<name>"}
    const queryMatch = trimmed.match(
      /^graphql_query_counter\{[^}]*queryName="([^"]+)"[^}]*\}/
    );
    if (queryMatch) {
      queryNames.add(queryMatch[1]);
      continue;
    }

    // Match http_request_duration_seconds_*{component="<name>"}
    const componentMatch = trimmed.match(
      /^http_request_duration_seconds_[a-z]+\{[^}]*component="([^"]+)"[^}]*\}/
    );
    if (componentMatch) {
      componentNames.add(componentMatch[1]);
    }
  }

  return {
    queryNames: Array.from(queryNames),
    componentNames: Array.from(componentNames),
  };
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
class SpeciesRegistry {
  /**
   * @param {object} [options]
   * @param {object} [options.queriesConfig]    Manual overrides for query species
   * @param {object} [options.componentsConfig] Manual overrides for component corals
   * @param {Storage|null} [options.storage]    localStorage-compatible interface (null = no persistence)
   */
  constructor({ queriesConfig = {}, componentsConfig = {}, storage = null } = {}) {
    this._queriesConfig = queriesConfig;
    this._componentsConfig = componentsConfig;
    this._storage = storage;

    /** @type {{ queries: Object<string, {color: string, shape: string}>, components: Object<string, {type: string}> }} */
    this._registry = this._load();
  }

  /**
   * Load the persisted registry from storage (if available), falling back to
   * an empty registry.
   *
   * @returns {{ queries: object, components: object }}
   */
  _load() {
    if (this._storage) {
      try {
        const raw = this._storage.getItem('aquarium_species_registry');
        if (raw) {
          return JSON.parse(raw);
        }
      } catch (_) {
        // Ignore parse errors and start fresh
      }
    }
    return { queries: {}, components: {} };
  }

  /**
   * Persist the current registry to storage.
   */
  _save() {
    if (this._storage) {
      this._storage.setItem(
        'aquarium_species_registry',
        JSON.stringify(this._registry)
      );
    }
  }

  /**
   * Process a parsed metrics result and register any new species / corals.
   *
   * @param {{ queryNames: string[], componentNames: string[] }} parsed
   */
  processMetrics({ queryNames, componentNames }) {
    let dirty = false;

    for (const name of queryNames) {
      if (!this._registry.queries[name]) {
        this._registry.queries[name] = this._buildSpecies(name);
        dirty = true;
      }
    }

    for (const name of componentNames) {
      if (!this._registry.components[name]) {
        this._registry.components[name] = this._buildCoral(name);
        dirty = true;
      }
    }

    if (dirty) {
      this._save();
    }
  }

  /**
   * Build a species entry for the given query name.
   * Config overrides take precedence over auto-generated values.
   *
   * @param {string} name
   * @returns {{ color: string, shape: string }}
   */
  _buildSpecies(name) {
    const override = this._queriesConfig[name] || {};
    return {
      color: override.color || generateColor(name),
      shape: override.shape || pickFromArray(name, FISH_SHAPES),
    };
  }

  /**
   * Build a coral entry for the given component name.
   * Config overrides take precedence over auto-generated values.
   *
   * @param {string} name
   * @returns {{ type: string }}
   */
  _buildCoral(name) {
    const override = this._componentsConfig[name] || {};
    return {
      type: override.type || pickFromArray(name, CORAL_TYPES),
    };
  }

  /**
   * Return the full registry snapshot.
   *
   * @returns {{ queries: object, components: object }}
   */
  getRegistry() {
    return this._registry;
  }

  /**
   * Return the species entry for a specific query name, or undefined.
   *
   * @param {string} name
   * @returns {{ color: string, shape: string } | undefined}
   */
  getSpecies(name) {
    return this._registry.queries[name];
  }

  /**
   * Return the coral entry for a specific component name, or undefined.
   *
   * @param {string} name
   * @returns {{ type: string } | undefined}
   */
  getCoral(name) {
    return this._registry.components[name];
  }
}

module.exports = {
  hashName,
  generateColor,
  parseMetrics,
  SpeciesRegistry,
  FISH_SHAPES,
  CORAL_TYPES,
};
