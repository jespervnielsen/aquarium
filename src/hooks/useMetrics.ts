import { useState, useEffect, useRef, useCallback } from 'react';
import { parsePrometheusText, MetricFamily, getMetricValue, sumMetricValues } from '../lib/prometheusParser';

export interface AquariumMetrics {
  /** 0–1: normalised CPU usage */
  cpuUsage: number;
  /** 0–1: normalised memory usage */
  memoryUsage: number;
  /** Requests per second */
  requestRate: number;
  /** Errors per second */
  errorRate: number;
  /** Number of active goroutines / threads */
  goroutines: number;
  /** Raw families for advanced use */
  raw: MetricFamily[];
}

export interface UseMetricsOptions {
  /** Prometheus /metrics URL (default: http://localhost:9090/metrics) */
  url?: string;
  /** Polling interval in ms (default: 5000) */
  interval?: number;
}

export interface UseMetricsResult {
  metrics: AquariumMetrics | null;
  error: string | null;
  loading: boolean;
  lastUpdated: Date | null;
}

const DEFAULT_URL = 'http://localhost:9090/metrics';
const DEFAULT_INTERVAL = 5000;

function deriveMetrics(families: MetricFamily[]): AquariumMetrics {
  // CPU — try common exporters in order
  const cpuSecondsTotal =
    sumMetricValues(families, 'node_cpu_seconds_total') ||
    sumMetricValues(families, 'process_cpu_seconds_total');

  // Normalise to 0-1. node_cpu_seconds_total can be very large so we cap.
  const cpuUsage = Math.min(cpuSecondsTotal / 100, 1);

  // Memory
  const memTotal =
    getMetricValue(families, 'node_memory_MemTotal_bytes') ?? 0;
  const memAvailable =
    getMetricValue(families, 'node_memory_MemAvailable_bytes') ?? 0;
  const processMemory =
    getMetricValue(families, 'process_resident_memory_bytes') ?? 0;
  const goMemory =
    getMetricValue(families, 'go_memstats_alloc_bytes') ?? 0;

  let memoryUsage = 0;
  if (memTotal > 0) {
    memoryUsage = Math.min((memTotal - memAvailable) / memTotal, 1);
  } else if (processMemory > 0) {
    // Scale 0–2GB
    memoryUsage = Math.min(processMemory / (2 * 1024 * 1024 * 1024), 1);
  } else if (goMemory > 0) {
    memoryUsage = Math.min(goMemory / (512 * 1024 * 1024), 1);
  }

  // Request rate — try common metrics
  const httpRequests =
    sumMetricValues(families, 'http_requests_total') ||
    sumMetricValues(families, 'prometheus_http_requests_total') ||
    sumMetricValues(families, 'grpc_server_handled_total');
  const requestRate = Math.min(httpRequests / 1000, 100);

  // Error rate
  let errorRate = 0;
  for (const family of families) {
    for (const sample of family.samples) {
      if (
        sample.name === 'http_requests_total' &&
        (sample.labels['status']?.startsWith('5') ||
          sample.labels['code']?.startsWith('5'))
      ) {
        errorRate += sample.value;
      }
    }
  }
  errorRate = Math.min(errorRate / 100, 1);

  // Goroutines
  const goroutines =
    getMetricValue(families, 'go_goroutines') ??
    getMetricValue(families, 'process_num_threads') ??
    0;

  return {
    cpuUsage,
    memoryUsage,
    requestRate,
    errorRate,
    goroutines,
    raw: families,
  };
}

export function useMetrics({
  url = DEFAULT_URL,
  interval = DEFAULT_INTERVAL,
}: UseMetricsOptions = {}): UseMetricsResult {
  const [metrics, setMetrics] = useState<AquariumMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchMetrics = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'text/plain; version=0.0.4' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const text = await response.text();
      const families = parsePrometheusText(text);
      setMetrics(deriveMetrics(families));
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    fetchMetrics();
    const id = setInterval(fetchMetrics, interval);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchMetrics, interval]);

  return { metrics, error, loading, lastUpdated };
}
