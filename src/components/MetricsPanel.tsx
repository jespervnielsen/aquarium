import type { MetricFamily } from '../utils/prometheusParser';
import { deriveFishData, colorToCSS, type FishPattern } from '../utils/fishUtils';

/** Returns a CSS backgroundImage value that overlays the given pattern on a solid colour swatch. */
function patternToCSS(pattern: FishPattern): string {
  switch (pattern) {
    case 'stripes':
      return 'repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 4px)';
    case 'spots':
      return (
        'radial-gradient(circle at 30% 40%, rgba(0,0,0,0.4) 22%, transparent 22%), ' +
        'radial-gradient(circle at 70% 65%, rgba(0,0,0,0.4) 22%, transparent 22%)'
      );
    case 'patch':
      return 'linear-gradient(135deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.35) 45%, transparent 45%)';
    case 'bands':
      return 'repeating-linear-gradient(90deg, transparent 0px, transparent 3px, rgba(0,0,0,0.35) 3px, rgba(0,0,0,0.35) 5px)';
    case 'plain':
    default:
      return 'none';
  }
}

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
                    backgroundColor: colorToCSS(fish.color),
                    backgroundImage: patternToCSS(fish.pattern),
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
