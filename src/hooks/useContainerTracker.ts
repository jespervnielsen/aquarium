import { useState, useRef, useEffect } from 'react'
import type { MetricFamily } from '../utils/prometheusParser'

/** Default inactivity window after which a container is considered down (5 minutes). */
export const DEFAULT_CONTAINER_TIMEOUT_MS = 5 * 60 * 1000

/** A tracked container instance identified by its process_start_time_seconds. */
export interface ContainerRecord {
  /** Unique identifier: the process_start_time_seconds value serialised as a string. */
  id: string
  /** Unix epoch seconds when the container process started. */
  startTime: number
  /** Date.now() milliseconds when this container was last observed in a poll. */
  lastSeen: number
  /** Whether the container was seen within the timeout window. */
  isUp: boolean
}

/**
 * Pure function that updates a container map from a new batch of metric families
 * and returns the updated list of ContainerRecord, sorted by startTime ascending.
 *
 * Exported for unit testing.
 *
 * @param map       - In-memory map of known containers (mutated in place).
 * @param families  - Metric families from the latest poll (may be empty for expiry-only checks).
 * @param now       - Current time as Date.now().
 * @param timeoutMs - Inactivity timeout in milliseconds.
 */
export function applyContainerUpdate(
  map: Map<string, { startTime: number; lastSeen: number }>,
  families: MetricFamily[],
  now: number,
  timeoutMs: number,
): ContainerRecord[] {
  const startTimeFamily = families.find((f) => f.name === 'process_start_time_seconds')
  if (startTimeFamily && startTimeFamily.samples.length > 0) {
    const startTime = startTimeFamily.samples[0].value
    const id = String(startTime)
    map.set(id, { startTime, lastSeen: now })
  }

  return Array.from(map.entries())
    .map(([id, { startTime, lastSeen }]) => ({
      id,
      startTime,
      lastSeen,
      isUp: now - lastSeen < timeoutMs,
    }))
    .sort((a, b) => a.startTime - b.startTime)
}

/**
 * React hook that tracks container instances by observing
 * `process_start_time_seconds` in successive metric polls.
 *
 * Each unique value of `process_start_time_seconds` is treated as one container.
 * A container is marked as **down** once it has not appeared in any poll for
 * longer than `timeoutMs` milliseconds.  A periodic background check (every 30 s)
 * ensures containers are expired even when polling stops.
 *
 * @param families  - Metric families from the latest poll.
 * @param timeoutMs - Inactivity timeout in milliseconds (default: 5 minutes).
 */
export function useContainerTracker(
  families: MetricFamily[],
  timeoutMs: number = DEFAULT_CONTAINER_TIMEOUT_MS,
): ContainerRecord[] {
  const mapRef = useRef(new Map<string, { startTime: number; lastSeen: number }>())

  const [records, setRecords] = useState<ContainerRecord[]>([])

  // Update container state whenever new metrics arrive.
  useEffect(() => {
    if (families.length === 0) return
    const now = Date.now()
    setRecords(applyContainerUpdate(mapRef.current, families, now, timeoutMs))
  }, [families, timeoutMs])

  // Periodic expiry check so containers time out even when polling stops.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now()
      setRecords(applyContainerUpdate(mapRef.current, [], now, timeoutMs))
    }, 30_000)
    return () => clearInterval(id)
  }, [timeoutMs])

  return records
}
