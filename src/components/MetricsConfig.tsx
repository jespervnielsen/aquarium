import { useState } from 'react';

export const TEST_ENDPOINT_URL = `${import.meta.env.BASE_URL}dev/metrics`;

interface MetricsConfigProps {
  url: string;
  interval: number;
  onSave: (url: string, interval: number) => void;
}

export function MetricsConfig({ url, interval, onSave }: MetricsConfigProps) {
  const [draftUrl, setDraftUrl] = useState(url === TEST_ENDPOINT_URL ? '' : url);
  const [draftInterval, setDraftInterval] = useState(interval);
  const [open, setOpen] = useState(!url);
  const [useTestEndpoint, setUseTestEndpoint] = useState(url === TEST_ENDPOINT_URL);
  // Remembers the last custom URL so it can be restored when unchecking the test endpoint.
  const [prevCustomUrl, setPrevCustomUrl] = useState(url === TEST_ENDPOINT_URL ? '' : url);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalUrl = useTestEndpoint ? TEST_ENDPOINT_URL : draftUrl.trim();
    onSave(finalUrl, draftInterval);
    setOpen(false);
  }

  function handleTestEndpointToggle(checked: boolean) {
    if (checked) {
      setPrevCustomUrl(draftUrl.trim());
      setDraftUrl('');
    } else {
      setDraftUrl(prevCustomUrl);
    }
    setUseTestEndpoint(checked);
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
        <label className="config-checkbox-label">
          <input
            type="checkbox"
            checked={useTestEndpoint}
            onChange={(e) => handleTestEndpointToggle(e.target.checked)}
            className="config-checkbox"
          />
          Use built-in test endpoint
        </label>
        {useTestEndpoint ? (
          <p className="config-test-note">
            The built-in simulator (<code>{TEST_ENDPOINT_URL}</code>) will be used. You can
            activate test scenarios (traffic spikes, errors, etc.) directly from the main view.
          </p>
        ) : (
          <>
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
          </>
        )}
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
