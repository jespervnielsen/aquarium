/**
 * Minimal Prometheus text-format parser.
 * Handles the standard exposition format produced by most exporters.
 */

export interface MetricSample {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
}

export interface MetricFamily {
  name: string;
  help: string;
  type: string;
  samples: MetricSample[];
}

function parseLabels(labelStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  if (!labelStr) return labels;
  // Match key="value" pairs, handling escaped quotes inside values
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(labelStr)) !== null) {
    labels[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return labels;
}

export function parsePrometheusText(text: string): MetricFamily[] {
  const families: Map<string, MetricFamily> = new Map();
  let currentName = '';

  const lines = text.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('# HELP ')) {
      const rest = line.slice(7);
      const spaceIdx = rest.indexOf(' ');
      const name = spaceIdx >= 0 ? rest.slice(0, spaceIdx) : rest;
      const help = spaceIdx >= 0 ? rest.slice(spaceIdx + 1) : '';
      if (!families.has(name)) {
        families.set(name, { name, help, type: 'untyped', samples: [] });
      } else {
        families.get(name)!.help = help;
      }
      continue;
    }

    if (line.startsWith('# TYPE ')) {
      const parts = line.slice(7).split(' ');
      const name = parts[0];
      const type = parts[1] ?? 'untyped';
      if (!families.has(name)) {
        families.set(name, { name, help: '', type, samples: [] });
      } else {
        families.get(name)!.type = type;
      }
      currentName = name;
      continue;
    }

    if (line.startsWith('#')) continue;

    // Sample line: metric_name{labels} value [timestamp]
    const braceOpen = line.indexOf('{');
    const braceClose = line.indexOf('}');
    let name: string;
    let labels: Record<string, string>;
    let rest: string;

    if (braceOpen >= 0 && braceClose > braceOpen) {
      name = line.slice(0, braceOpen);
      labels = parseLabels(line.slice(braceOpen + 1, braceClose));
      rest = line.slice(braceClose + 1).trim();
    } else {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx < 0) continue;
      name = line.slice(0, spaceIdx);
      labels = {};
      rest = line.slice(spaceIdx + 1).trim();
    }

    const valueParts = rest.split(/\s+/);
    const rawValue = valueParts[0];
    let value: number;
    if (rawValue === '+Inf') {
      value = Infinity;
    } else if (rawValue === '-Inf') {
      value = -Infinity;
    } else if (rawValue === 'NaN') {
      value = NaN;
    } else {
      value = parseFloat(rawValue);
    }

    const timestamp = valueParts[1] ? parseFloat(valueParts[1]) : undefined;

    // Determine which family this sample belongs to.
    // Strip _total, _sum, _count, _bucket suffixes to find the base name.
    let familyName = name;
    for (const suffix of ['_total', '_created', '_sum', '_count', '_bucket']) {
      if (name.endsWith(suffix)) {
        const base = name.slice(0, -suffix.length);
        if (families.has(base)) {
          familyName = base;
          break;
        }
      }
    }

    if (!families.has(familyName)) {
      // Use currentName as a fallback for families declared with TYPE
      const baseName = families.has(currentName) ? currentName : familyName;
      families.set(baseName, { name: baseName, help: '', type: 'untyped', samples: [] });
      familyName = baseName;
    }

    families.get(familyName)!.samples.push({ name, labels, value, timestamp });
  }

  return Array.from(families.values());
}

/** Return the first numeric value for a metric by name (exact or prefix match). */
export function getMetricValue(
  families: MetricFamily[],
  metricName: string,
  labels?: Record<string, string>,
): number | undefined {
  for (const family of families) {
    for (const sample of family.samples) {
      if (sample.name !== metricName) continue;
      if (labels) {
        const match = Object.entries(labels).every(
          ([k, v]) => sample.labels[k] === v,
        );
        if (!match) continue;
      }
      return sample.value;
    }
  }
  return undefined;
}

/** Sum all sample values for a given metric name. */
export function sumMetricValues(
  families: MetricFamily[],
  metricName: string,
): number {
  let total = 0;
  for (const family of families) {
    for (const sample of family.samples) {
      if (sample.name === metricName && isFinite(sample.value)) {
        total += sample.value;
      }
    }
  }
  return total;
}
