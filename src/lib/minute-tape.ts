import { formatParts, isoToParts, type DateTimeParts } from "./timezone"
import type { Trade } from "./types"

export type MinuteRow = {
  no: number
  /** Inclusive start of the bucket. */
  start: DateTimeParts
  /** Exclusive end of the bucket (= start + interval). */
  end: DateTimeParts
  startMs: number
  endMs: number
  buyCount: number
  sellCount: number
  /** Average seconds between buys in this bucket (intervalSec / buys), or null if none. */
  avgBuySpeedSec: number | null
  avgSellSpeedSec: number | null
  /** Pool quote reserve at the open of this bucket (carry from prior end). */
  startQuoteReserve: string | null
  endQuoteReserve: string | null
  startMarketCapUsd: string | null
  endMarketCapUsd: string | null
  startPriceUsd: string | null
  endPriceUsd: string | null
  startHolders: number | null
  endHolders: number | null
}

export type IntervalUnit = "sec" | "min" | "hour" | "d"

export type IntervalPreset = {
  id: string
  label: string
  ms: number
}

export const INTERVAL_PRESETS: IntervalPreset[] = [
  { id: "12s", label: "12s", ms: 12_000 },
  { id: "1m", label: "1min", ms: 60_000 },
  { id: "5m", label: "5min", ms: 5 * 60_000 },
  { id: "30m", label: "30min", ms: 30 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "4h", label: "4h", ms: 4 * 60 * 60_000 },
  { id: "1d", label: "1d", ms: 24 * 60 * 60_000 },
]

export const DEFAULT_INTERVAL_MS = 60_000
/** Soft cap so short intervals over long tapes stay usable. */
export const MAX_INTERVAL_BUCKETS = 20_000

type Snapshot = {
  quoteReserve: string | null
  marketCapUsd: string | null
  priceUsd: string | null
  holders: number | null
}

export function intervalToMs(value: number, unit: IntervalUnit): number | null {
  if (!Number.isFinite(value) || value <= 0) return null
  const factor = unit === "sec" ? 1_000 : unit === "min" ? 60_000 : unit === "hour" ? 3_600_000 : 86_400_000
  const ms = Math.round(value * factor)
  return ms >= 1_000 ? ms : null
}

export function formatIntervalMs(ms: number): string {
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000}d`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}min`
  if (ms % 1_000 === 0) return `${ms / 1_000}s`
  return `${ms}ms`
}

/** Floor an ISO timestamp to the start of its interval bucket (UTC-aligned). */
export function floorToIntervalMs(iso: string, intervalMs: number): number | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time) || intervalMs <= 0) return null
  return Math.floor(time / intervalMs) * intervalMs
}

/** @deprecated Prefer floorToIntervalMs — kept for older call sites/tests. */
export function floorToMinuteMs(iso: string): number | null {
  return floorToIntervalMs(iso, 60_000)
}

export function averageSpeedSec(count: number, intervalMs = 60_000): number | null {
  if (count <= 0 || intervalMs <= 0) return null
  return intervalMs / 1000 / count
}

/** "8.57 (7 count)" — seconds between events and how many events in the bucket. */
export function formatSpeed(seconds: number | null, count = 0): string {
  if (seconds === null || count <= 0) return "—"
  return `${seconds.toFixed(2)} (${count} count)`
}

/** Bucket start/end label; keeps seconds when the interval is sub-minute. */
export function formatBucketLabel(value: DateTimeParts, intervalMs: number): string {
  const text = formatParts(value)
  if (intervalMs >= 60_000 && value.second === 0) {
    return text.replace(/:\d{2}$/, "")
  }
  return text
}

/** @deprecated Prefer formatBucketLabel. */
export function formatMinuteLabel(value: DateTimeParts): string {
  return formatBucketLabel(value, 60_000)
}

