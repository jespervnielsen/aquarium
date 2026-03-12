import { describe, it, expect } from 'vitest'
import { applyContainerUpdate, DEFAULT_CONTAINER_TIMEOUT_MS } from './useContainerTracker'
import type { MetricFamily } from '../utils/prometheusParser'

/** Build a minimal MetricFamily containing a single process_start_time_seconds sample. */
function makeStartTimeFamily(startTimeSec: number): MetricFamily {
  return {
    name: 'process_start_time_seconds',
    help: 'Start time of the process since unix epoch in seconds.',
    type: 'gauge',
    samples: [{ name: 'process_start_time_seconds', labels: {}, value: startTimeSec }],
  }
}

describe('DEFAULT_CONTAINER_TIMEOUT_MS', () => {
  it('is 5 minutes', () => {
    expect(DEFAULT_CONTAINER_TIMEOUT_MS).toBe(5 * 60 * 1000)
  })
})

describe('applyContainerUpdate', () => {
  it('adds a container when process_start_time_seconds is present', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const now = Date.now()
    const records = applyContainerUpdate(map, [makeStartTimeFamily(1_710_000_000)], now, 300_000)

    expect(records).toHaveLength(1)
    expect(records[0].id).toBe('1710000000')
    expect(records[0].startTime).toBe(1_710_000_000)
    expect(records[0].lastSeen).toBe(now)
    expect(records[0].isUp).toBe(true)
  })

  it('does not add a container when no process_start_time_seconds family is present', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const records = applyContainerUpdate(map, [], Date.now(), 300_000)
    expect(records).toHaveLength(0)
  })

  it('ignores families without process_start_time_seconds', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const unrelated: MetricFamily = {
      name: 'some_other_metric',
      help: '',
      type: 'counter',
      samples: [{ name: 'some_other_metric', labels: {}, value: 42 }],
    }
    const records = applyContainerUpdate(map, [unrelated], Date.now(), 300_000)
    expect(records).toHaveLength(0)
  })

  it('marks a container as down after the timeout has elapsed', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const startTime = 1_710_000_000
    const id = String(startTime)
    // Container was last seen 6 minutes ago — beyond the 5-minute timeout.
    map.set(id, { startTime, lastSeen: Date.now() - 6 * 60 * 1000 })

    const records = applyContainerUpdate(map, [], Date.now(), 300_000)
    expect(records).toHaveLength(1)
    expect(records[0].isUp).toBe(false)
  })

  it('keeps a container as up when last seen within the timeout window', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const startTime = 1_710_000_000
    const id = String(startTime)
    // Container was last seen 2 minutes ago — within the 5-minute timeout.
    map.set(id, { startTime, lastSeen: Date.now() - 2 * 60 * 1000 })

    const records = applyContainerUpdate(map, [], Date.now(), 300_000)
    expect(records[0].isUp).toBe(true)
  })

  it('tracks multiple containers from successive calls', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const now = Date.now()

    applyContainerUpdate(map, [makeStartTimeFamily(1_710_000_000)], now, 300_000)
    const records = applyContainerUpdate(map, [makeStartTimeFamily(1_710_001_000)], now, 300_000)

    expect(records).toHaveLength(2)
    expect(records.every((r) => r.isUp)).toBe(true)
  })

  it('updates lastSeen when the same container is polled again', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const startTime = 1_710_000_000
    const id = String(startTime)
    const oldLastSeen = Date.now() - 60_000
    map.set(id, { startTime, lastSeen: oldLastSeen })

    const newNow = Date.now()
    applyContainerUpdate(map, [makeStartTimeFamily(startTime)], newNow, 300_000)

    expect(map.get(id)!.lastSeen).toBe(newNow)
  })

  it('sorts records by startTime ascending', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const now = Date.now()
    map.set('3000', { startTime: 3000, lastSeen: now })
    map.set('1000', { startTime: 1000, lastSeen: now })
    map.set('2000', { startTime: 2000, lastSeen: now })

    const records = applyContainerUpdate(map, [], now, 300_000)
    expect(records.map((r) => r.startTime)).toEqual([1000, 2000, 3000])
  })

  it('a previously down container is revived when seen again', () => {
    const map = new Map<string, { startTime: number; lastSeen: number }>()
    const startTime = 1_710_000_000
    const id = String(startTime)
    // Mark as down by putting stale lastSeen.
    map.set(id, { startTime, lastSeen: Date.now() - 10 * 60 * 1000 })

    const now = Date.now()
    const records = applyContainerUpdate(map, [makeStartTimeFamily(startTime)], now, 300_000)

    expect(records[0].isUp).toBe(true)
    expect(records[0].lastSeen).toBe(now)
  })
})
