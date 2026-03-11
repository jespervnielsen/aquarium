import { useState } from 'react';
import { useMetrics } from './hooks/useMetrics';
import { AquariumCanvas } from './components/AquariumCanvas';
import { MetricsOverlay } from './components/MetricsOverlay';
import { MetricsConfig } from './components/MetricsConfig';
import './App.css';

export default function App() {
  const [url, setUrl] = useState('http://localhost:9090/metrics');
  const [interval, setIntervalMs] = useState(5000);

  const { metrics, error, lastUpdated } = useMetrics({ url, interval });

  const handleConfigSave = (newUrl: string, newInterval: number) => {
    setUrl(newUrl);
    setIntervalMs(newInterval);
  };

  return (
    <div className="app">
      <AquariumCanvas metrics={metrics} />
      <MetricsOverlay metrics={metrics} error={error} lastUpdated={lastUpdated} />
      <MetricsConfig url={url} interval={interval} onSave={handleConfigSave} />
    </div>
  );
}