function applyTrade(state: Snapshot, trade: Trade): Snapshot {
  return {
    quoteReserve: trade.quoteReserve ?? state.quoteReserve,
    marketCapUsd: trade.marketCapUsd ?? state.marketCapUsd,
    priceUsd: trade.priceUsd ?? state.priceUsd,
    holders: trade.holders !== null ? trade.holders : state.holders,
  }
}

function compareChrono(a: Trade, b: Trade): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
  if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex
  return a.timestamp.localeCompare(b.timestamp)
}

export function estimateBucketCount(trades: Trade[], intervalMs: number): number {
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  for (const trade of trades) {
    const bucket = floorToIntervalMs(trade.timestamp, intervalMs)
    if (bucket === null) continue
    if (bucket < earliest) earliest = bucket
    if (bucket > latest) latest = bucket
  }
  if (!Number.isFinite(earliest) || !Number.isFinite(latest) || intervalMs <= 0) return 0
  return Math.floor((latest - earliest) / intervalMs) + 1
}

/**
 * One row per interval bucket from the earliest trade through the latest
 * (inclusive empty buckets). Only BUY/SELL count toward the tallies.
 */
export function buildIntervalTape(trades: Trade[], zone: string, intervalMs = DEFAULT_INTERVAL_MS): MinuteRow[] {
  if (intervalMs < 1_000) return []
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  const buys = new Map<number, number>()
  const sells = new Map<number, number>()
  const byBucket = new Map<number, Trade[]>()

  for (const trade of trades) {
    const bucket = floorToIntervalMs(trade.timestamp, intervalMs)
    if (bucket === null) continue
    if (bucket < earliest) earliest = bucket
    if (bucket > latest) latest = bucket
    if (trade.type === "BUY") buys.set(bucket, (buys.get(bucket) ?? 0) + 1)
    else if (trade.type === "SELL") sells.set(bucket, (sells.get(bucket) ?? 0) + 1)
    const list = byBucket.get(bucket)
    if (list) list.push(trade)
    else byBucket.set(bucket, [trade])
  }

  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return []

  const bucketCount = Math.floor((latest - earliest) / intervalMs) + 1
  if (bucketCount > MAX_INTERVAL_BUCKETS) return []

  for (const list of byBucket.values()) list.sort(compareChrono)

  const rows: MinuteRow[] = []
  let no = 1
  let state: Snapshot = { quoteReserve: null, marketCapUsd: null, priceUsd: null, holders: null }
  for (let startMs = earliest; startMs <= latest; startMs += intervalMs) {
    const endMs = startMs + intervalMs
    const startParts = isoToParts(new Date(startMs).toISOString(), zone)
    const endParts = isoToParts(new Date(endMs).toISOString(), zone)
    if (!startParts || !endParts) continue
    const buyCount = buys.get(startMs) ?? 0
    const sellCount = sells.get(startMs) ?? 0
    const startQuoteReserve = state.quoteReserve
    const startMarketCapUsd = state.marketCapUsd
    const startPriceUsd = state.priceUsd
    const startHolders = state.holders
    for (const trade of byBucket.get(startMs) ?? []) {
      state = applyTrade(state, trade)
    }
    rows.push({
      no,
      start: startParts,
      end: endParts,
      startMs,
      endMs,
      buyCount,
      sellCount,
      avgBuySpeedSec: averageSpeedSec(buyCount, intervalMs),
      avgSellSpeedSec: averageSpeedSec(sellCount, intervalMs),
      startQuoteReserve,
      endQuoteReserve: state.quoteReserve,
      startMarketCapUsd,
      endMarketCapUsd: state.marketCapUsd,
      startPriceUsd,
      endPriceUsd: state.priceUsd,
      startHolders,
      endHolders: state.holders,
    })
    no += 1
  }
  return rows
}

/** @deprecated Prefer buildIntervalTape. */
export function buildMinuteTape(trades: Trade[], zone: string): MinuteRow[] {
  return buildIntervalTape(trades, zone, 60_000)
}
