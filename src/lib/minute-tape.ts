import { formatParts, isoToParts, type DateTimeParts } from "./timezone"
import type { Trade } from "./types"

export type MinuteRow = {
  no: number
  /** Inclusive start of the minute bucket (seconds floored). */
  start: DateTimeParts
  /** Exclusive end of the minute bucket (= start + 1 minute), for display. */
  end: DateTimeParts
  startMs: number
  endMs: number
  buyCount: number
  sellCount: number
  /** Average seconds between buys in this minute (60 / buys), or null if none. */
  avgBuySpeedSec: number | null
  avgSellSpeedSec: number | null
  /** Pool quote reserve at the open of this minute (carry from prior end). */
  startQuoteReserve: string | null
  endQuoteReserve: string | null
  startMarketCapUsd: string | null
  endMarketCapUsd: string | null
  startPriceUsd: string | null
  endPriceUsd: string | null
  startHolders: number | null
  endHolders: number | null
}

type Snapshot = {
  quoteReserve: string | null
  marketCapUsd: string | null
  priceUsd: string | null
  holders: number | null
}

const MINUTE_MS = 60_000

/** Floor an ISO timestamp to the start of its UTC minute. */
export function floorToMinuteMs(iso: string): number | null {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return null
  return Math.floor(time / MINUTE_MS) * MINUTE_MS
}

export function averageSpeedSec(count: number): number | null {
  if (count <= 0) return null
  return Math.round(MINUTE_MS / 1000 / count)
}

export function formatSpeed(seconds: number | null): string {
  if (seconds === null) return "—"
  return `${seconds}s`
}

/** "Oct 26 26 12:20" — minute label without seconds. */
export function formatMinuteLabel(value: DateTimeParts): string {
  const text = formatParts({ ...value, second: 0 })
  return text.replace(/:\d{2}$/, "")
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

/**
 * One row per minute from the earliest trade's minute through the latest trade's
 * minute (inclusive empty minutes). Only BUY/SELL count toward the tallies.
 * Start/end pool, mcap, price, and holders carry forward from the last known trade state.
 */
export function buildMinuteTape(trades: Trade[], zone: string): MinuteRow[] {
  let earliest = Number.POSITIVE_INFINITY
  let latest = Number.NEGATIVE_INFINITY
  const buys = new Map<number, number>()
  const sells = new Map<number, number>()
  const byMinute = new Map<number, Trade[]>()

  for (const trade of trades) {
    const bucket = floorToMinuteMs(trade.timestamp)
    if (bucket === null) continue
    if (bucket < earliest) earliest = bucket
    if (bucket > latest) latest = bucket
    if (trade.type === "BUY") buys.set(bucket, (buys.get(bucket) ?? 0) + 1)
    else if (trade.type === "SELL") sells.set(bucket, (sells.get(bucket) ?? 0) + 1)
    const list = byMinute.get(bucket)
    if (list) list.push(trade)
    else byMinute.set(bucket, [trade])
  }

  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return []

  for (const list of byMinute.values()) list.sort(compareChrono)

  const rows: MinuteRow[] = []
  let no = 1
  let state: Snapshot = { quoteReserve: null, marketCapUsd: null, priceUsd: null, holders: null }
  for (let startMs = earliest; startMs <= latest; startMs += MINUTE_MS) {
    const endMs = startMs + MINUTE_MS
    const startParts = isoToParts(new Date(startMs).toISOString(), zone)
    const endParts = isoToParts(new Date(endMs).toISOString(), zone)
    if (!startParts || !endParts) continue
    const buyCount = buys.get(startMs) ?? 0
    const sellCount = sells.get(startMs) ?? 0
    const startQuoteReserve = state.quoteReserve
    const startMarketCapUsd = state.marketCapUsd
    const startPriceUsd = state.priceUsd
    const startHolders = state.holders
    for (const trade of byMinute.get(startMs) ?? []) {
      state = applyTrade(state, trade)
    }
    rows.push({
      no,
      start: { ...startParts, second: 0 },
      end: { ...endParts, second: 0 },
      startMs,
      endMs,
      buyCount,
      sellCount,
      avgBuySpeedSec: averageSpeedSec(buyCount),
      avgSellSpeedSec: averageSpeedSec(sellCount),
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
