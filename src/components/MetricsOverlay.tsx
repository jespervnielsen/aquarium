import { AquariumMetrics } from '../hooks/useMetrics';

interface MetricsOverlayProps {
  metrics: AquariumMetrics | null;
  error: string | null;
  lastUpdated: Date | null;
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="metric-bar-track">
      <div
        className="metric-bar-fill"
        style={{ width: `${Math.round(value * 100)}%`, background: color }}
      />
    </div>
  );
}

export function MetricsOverlay({ metrics, error, lastUpdated }: MetricsOverlayProps) {
  return (
    <div className="metrics-overlay">
      <div className="metrics-title">🐠 Aquarium Metrics</div>
      {error && <div className="metrics-error">⚠ {error}</div>}
      {metrics ? (
        <div className="metrics-rows">
          <div className="metric-row">
            <span>CPU</span>
            <Bar value={metrics.cpuUsage} color="#ff7043" />
            <span className="metric-val">{(metrics.cpuUsage * 100).toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span>Memory</span>
            <Bar value={metrics.memoryUsage} color="#42a5f5" />
            <span className="metric-val">{(metrics.memoryUsage * 100).toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span>Req/s</span>
            <Bar value={Math.min(metrics.requestRate / 100, 1)} color="#66bb6a" />
            <span className="metric-val">{metrics.requestRate.toFixed(1)}</span>
          </div>
          <div className="metric-row">
            <span>Errors</span>
            <Bar value={metrics.errorRate} color="#ef5350" />
            <span className="metric-val">{(metrics.errorRate * 100).toFixed(1)}%</span>
          </div>
          <div className="metric-row">
            <span>Goroutines</span>
            <Bar value={Math.min(metrics.goroutines / 500, 1)} color="#ab47bc" />
            <span className="metric-val">{metrics.goroutines.toFixed(0)}</span>
          </div>
        </div>
      ) : (
        <div className="metrics-empty">Waiting for data…</div>
      )}
      {lastUpdated && (
        <div className="metrics-ts">
          Updated: {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
