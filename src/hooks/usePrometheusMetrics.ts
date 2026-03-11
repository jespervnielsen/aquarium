import { useState, useEffect, useCallback, useRef } from 'react';
import { parsePrometheusText, type MetricFamily } from '../utils/prometheusParser';

export interface MetricsState {
  families: MetricFamily[];
  loading: boolean;
  error: string | null;
  lastFetch: Date | null;
}

const DEFAULT_INTERVAL_MS = 10_000;

export function usePrometheusMetrics(
  url: string,
  intervalMs: number = DEFAULT_INTERVAL_MS
): MetricsState {
  const [state, setState] = useState<MetricsState>({
    families: [],
    loading: false,
    error: null,
    lastFetch: null,
  });

  const urlRef = useRef(url);
  urlRef.current = url;

  const fetchMetrics = useCallback(async () => {
    const currentUrl = urlRef.current;
    if (!currentUrl) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(currentUrl, {
        headers: { Accept: 'text/plain; version=0.0.4' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      const families = parsePrometheusText(text);
      setState({ families, loading: false, error: null, lastFetch: new Date() });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        lastFetch: new Date(),
      }));
    }
  }, []);

  // Re-fetch whenever URL changes
  useEffect(() => {
    if (!url) {
      setState({ families: [], loading: false, error: null, lastFetch: null });
      return;
    }
    fetchMetrics();
    const id = setInterval(fetchMetrics, intervalMs);
    return () => clearInterval(id);
  }, [url, intervalMs, fetchMetrics]);

  return state;
}
