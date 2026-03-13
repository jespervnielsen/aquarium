import { useState, useEffect, useRef } from 'react'
import type { MetricFamily } from '../utils/prometheusParser'

/** Duration in milliseconds to keep the predator fish visible after the last error. */
const ERROR_VISIBILITY_MS = 60_000

/**
 * Tracks the `graphql_request_error_total` counter across metric polls and
 * returns `true` for {@link ERROR_VISIBILITY_MS} after any increase is
 * detected.
 *
 * @param families - Metric families from the latest poll.
 */
export function useErrorTracker(families: MetricFamily[]): boolean {
  const prevTotalRef = useRef(0)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [hasErrors, setHasErrors] = useState(false)

  useEffect(() => {
    const errorFamily = families.find((f) => f.name === 'graphql_request_error_total')
    // Sum across all samples to handle multiple container instances
    const currentTotal = errorFamily?.samples.reduce((sum, s) => sum + s.value, 0) ?? 0

    function activate() {
      setHasErrors(true)
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => setHasErrors(false), ERROR_VISIBILITY_MS)
    }

    if (currentTotal > prevTotalRef.current) {
      prevTotalRef.current = currentTotal
      activate()
    }
  }, [families])

  return hasErrors
}
