/** One hour in milliseconds. Custom launch windows are entered in hours. */
export const HOUR_MS = 3_600_000

export type LaunchPreset = {
  id: string
  label: string
  /** Length from the pool start. */
  ms: number
}

/** Windows that begin at pool Init (or the earliest trade). */
export const LAUNCH_PRESETS: LaunchPreset[] = [
  { id: "5m", label: "5min", ms: 5 * 60_000 },
  { id: "15m", label: "15min", ms: 15 * 60_000 },
  { id: "1h", label: "1h", ms: HOUR_MS },
  { id: "2h", label: "2h", ms: 2 * HOUR_MS },
  { id: "3h", label: "3h", ms: 3 * HOUR_MS },
  { id: "6h", label: "6h", ms: 6 * HOUR_MS },
  { id: "12h", label: "12h", ms: 12 * HOUR_MS },
  { id: "24h", label: "24h", ms: 24 * HOUR_MS },
]

/**
 * Inclusive window measured from pool init.
 * Offsets may arrive reversed (end before start).
 */
export function launchWindowMs(
  originMs: number,
  startOffsetMs: number,
  endOffsetMs: number,
): { startMs: number; endMs: number } {
  const lo = Math.min(startOffsetMs, endOffsetMs)
  const hi = Math.max(startOffsetMs, endOffsetMs)
  return { startMs: originMs + lo, endMs: originMs + hi }
}

/** Hours from the pool start. Blank, negative, or non-numeric is invalid. */
export function parseLaunchHours(raw: string): number | null {
  const text = raw.trim().replace(/h$/i, "")
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return null
  const value = Number(text)
  if (!Number.isFinite(value) || value < 0) return null
  return value
}

export function hoursToMs(hours: number): number {
  return Math.round(hours * HOUR_MS)
}

function formatOffset(ms: number): string | null {
  if (ms < 0) return null
  if (ms % HOUR_MS === 0) return `${ms / HOUR_MS}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}min`
  return null
}

/** Short label for a window anchored at the pool start, or null if it is not. */
export function describeLaunchWindow(originMs: number, startMs: number, endMs: number): string | null {
  const startLabel = formatOffset(startMs - originMs)
  const endLabel = formatOffset(endMs - originMs)
  if (!startLabel || !endLabel) return null
  if (startMs === originMs) return `First ${endLabel}`
  return `${startLabel} to ${endLabel} from pool start`
}
