'use strict';

const {
  hashName,
  generateColor,
  parseMetrics,
  SpeciesRegistry,
  FISH_SHAPES,
  CORAL_TYPES,
} = require('../src/discovery');

// ---------------------------------------------------------------------------
// hashName
// ---------------------------------------------------------------------------
describe('hashName', () => {
  test('returns a non-negative integer', () => {
    expect(hashName('breakingNews')).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(hashName('breakingNews'))).toBe(true);
  });

  test('is deterministic – same input always produces same output', () => {
    expect(hashName('frontPage')).toBe(hashName('frontPage'));
    expect(hashName('BrightcoveApi')).toBe(hashName('BrightcoveApi'));
  });

  test('produces different values for different names', () => {
    expect(hashName('breakingNews')).not.toBe(hashName('frontPage'));
    expect(hashName('BrightcoveApi')).not.toBe(hashName('MetadataApi'));
  });

  test('handles empty string without throwing', () => {
    expect(() => hashName('')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// generateColor
// ---------------------------------------------------------------------------
describe('generateColor', () => {
  test('returns a CSS hsl() string', () => {
    const color = generateColor('breakingNews');
    expect(color).toMatch(/^hsl\(\d+, 70%, 60%\)$/);
  });

  test('hue is within 0–359', () => {
    for (const name of ['a', 'test', 'breakingNews', 'frontPage', 'BrightcoveApi']) {
      const [, hue] = generateColor(name).match(/^hsl\((\d+),/);
      expect(Number(hue)).toBeGreaterThanOrEqual(0);
      expect(Number(hue)).toBeLessThan(360);
    }
  });

  test('is deterministic', () => {
    expect(generateColor('breakingNews')).toBe(generateColor('breakingNews'));
    expect(generateColor('frontPage')).toBe(generateColor('frontPage'));
  });

  test('produces different colors for different names (in general)', () => {
    expect(generateColor('breakingNews')).not.toBe(generateColor('frontPage'));
  });
});

// ---------------------------------------------------------------------------
// parseMetrics
// ---------------------------------------------------------------------------
describe('parseMetrics', () => {
  const sampleMetrics = `
# HELP graphql_query_counter Total number of GraphQL queries
# TYPE graphql_query_counter counter
graphql_query_counter{queryName="breakingNews"} 1903
graphql_query_counter{queryName="frontPage"} 5321

# HELP http_request_duration_seconds HTTP request durations
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_sum{component="BrightcoveApi"} 5.21
http_request_duration_seconds_count{component="BrightcoveApi"} 18
http_request_duration_seconds_sum{component="MetadataApi"} 0.87
http_request_duration_seconds_count{component="MetadataApi"} 4
`;

  test('extracts all queryNames', () => {
    const { queryNames } = parseMetrics(sampleMetrics);
    expect(queryNames).toContain('breakingNews');
    expect(queryNames).toContain('frontPage');
    expect(queryNames).toHaveLength(2);
  });

  test('extracts all component names', () => {
    const { componentNames } = parseMetrics(sampleMetrics);
    expect(componentNames).toContain('BrightcoveApi');
    expect(componentNames).toContain('MetadataApi');
    expect(componentNames).toHaveLength(2);
  });

  test('skips comment lines', () => {
    const { queryNames, componentNames } = parseMetrics(sampleMetrics);
    expect(queryNames).not.toContain('#');
    expect(componentNames).not.toContain('#');
  });

  test('deduplicates identical names', () => {
    const duplicated = `
graphql_query_counter{queryName="breakingNews"} 1
graphql_query_counter{queryName="breakingNews"} 2
`;
    const { queryNames } = parseMetrics(duplicated);
    expect(queryNames.filter((n) => n === 'breakingNews')).toHaveLength(1);
  });

  test('handles empty input', () => {
    const result = parseMetrics('');
    expect(result.queryNames).toHaveLength(0);
    expect(result.componentNames).toHaveLength(0);
  });

  test('handles metrics with extra label pairs', () => {
    const text = `graphql_query_counter{env="prod",queryName="sports",region="eu"} 42\n`;
    const { queryNames } = parseMetrics(text);
    expect(queryNames).toContain('sports');
  });

  test('ignores unrelated metric lines', () => {
    const text = `some_other_metric{label="value"} 1\n`;
    const result = parseMetrics(text);
    expect(result.queryNames).toHaveLength(0);
    expect(result.componentNames).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SpeciesRegistry
// ---------------------------------------------------------------------------
describe('SpeciesRegistry', () => {
  const sampleParsed = {
    queryNames: ['breakingNews', 'frontPage'],
    componentNames: ['BrightcoveApi', 'MetadataApi'],
  };

  function makeRegistry(options = {}) {
    return new SpeciesRegistry(options);
  }

  test('starts with empty registry when no storage', () => {
    const reg = makeRegistry();
    expect(reg.getRegistry()).toEqual({ queries: {}, components: {} });
  });

  test('processMetrics populates queries and components', () => {
    const reg = makeRegistry();
    reg.processMetrics(sampleParsed);
    const { queries, components } = reg.getRegistry();

    expect(Object.keys(queries)).toContain('breakingNews');
    expect(Object.keys(queries)).toContain('frontPage');
    expect(Object.keys(components)).toContain('BrightcoveApi');
    expect(Object.keys(components)).toContain('MetadataApi');
  });

  test('species entries have color and shape', () => {
    const reg = makeRegistry();
    reg.processMetrics(sampleParsed);
    const species = reg.getSpecies('breakingNews');

    expect(species).toBeDefined();
    expect(species.color).toMatch(/^hsl\(\d+, 70%, 60%\)$/);
    expect(FISH_SHAPES).toContain(species.shape);
  });

  test('coral entries have type', () => {
    const reg = makeRegistry();
    reg.processMetrics(sampleParsed);
    const coral = reg.getCoral('BrightcoveApi');

    expect(coral).toBeDefined();
    expect(CORAL_TYPES).toContain(coral.type);
  });

  test('auto-generated values are deterministic across registry instances', () => {
    const reg1 = makeRegistry();
    reg1.processMetrics(sampleParsed);

    const reg2 = makeRegistry();
    reg2.processMetrics(sampleParsed);

    expect(reg1.getSpecies('breakingNews')).toEqual(reg2.getSpecies('breakingNews'));
    expect(reg1.getCoral('BrightcoveApi')).toEqual(reg2.getCoral('BrightcoveApi'));
  });

  test('config overrides are applied to species color and shape', () => {
    const queriesConfig = {
      breakingNews: { color: '#ff7f50', shape: 'triangle' },
    };
    const reg = makeRegistry({ queriesConfig });
    reg.processMetrics(sampleParsed);
    const species = reg.getSpecies('breakingNews');

    expect(species.color).toBe('#ff7f50');
    expect(species.shape).toBe('triangle');
  });

  test('config overrides are applied to coral type', () => {
    const componentsConfig = {
      BrightcoveApi: { type: 'fan' },
    };
    const reg = makeRegistry({ componentsConfig });
    reg.processMetrics(sampleParsed);
    const coral = reg.getCoral('BrightcoveApi');

    expect(coral.type).toBe('fan');
  });

  test('partial config override: missing fields fall back to auto-generated', () => {
    const queriesConfig = {
      breakingNews: { color: '#ff7f50' }, // shape not specified
    };
    const reg = makeRegistry({ queriesConfig });
    reg.processMetrics(sampleParsed);
    const species = reg.getSpecies('breakingNews');

    expect(species.color).toBe('#ff7f50');
    expect(FISH_SHAPES).toContain(species.shape);
  });

  test('does not overwrite existing entries on repeated processMetrics calls', () => {
    const reg = makeRegistry();
    reg.processMetrics(sampleParsed);
    const firstColor = reg.getSpecies('breakingNews').color;

    // Second call with the same data must not change the entry
    reg.processMetrics(sampleParsed);
    expect(reg.getSpecies('breakingNews').color).toBe(firstColor);
  });

  test('persists to and restores from storage', () => {
    const store = {};
    const fakeStorage = {
      getItem: (key) => store[key] || null,
      setItem: (key, value) => { store[key] = value; },
    };

    const reg1 = new SpeciesRegistry({ storage: fakeStorage });
    reg1.processMetrics(sampleParsed);

    // New registry using the same storage should restore the data
    const reg2 = new SpeciesRegistry({ storage: fakeStorage });
    expect(reg2.getSpecies('breakingNews')).toEqual(
      reg1.getSpecies('breakingNews')
    );
    expect(reg2.getCoral('BrightcoveApi')).toEqual(
      reg1.getCoral('BrightcoveApi')
    );
  });

  test('storage handles corrupt JSON gracefully', () => {
    const fakeStorage = {
      getItem: () => 'NOT_VALID_JSON{{{',
      setItem: () => {},
    };
    expect(() => new SpeciesRegistry({ storage: fakeStorage })).not.toThrow();
    const reg = new SpeciesRegistry({ storage: fakeStorage });
    expect(reg.getRegistry()).toEqual({ queries: {}, components: {} });
  });

  test('getSpecies returns undefined for unknown name', () => {
    const reg = makeRegistry();
    expect(reg.getSpecies('nonExistent')).toBeUndefined();
  });

  test('getCoral returns undefined for unknown name', () => {
    const reg = makeRegistry();
    expect(reg.getCoral('nonExistent')).toBeUndefined();
  });
});
