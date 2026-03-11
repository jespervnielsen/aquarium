import type { MetricSample } from './types.ts'

/**
 * Parses a Prometheus exposition format text into an array of MetricSample
 * objects. Comment lines (starting with #) and blank lines are skipped.
 *
 * Supported line formats:
 *   metric_name{label="value",...} <number>[ <timestamp>]
 *   metric_name <number>[ <timestamp>]
 */
export function parsePrometheusText(text: string): MetricSample[] {
  const samples: MetricSample[] = []

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue

    const sample = parseLine(line)
    if (sample !== null) {
      samples.push(sample)
    }
  }

  return samples
}

function parseLine(line: string): MetricSample | null {
  // Split off an optional timestamp at the end: <name>{...} <value> [<ts>]
  // We only care about name, labels, and value.
  const braceOpen = line.indexOf('{')

  let metricName: string
  let labelsStr: string
  let valuePart: string

  if (braceOpen !== -1) {
    metricName = line.slice(0, braceOpen)
    const braceClose = line.indexOf('}', braceOpen)
    if (braceClose === -1) return null
    labelsStr = line.slice(braceOpen + 1, braceClose)
    valuePart = line.slice(braceClose + 1).trim()
  } else {
    // No labels
    const spaceIdx = line.indexOf(' ')
    if (spaceIdx === -1) return null
    metricName = line.slice(0, spaceIdx)
    labelsStr = ''
    valuePart = line.slice(spaceIdx + 1).trim()
  }

  // valuePart may contain an optional timestamp after a space; take only the first token
  const valueToken = valuePart.split(' ')[0]
  const value = parseFloat(valueToken)
  if (isNaN(value)) return null

  const labels = parseLabels(labelsStr)

  return { metric: metricName, labels, value }
}

/**
 * Parses a Prometheus label string such as:
 *   queryName="breakingNews",component="BrightcoveApi"
 */
function parseLabels(labelsStr: string): Record<string, string> {
  const labels: Record<string, string> = {}
  if (!labelsStr) return labels

  // Match key="value" pairs, handling escaped quotes inside values
  const labelPattern = /(\w+)="((?:[^"\\]|\\.)*)"/g
  let match: RegExpExecArray | null

  while ((match = labelPattern.exec(labelsStr)) !== null) {
    const key = match[1]
    const val = match[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    labels[key] = val
  }

  return labels
}
