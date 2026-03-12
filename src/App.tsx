import { useState, useCallback, useEffect, useMemo } from 'react';
import { AquariumCanvas } from './components/AquariumCanvas';
import { MetricsConfig, TEST_ENDPOINT_URL } from './components/MetricsConfig';
import { MetricsPanel } from './components/MetricsPanel';
import { TestMetricsControls, type TestScenarios } from './components/TestMetricsControls';
import { usePrometheusMetrics } from './hooks/usePrometheusMetrics';
import './App.css';

const STORAGE_KEY_URL = 'aquarium:metricsUrl';
const STORAGE_KEY_INTERVAL = 'aquarium:pollInterval';
const DEFAULT_INTERVAL = 10;

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors
  }
}

const DEFAULT_TEST_SCENARIOS: TestScenarios = {
  trafficSpike: false,
  breakingNewsSpike: false,
  dependencySlowdown: false,
  errorSpike: false,
};

function App() {
  const [metricsUrl, setMetricsUrl] = useState(() => readStorage(STORAGE_KEY_URL, ''));
  const [pollInterval, setPollInterval] = useState(() =>
    Number(readStorage(STORAGE_KEY_INTERVAL, String(DEFAULT_INTERVAL)))
  );
  const [testScenarios, setTestScenarios] = useState<TestScenarios>(DEFAULT_TEST_SCENARIOS);

  const isTestMode = metricsUrl === TEST_ENDPOINT_URL;

  const effectiveUrl = useMemo(() => {
    if (!isTestMode) return metricsUrl;
    const params = new URLSearchParams();
    if (testScenarios.trafficSpike) params.set('trafficSpike', '1');
    if (testScenarios.breakingNewsSpike) params.set('breakingNewsSpike', '1');
    if (testScenarios.dependencySlowdown) params.set('dependencySlowdown', '1');
    if (testScenarios.errorSpike) params.set('errorSpike', '1');
    const qs = params.toString();
    return qs ? `${TEST_ENDPOINT_URL}?${qs}` : TEST_ENDPOINT_URL;
  }, [isTestMode, metricsUrl, testScenarios]);

  const { families, loading, error, lastFetch } = usePrometheusMetrics(
    effectiveUrl,
    pollInterval * 1000
  );

  const handleSave = useCallback((url: string, interval: number) => {
    setMetricsUrl(url);
    setPollInterval(interval);
    writeStorage(STORAGE_KEY_URL, url);
    writeStorage(STORAGE_KEY_INTERVAL, String(interval));
    // Reset test scenarios when switching endpoints
    if (url !== TEST_ENDPOINT_URL) {
      setTestScenarios(DEFAULT_TEST_SCENARIOS);
    }
  }, []);

  // Window dimensions for responsive canvas
  const [canvasSize, setCanvasSize] = useState({ width: 900, height: 520 });
  useEffect(() => {
    function measure() {
      const panel = 280;
      const padding = 40;
      const w = Math.max(400, window.innerWidth - panel - padding);
      const h = Math.max(300, Math.round(w * 0.58));
      setCanvasSize({ width: w, height: h });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">🐠</span>
        <h1 className="app-title">Aquarium</h1>
        <p className="app-subtitle">Prometheus metrics visualisation</p>
        <MetricsConfig url={metricsUrl} interval={pollInterval} onSave={handleSave} />
        {isTestMode && (
          <TestMetricsControls scenarios={testScenarios} onChange={setTestScenarios} />
        )}
      </header>

      <main className="app-main">
        <section className="canvas-section">
          <AquariumCanvas
            families={families}
            width={canvasSize.width}
            height={canvasSize.height}
          />
          {!metricsUrl && (
            <div className="canvas-overlay">
              <p>Configure a Prometheus metrics endpoint to populate the aquarium 🐟</p>
            </div>
          )}
        </section>

        <MetricsPanel
          families={families}
          loading={loading}
          error={error}
          lastFetch={lastFetch}
        />
      </main>
    </div>
  );
}

export default App;
