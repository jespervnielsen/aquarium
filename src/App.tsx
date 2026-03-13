import { useState, useCallback, useEffect } from 'react';
import { AquariumCanvas } from './components/AquariumCanvas';
import { MetricsConfig, TEST_ENDPOINT_URL } from './components/MetricsConfig';
import { MetricsPanel } from './components/MetricsPanel';
import { TestMetricsControls, type TestScenarios } from './components/TestMetricsControls';
import { usePrometheusMetrics } from './hooks/usePrometheusMetrics';
import { useTestMetrics } from './hooks/useTestMetrics';
import { useContainerTracker } from './hooks/useContainerTracker';
import { useErrorTracker } from './hooks/useErrorTracker';
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

  // In test mode the simulator runs entirely in the browser so that scenario
  // toggles work on static hosts (e.g. GitHub Pages) where the dev-server
  // middleware that handles query-parameter flags is absent.
  const testMetricsState = useTestMetrics(testScenarios, pollInterval * 1000, isTestMode);

  // When in test mode pass an empty string so usePrometheusMetrics stays idle.
  const liveMetricsState = usePrometheusMetrics(
    isTestMode ? '' : metricsUrl,
    pollInterval * 1000
  );

  const { families, loading, error, lastFetch } = isTestMode ? testMetricsState : liveMetricsState;

  const containers = useContainerTracker(families);
  const hasErrors = useErrorTracker(families);

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
      const sidebarW = 280;
      const hPadding = 48; // 16px container padding × 2 + 16px gap
      const vPadding = 120; // header + top/bottom padding
      const w = Math.max(400, window.innerWidth - sidebarW - hPadding);
      const maxH = window.innerHeight - vPadding;
      const h = Math.max(300, Math.min(maxH, Math.round(w * 0.65)));
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
            speedMultiplier={isTestMode && testScenarios.trafficSpike ? 3.0 : 1.0}
            containers={containers}
            hasErrors={hasErrors}
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
          containers={containers}
        />
      </main>
    </div>
  );
}

export default App;
