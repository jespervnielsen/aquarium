import { useState } from 'react';

interface MetricsConfigProps {
  url: string;
  interval: number;
  onSave: (url: string, interval: number) => void;
}

export function MetricsConfig({ url, interval, onSave }: MetricsConfigProps) {
  const [draftUrl, setDraftUrl] = useState(url);
  const [draftInterval, setDraftInterval] = useState(interval);
  const [open, setOpen] = useState(!url);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(draftUrl.trim(), draftInterval);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        className="config-toggle"
        onClick={() => setOpen(true)}
        title="Configure metrics endpoint"
        aria-label="Configure metrics endpoint"
      >
        ⚙️ Configure
      </button>
    );
  }

  return (
    <div className="config-panel" role="dialog" aria-label="Metrics configuration">
      <h2>Configure Metrics Endpoint</h2>
      <p className="config-note">
        Enter a Prometheus <code>/metrics</code> URL. The endpoint must be accessible from your
        browser (CORS headers required). For local testing, start Prometheus or a metrics exporter
        with CORS enabled.
      </p>
      <form onSubmit={handleSubmit} className="config-form">
        <label htmlFor="metrics-url">Prometheus metrics URL</label>
        <input
          id="metrics-url"
          type="url"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          placeholder="http://localhost:9090/metrics"
          className="config-input"
          autoFocus
        />
        <label htmlFor="poll-interval">Poll interval (seconds)</label>
        <input
          id="poll-interval"
          type="number"
          min={1}
          max={300}
          value={draftInterval}
          onChange={(e) => setDraftInterval(Number(e.target.value))}
          className="config-input config-input--narrow"
        />
        <div className="config-actions">
          <button type="submit" className="btn btn--primary">
            Save
          </button>
          {url && (
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
