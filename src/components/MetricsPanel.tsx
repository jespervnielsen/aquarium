import type { MetricFamily } from '../utils/prometheusParser';
import { deriveFishData, colorToCSS } from '../utils/fishUtils';

interface MetricsPanelProps {
  families: MetricFamily[];
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

export function MetricsPanel({ families, loading, error, lastFetch }: MetricsPanelProps) {
  const fishList = deriveFishData(families);

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

      {fishList.length > 0 && (
        <section className="fish-legend">
          <h4 className="fish-legend__title">Fish</h4>
          <ul className="fish-legend__list">
            {fishList.map((fish) => (
              <li key={fish.label} className="fish-legend__item">
                <span
                  className="fish-legend__swatch"
                  style={{
                    background: colorToCSS(fish.color),
                    opacity: fish.isUp ? 1 : 0.35,
                  }}
                />
                <span className="fish-legend__label" title={fish.label}>
                  {fish.label}
                </span>
                <span className={`fish-legend__status fish-legend__status--${fish.isUp ? 'up' : 'down'}`}>
                  {fish.isUp ? 'UP' : 'DOWN'}
                </span>
                {fish.value !== null && (
                  <span className="fish-legend__value">{formatValue(fish.value)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="visual-guide">
        <h4 className="visual-guide__title">Visual Guide</h4>
        <ul className="visual-guide__list">
          <li className="visual-guide__item">
            <span className="visual-guide__icon">🐟</span>
            <div className="visual-guide__text">
              <strong>Fish speed</strong>
              <span>
                Driven by <code>graphql_query_counter</code>. Queries with more traffic swim faster
                (0.5× – 2.5× base speed).
              </span>
            </div>
          </li>
          <li className="visual-guide__item">
            <span className="visual-guide__icon">👁</span>
            <div className="visual-guide__text">
              <strong>Fish opacity</strong>
              <span>
                Full opacity = service is <strong className="status-up">UP</strong>. Faded (35%) = service is{' '}
                <strong className="status-down">DOWN</strong> (<code>up</code> metric = 0).
              </span>
            </div>
          </li>
          <li className="visual-guide__item">
            <span className="visual-guide__icon">🪸</span>
            <div className="visual-guide__text">
              <strong>Coral colour</strong>
              <span>
                Corals are tinted orange-red by average HTTP latency (
                <code>http_request_duration_seconds</code>). Fully tinted at ≥ 2 s.
              </span>
            </div>
          </li>
        </ul>
      </section>

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
