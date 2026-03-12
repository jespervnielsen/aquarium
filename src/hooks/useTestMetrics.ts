import { useState, useEffect } from 'react';
import { parsePrometheusText } from '../utils/prometheusParser';
import { generateMetricsText } from '../dev/metricsSimulator';
import type { MetricsState } from './usePrometheusMetrics';
import type { TestScenarios } from '../components/TestMetricsControls';

/**
 * Hook that runs the metrics simulator directly in the browser.
 *
 * This makes test-scenario toggles work on any hosting environment — including
 * fully-static hosts such as GitHub Pages where the dev-server middleware that
 * normally handles the query-parameter-based scenario flags is unavailable.
 *
 * The effect is re-created whenever `scenarios` changes, so toggling a
 * checkbox triggers an immediate poll with the new scenario state rather than
 * waiting for the next scheduled interval.
 *
 * @param scenarios - Which simulation events to force active.
 * @param intervalMs - Polling interval in milliseconds (default 10 s).
 * @param enabled - When false the hook does nothing and clears its state.
 */
export function useTestMetrics(
  scenarios: TestScenarios,
  intervalMs: number = 10_000,
  enabled: boolean = true,
): MetricsState {
  const [state, setState] = useState<MetricsState>({
    families: [],
    loading: false,
    error: null,
    lastFetch: null,
  });

  useEffect(() => {
    if (!enabled) return;

    function poll() {
      const text = generateMetricsText(scenarios);
      const families = parsePrometheusText(text);
      setState({ families, loading: false, error: null, lastFetch: new Date() });
    }

    // Poll immediately so the UI updates as soon as a scenario is toggled.
    poll();
    const id = setInterval(poll, intervalMs);
    return () => clearInterval(id);
  // `scenarios` is intentionally included so that toggling a checkbox causes
  // an immediate poll with the updated options rather than waiting for the
  // next scheduled interval fire.
  }, [intervalMs, enabled, scenarios]);

  return state;
}
