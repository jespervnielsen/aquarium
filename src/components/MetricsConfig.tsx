import { useState, FormEvent } from 'react';

interface MetricsConfigProps {
  url: string;
  interval: number;
  onSave: (url: string, interval: number) => void;
}

export function MetricsConfig({ url, interval, onSave }: MetricsConfigProps) {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(url);
  const [intervalInput, setIntervalInput] = useState(String(interval));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const ms = Math.max(1000, parseInt(intervalInput, 10) || 5000);
    onSave(urlInput.trim(), ms);
    setOpen(false);
  };

  return (
    <div className="config-widget">
      <button className="config-btn" onClick={() => setOpen((o) => !o)}>
        ⚙ Settings
      </button>
      {open && (
        <form className="config-panel" onSubmit={handleSubmit}>
          <label>
            Metrics URL
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:9090/metrics"
            />
          </label>
          <label>
            Poll interval (ms)
            <input
              type="number"
              min={1000}
              step={500}
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
            />
          </label>
          <button type="submit">Apply</button>
        </form>
      )}
    </div>
  );
}
