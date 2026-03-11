import type { MetricFamily } from '../utils/prometheusParser';

interface MetricsPanelProps {
  families: MetricFamily[];
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

export function MetricsPanel({ families, loading, error, lastFetch }: MetricsPanelProps) {
  return (
    <aside className="metrics-panel">
      <div className="metrics-panel__header">
        <h3>Metrics</h3>
        {loading && <span className="badge badge--loading">Fetching…</span>}
        {!loading && lastFetch && (
          <span className="badge badge--ok" title={lastFetch.toISOString()}>
            {lastFetch.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="metrics-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {families.length === 0 && !loading && !error && (
        <p className="metrics-empty">No metrics yet. Configure an endpoint above.</p>
      )}

      <ul className="metrics-list">
        {families.map((fam) => (
          <li key={fam.name} className="metric-item">
            <div className="metric-name" title={fam.help || fam.name}>
              {fam.name}
            </div>
            {fam.type && <span className="metric-type">{fam.type}</span>}
            <ul className="sample-list">
              {fam.samples.slice(0, 5).map((sample, idx) => (
                <li key={idx} className="sample-item">
                  {Object.keys(sample.labels).length > 0 && (
                    <span className="sample-labels">
                      {'{'}
                      {Object.entries(sample.labels)
                        .map(([k, v]) => `${k}="${v}"`)
                        .join(', ')}
                      {'}'}
                    </span>
                  )}
                  <span className="sample-value">{formatValue(sample.value)}</span>
                </li>
              ))}
              {fam.samples.length > 5 && (
                <li className="sample-more">+{fam.samples.length - 5} more</li>
              )}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatValue(v: number): string {
  if (!isFinite(v)) return String(v);
  if (Number.isInteger(v)) return v.toString();
  return v.toPrecision(6).replace(/\.?0+$/, '');
}
