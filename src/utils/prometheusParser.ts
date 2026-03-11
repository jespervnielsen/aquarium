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

/**
 * Parse a Prometheus exposition format text response into typed metric families.
 * Supports the standard text-based format (0.0.4) used by /metrics endpoints.
 */
export function parsePrometheusText(text: string): MetricFamily[] {
  const families: Map<string, MetricFamily> = new Map();
  const lines = text.split('\n');

  let currentName = '';
  let currentHelp = '';
  let currentType = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('# HELP ')) {
      const parts = line.slice(7).split(' ');
      currentName = parts[0];
      currentHelp = parts.slice(1).join(' ');
      if (!families.has(currentName)) {
        families.set(currentName, {
          name: currentName,
          help: currentHelp,
          type: '',
          samples: [],
        });
      } else {
        // Update help text
        const fam = families.get(currentName)!;
        fam.help = currentHelp;
      }
    } else if (line.startsWith('# TYPE ')) {
      const parts = line.slice(7).split(' ');
      currentName = parts[0];
      currentType = parts[1] ?? '';
      if (!families.has(currentName)) {
        families.set(currentName, {
          name: currentName,
          help: '',
          type: currentType,
          samples: [],
        });
      } else {
        families.get(currentName)!.type = currentType;
      }
    } else if (!line.startsWith('#')) {
      const sample = parseSampleLine(line);
      if (sample) {
        // Find the family this sample belongs to (strip suffixes for histograms/summaries)
        const familyName = resolveFamilyName(sample.name, families);
        if (!families.has(familyName)) {
          families.set(familyName, {
            name: familyName,
            help: '',
            type: '',
            samples: [],
          });
        }
        families.get(familyName)!.samples.push(sample);
      }
    }
  }

  return Array.from(families.values());
}

function resolveFamilyName(
  sampleName: string,
  families: Map<string, MetricFamily>
): string {
  if (families.has(sampleName)) return sampleName;
  // Histograms and summaries have _bucket, _count, _sum suffixes
  for (const suffix of ['_bucket', '_count', '_sum', '_total']) {
    if (sampleName.endsWith(suffix)) {
      const base = sampleName.slice(0, -suffix.length);
      if (families.has(base)) return base;
    }
  }
  return sampleName;
}

function parseSampleLine(line: string): MetricSample | null {
  // Format: metric_name{label="value",...} value [timestamp]
  // Or:    metric_name value [timestamp]
  const withLabelsMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+([^\s]+)(?:\s+(\d+))?$/);
  if (withLabelsMatch) {
    const name = withLabelsMatch[1];
    const labelsStr = withLabelsMatch[2];
    const valueStr = withLabelsMatch[3];
    const tsStr = withLabelsMatch[4];
    const value = parseFloat(valueStr);
    if (isNaN(value)) return null;
    return {
      name,
      labels: parseLabels(labelsStr),
      value,
      timestamp: tsStr ? parseInt(tsStr, 10) : undefined,
    };
  }

  const noLabelsMatch = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+([^\s]+)(?:\s+(\d+))?$/);
  if (noLabelsMatch) {
    const name = noLabelsMatch[1];
    const valueStr = noLabelsMatch[2];
    const tsStr = noLabelsMatch[3];
    const value = parseFloat(valueStr);
    if (isNaN(value)) return null;
    return {
      name,
      labels: {},
      value,
      timestamp: tsStr ? parseInt(tsStr, 10) : undefined,
    };
  }

  return null;
}

function parseLabels(labelsStr: string): Record<string, string> {
  const labels: Record<string, string> = {};
  // Match key="value" pairs, handling escaped quotes
  const labelPattern = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(labelsStr)) !== null) {
    labels[match[1]] = match[2].replace(/\\(["\\n])/g, (_, c: string) => {
      if (c === 'n') return '\n';
      return c; // handles both \" → " and \\ → \
    });
  }
  return labels;
}
