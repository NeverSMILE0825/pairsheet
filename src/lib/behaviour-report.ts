import type { PoolView, Side, Trade } from "./types"

export type ReportWindowId =
  | "15m"
  | "1h"
  | "6h"
  | "12h"
  | "24h"
  | "48h"
  | "full"

export type ReportWindowDef = {
  id: ReportWindowId
  label: string
  /** Seconds from tape start; Infinity = full tape. */
  sec: number
}

export const REPORT_WINDOWS: ReportWindowDef[] = [
  { id: "15m", label: "first 15 minutes", sec: 15 * 60 },
  { id: "1h", label: "first 1 hour", sec: 60 * 60 },
  { id: "6h", label: "first 6 hours", sec: 6 * 60 * 60 },
  { id: "12h", label: "first 12 hours", sec: 12 * 60 * 60 },
  { id: "24h", label: "first 24 hours", sec: 24 * 60 * 60 },
  { id: "48h", label: "first 48 hours", sec: 48 * 60 * 60 },
  { id: "full", label: "full tape", sec: Number.POSITIVE_INFINITY },
]

/** Non-overlapping rings used to show how pace changed over time. */
export type SpeedSegmentDef = {
  id: string
  label: string
  fromSec: number
  toSec: number
}

export const SPEED_SEGMENTS: SpeedSegmentDef[] = [
  { id: "0-15m", label: "launch → 15 minutes", fromSec: 0, toSec: 15 * 60 },
  { id: "15m-1h", label: "15 minutes → 1 hour", fromSec: 15 * 60, toSec: 60 * 60 },
  { id: "1h-6h", label: "1 hour → 6 hours", fromSec: 60 * 60, toSec: 6 * 60 * 60 },
  { id: "6h-12h", label: "6 hours → 12 hours", fromSec: 6 * 60 * 60, toSec: 12 * 60 * 60 },
  { id: "12h-24h", label: "12 hours → 24 hours", fromSec: 12 * 60 * 60, toSec: 24 * 60 * 60 },
  { id: "24h-48h", label: "24 hours → 48 hours", fromSec: 24 * 60 * 60, toSec: 48 * 60 * 60 },
  { id: "48h-end", label: "after 48 hours → end", fromSec: 48 * 60 * 60, toSec: Number.POSITIVE_INFINITY },
]

export type WindowStats = {
  id: ReportWindowId
  label: string
  buys: number
  sells: number
  buyEthSum: number
  sellEthSum: number
  buyUsdSum: number
  sellUsdSum: number
  buyMedEth: number | null
  sellMedEth: number | null
  buyMedGapSec: number | null
  sellMedGapSec: number | null
  swapMedGapSec: number | null
  swapMaxGapSec: number | null
  buyPerHour: number | null
  sellPerHour: number | null
  buyMaxEth: number | null
  sellMaxEth: number | null
  longestPauseSec: number | null
  longestPauseStartIso: string | null
}

export type PauseEvent = {
  startIso: string
  endIso: string
  durationSec: number
  offsetSec: number
  afterType: Side
  beforeType: Side
}

export type SpeedSegment = {
  id: string
  label: string
  durationSec: number
  buys: number
  sells: number
  buyMedGapSec: number | null
  sellMedGapSec: number | null
  swapMedGapSec: number | null
  buyPerHour: number | null
  sellPerHour: number | null
  swapsPerHour: number | null
}

export type BehaviourReport = {
  baseSymbol: string
  quoteSymbol: string
  dex: string
  startIso: string
  endIso: string
  windows: WindowStats[]
  pauses: PauseEvent[]
  pauseThresholdSec: number
  speedSegments: SpeedSegment[]
  story: string
  paceStory: string
  pausesStory: string
}

function num(value: string | null | undefined): number | null {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

function gapsSec(trades: Trade[]): number[] {
  const times = trades.map((trade) => Date.parse(trade.timestamp)).sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 1; i < times.length; i++) out.push((times[i] - times[i - 1]) / 1000)
  return out
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function ratePerHour(count: number, durationSec: number): number | null {
  if (durationSec <= 0) return null
  return (count / durationSec) * 3600
}

/** Display helper: at most 2 decimal places. */
export function formatReportNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a"
  return round2(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

export function formatReportUsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a"
  return `$${formatReportNumber(value)}`
}

/** Human duration for pauses and offsets (seconds → s / m / h). */
export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "n/a"
  if (sec < 60) return `${formatReportNumber(sec)}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  if (h >= 48 && m === 0) return `${formatReportNumber(h / 24)}d`
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function isoLabel(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, " UTC").replace("T", " ")
}

function sortByTime(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    const ta = Date.parse(a.timestamp)
    const tb = Date.parse(b.timestamp)
    if (ta !== tb) return ta - tb
    return a.logIndex - b.logIndex
  })
}

function swapsOnly(trades: Trade[]): Trade[] {
  return sortByTime(trades.filter((trade) => trade.type === "BUY" || trade.type === "SELL"))
}

function windowStats(trades: Trade[], t0: number, t1: number, def: ReportWindowDef): WindowStats {
  const end = Number.isFinite(def.sec) ? Math.min(t0 + def.sec * 1000, t1) : t1
  const durationSec = Math.max(0, (end - t0) / 1000)
  const inWin = trades.filter((trade) => {
    const ts = Date.parse(trade.timestamp)
    return Number.isFinite(ts) && ts >= t0 && ts <= end
  })
  const buys = inWin
    .filter((trade) => trade.type === "BUY")
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const sells = inWin
    .filter((trade) => trade.type === "SELL")
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
  const swaps = swapsOnly(inWin)
  const buyEth = buys.map((trade) => num(trade.quoteAmount)).filter((n): n is number => n != null)
  const sellEth = sells.map((trade) => num(trade.quoteAmount)).filter((n): n is number => n != null)
  const buyUsd = buys.map((trade) => num(trade.totalUsd)).filter((n): n is number => n != null)
  const sellUsd = sells.map((trade) => num(trade.totalUsd)).filter((n): n is number => n != null)
  const swapGaps = gapsSec(swaps)
  const longestPauseSec = swapGaps.length ? Math.max(...swapGaps) : null
  let longestPauseStartIso: string | null = null
  if (longestPauseSec != null && swaps.length >= 2) {
    for (let i = 1; i < swaps.length; i++) {
      const gap = (Date.parse(swaps[i].timestamp) - Date.parse(swaps[i - 1].timestamp)) / 1000
      if (gap === longestPauseSec) {
        longestPauseStartIso = swaps[i - 1].timestamp
        break
      }
    }
  }
  return {
    id: def.id,
    label: def.label,
    buys: buys.length,
    sells: sells.length,
    buyEthSum: buyEth.reduce((a, b) => a + b, 0),
    sellEthSum: sellEth.reduce((a, b) => a + b, 0),
    buyUsdSum: buyUsd.reduce((a, b) => a + b, 0),
    sellUsdSum: sellUsd.reduce((a, b) => a + b, 0),
    buyMedEth: median(buyEth),
    sellMedEth: median(sellEth),
    buyMedGapSec: median(gapsSec(buys)),
    sellMedGapSec: median(gapsSec(sells)),
    swapMedGapSec: median(swapGaps),
    swapMaxGapSec: longestPauseSec,
    buyPerHour: ratePerHour(buys.length, durationSec),
    sellPerHour: ratePerHour(sells.length, durationSec),
    buyMaxEth: buyEth.length ? Math.max(...buyEth) : null,
    sellMaxEth: sellEth.length ? Math.max(...sellEth) : null,
    longestPauseSec,
    longestPauseStartIso,
  }
}

function speedSegmentStats(swaps: Trade[], t0: number, t1: number, def: SpeedSegmentDef): SpeedSegment | null {
  const from = t0 + def.fromSec * 1000
  if (from >= t1) return null
  const to = Number.isFinite(def.toSec) ? Math.min(t0 + def.toSec * 1000, t1) : t1
  if (to <= from) return null
  const durationSec = (to - from) / 1000
  const inSeg = swaps.filter((trade) => {
    const ts = Date.parse(trade.timestamp)
    return ts > from && ts <= to
  })
  // Include a trade exactly at t0 in the first segment.
  const withStart =
    def.fromSec === 0
      ? swaps.filter((trade) => {
          const ts = Date.parse(trade.timestamp)
          return ts >= from && ts <= to
        })
      : inSeg
  const buys = withStart.filter((trade) => trade.type === "BUY")
  const sells = withStart.filter((trade) => trade.type === "SELL")
  return {
    id: def.id,
    label: def.label,
    durationSec,
    buys: buys.length,
    sells: sells.length,
    buyMedGapSec: median(gapsSec(buys)),
    sellMedGapSec: median(gapsSec(sells)),
    swapMedGapSec: median(gapsSec(withStart)),
    buyPerHour: ratePerHour(buys.length, durationSec),
    sellPerHour: ratePerHour(sells.length, durationSec),
    swapsPerHour: ratePerHour(withStart.length, durationSec),
  }
}

/** Notable quiet stretches between consecutive buys/sells. */
export function findPauses(swaps: Trade[], t0: number, thresholdSec: number, limit = 8): PauseEvent[] {
  const ordered = sortByTime(swaps)
  const pauses: PauseEvent[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1]
    const next = ordered[i]
    const start = Date.parse(prev.timestamp)
    const end = Date.parse(next.timestamp)
    const durationSec = (end - start) / 1000
    if (durationSec < thresholdSec) continue
    pauses.push({
      startIso: prev.timestamp,
      endIso: next.timestamp,
      durationSec,
      offsetSec: (start - t0) / 1000,
      afterType: prev.type,
      beforeType: next.type,
    })
  }
  return pauses.sort((a, b) => b.durationSec - a.durationSec).slice(0, limit)
}

function pauseThresholdSec(swapGaps: number[]): number {
  const med = median(swapGaps) ?? 60
  // At least 5 minutes, or ~20× typical wait — whichever is larger, capped at 1h so busy tapes still surface pauses.
  return Math.min(60 * 60, Math.max(5 * 60, med * 20))
}

function comparePace(prev: number | null, next: number | null): string {
  if (prev == null || next == null) return "n/a"
  if (prev <= 0 && next <= 0) return "stayed near zero"
  if (prev <= 0 && next > 0) return "picked up from near zero"
  if (next <= 0) return "dropped near zero"
  const ratio = next / prev
  if (ratio >= 1.25) return `sped up ~${formatReportNumber(ratio)}×`
  if (ratio <= 0.8) return `slowed to ~${formatReportNumber(ratio)}×`
  return "held about steady"
}

function buildPaceStory(segments: SpeedSegment[]): string {
  if (segments.length === 0) return "Not enough swaps to measure pace changes."
  const first = segments[0]
  const parts: string[] = [
    `At launch (${first.label}) buys ran at about ${formatReportNumber(first.buyPerHour)} buys/h and sells at ${formatReportNumber(first.sellPerHour)} sells/h` +
      ` (median wait ~${formatDuration(first.buyMedGapSec)} between buys, ~${formatDuration(first.sellMedGapSec)} between sells).`,
  ]
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1]
    const cur = segments[i]
    const buyChange = comparePace(prev.buyPerHour, cur.buyPerHour)
    const sellChange = comparePace(prev.sellPerHour, cur.sellPerHour)
    parts.push(
      `In ${cur.label}, buy speed ${buyChange} (${formatReportNumber(cur.buyPerHour)} buys/h) and sell speed ${sellChange} (${formatReportNumber(cur.sellPerHour)} sells/h); ` +
        `median gap ~${formatDuration(cur.buyMedGapSec)} between buys / ~${formatDuration(cur.sellMedGapSec)} between sells.`,
    )
  }
  const peak = segments.reduce((best, seg) =>
    (seg.swapsPerHour ?? 0) > (best.swapsPerHour ?? 0) ? seg : best,
  )
  const quiet = segments.reduce((best, seg) =>
    (seg.swapsPerHour ?? Number.POSITIVE_INFINITY) < (best.swapsPerHour ?? Number.POSITIVE_INFINITY) ? seg : best,
  )
  parts.push(
    `Busiest ring: ${peak.label} (~${formatReportNumber(peak.swapsPerHour)} swaps/h). Quietest: ${quiet.label} (~${formatReportNumber(quiet.swapsPerHour)} swaps/h).`,
  )
  return parts.join(" ")
}

function buildPausesStory(pauses: PauseEvent[], thresholdSec: number): string {
  if (pauses.length === 0) {
    return `No quiet stretch longer than ${formatDuration(thresholdSec)} showed up between consecutive buys/sells.`
  }
  const top = pauses[0]
  return (
    `Notable pauses are quiet stretches of at least ${formatDuration(thresholdSec)} between consecutive buys/sells. ` +
    `The longest lasted ${formatDuration(top.durationSec)}, starting ~${formatDuration(top.offsetSec)} after launch ` +
    `(${isoLabel(top.startIso)}), after a ${top.afterType.toLowerCase()} until the next ${top.beforeType.toLowerCase()}. ` +
    `${pauses.length === 1 ? "That was the only notable pause." : `Showing the ${pauses.length} longest pauses below.`}`
  )
}

function buildStory(windows: WindowStats[], quote: string, segments: SpeedSegment[]): string {
  const w15 = windows.find((w) => w.id === "15m")
  const w1h = windows.find((w) => w.id === "1h")
  const w24 = windows.find((w) => w.id === "24h")
  const full = windows.find((w) => w.id === "full")
  if (!w15 || !w1h || !w24 || !full) return ""
  const buyLedEarly = w15.buys > w15.sells * 1.5
  const volMatched24 =
    w24.buyEthSum > 0 && Math.abs(w24.buyEthSum - w24.sellEthSum) / Math.max(w24.buyEthSum, w24.sellEthSum) < 0.08
  const first = segments[0]
  const late = segments[segments.length - 1]
  return (
    `The open ${buyLedEarly ? "was a buy rush" : "mixed buys and sells"} ` +
    `(${formatReportNumber(w15.buys)} buys vs ${formatReportNumber(w15.sells)} sells in 15 minutes, about ${formatReportNumber(w15.buyEthSum)} ${quote} bought` +
    `${first ? `, ~${formatReportNumber(first.buyPerHour)} buys/h` : ""}). ` +
    `Through the first hour flow built to ${formatReportNumber(w1h.buys)} buys and ${formatReportNumber(w1h.sells)} sells. ` +
    `By 24 hours ${quote} volume ${volMatched24 ? "had nearly matched" : "still diverged"} ` +
    `(${formatReportNumber(w24.buyEthSum)} vs ${formatReportNumber(w24.sellEthSum)} ${quote}). ` +
    `By the full tape: ${formatReportNumber(full.buys)} buys and ${formatReportNumber(full.sells)} sells ` +
    `(about ${formatReportNumber(full.buyEthSum)} vs ${formatReportNumber(full.sellEthSum)} ${quote})` +
    `${late ? `; late pace ~${formatReportNumber(late.buyPerHour)} buys/h and ~${formatReportNumber(late.sellPerHour)} sells/h` : ""}.`
  )
}

function noteForWindow(stats: WindowStats, quote: string): string {
  const bits: string[] = []
  if (stats.buys > stats.sells * 1.5) bits.push("Early flow was buy-heavy on count.")
  else if (stats.sells > stats.buys * 1.5) bits.push("Sells led on count in this window.")
  if (stats.sellMedEth != null && stats.buyMedEth != null && stats.sellMedEth > stats.buyMedEth * 1.4) {
    bits.push(`Sell clips ran larger than buys (median ${formatReportNumber(stats.sellMedEth)} vs ${formatReportNumber(stats.buyMedEth)} ${quote}).`)
  }
  if (stats.buyEthSum > 0 && stats.sellEthSum > 0) {
    const ratio = Math.abs(stats.buyEthSum - stats.sellEthSum) / Math.max(stats.buyEthSum, stats.sellEthSum)
    if (ratio < 0.08) bits.push(`${quote} bought and sold had nearly matched.`)
  }
  if (stats.longestPauseSec != null && stats.longestPauseSec >= 5 * 60) {
    bits.push(
      `Longest quiet stretch here lasted ${formatDuration(stats.longestPauseSec)}` +
        (stats.longestPauseStartIso ? ` (from ${isoLabel(stats.longestPauseStartIso)})` : "") +
        ".",
    )
  }
  return bits.length ? ` ${bits.join(" ")}` : ""
}

/** One plain-English paragraph for a cumulative window. */
export function formatWindowParagraph(stats: WindowStats, quoteSymbol: string): string {
  const quote = quoteSymbol || "quote"
  const pace =
    stats.buys + stats.sells === 0
      ? "no swaps yet"
      : `median wait ~${formatDuration(stats.buyMedGapSec)} between buys and ~${formatDuration(stats.sellMedGapSec)} between sells` +
        ` (~${formatReportNumber(stats.buyPerHour)} buys/h, ~${formatReportNumber(stats.sellPerHour)} sells/h; median swap gap ~${formatDuration(stats.swapMedGapSec)})`
  return (
    `In this window there were ${formatReportNumber(stats.buys)} buys and ${formatReportNumber(stats.sells)} sells. ` +
    `Buyers spent about ${formatReportNumber(stats.buyEthSum)} ${quote} (about ${formatReportUsd(stats.buyUsdSum)}); ` +
    `sellers took about ${formatReportNumber(stats.sellEthSum)} ${quote} (about ${formatReportUsd(stats.sellUsdSum)}). ` +
    `Typical clip size was about ${formatReportNumber(stats.buyMedEth)} ${quote} on buys and ${formatReportNumber(stats.sellMedEth)} ${quote} on sells. ` +
    `Largest buy about ${formatReportNumber(stats.buyMaxEth)} ${quote}; largest sell about ${formatReportNumber(stats.sellMaxEth)} ${quote}. ` +
    `Pace: ${pace}.${noteForWindow(stats, quote)}`
  )
}

export function formatPauseParagraph(pause: PauseEvent, index: number): string {
  return (
    `${index + 1}. Paused for ${formatDuration(pause.durationSec)} starting ~${formatDuration(pause.offsetSec)} after launch ` +
    `(${isoLabel(pause.startIso)} → ${isoLabel(pause.endIso)}), after a ${pause.afterType.toLowerCase()} until the next ${pause.beforeType.toLowerCase()}.`
  )
}

export function formatSpeedSegmentParagraph(seg: SpeedSegment, prev: SpeedSegment | null): string {
  const change =
    prev == null
      ? "Opening pace."
      : `Vs prior ring: buys ${comparePace(prev.buyPerHour, seg.buyPerHour)}, sells ${comparePace(prev.sellPerHour, seg.sellPerHour)}.`
  return (
    `${seg.buys} buys and ${seg.sells} sells over ${formatDuration(seg.durationSec)} ` +
    `(~${formatReportNumber(seg.buyPerHour)} buys/h, ~${formatReportNumber(seg.sellPerHour)} sells/h, ~${formatReportNumber(seg.swapsPerHour)} swaps/h). ` +
    `Median wait ~${formatDuration(seg.buyMedGapSec)} between buys and ~${formatDuration(seg.sellMedGapSec)} between sells. ${change}`
  )
}

/**
 * Build a buy/sell behaviour report from the loaded tape.
 * Windows are cumulative from the first event timestamp.
 */
export function buildBehaviourReport(trades: Trade[], pool: PoolView): BehaviourReport | null {
  const timed = trades.filter((trade) => Number.isFinite(Date.parse(trade.timestamp)))
  if (timed.length === 0) return null
  const times = timed.map((trade) => Date.parse(trade.timestamp))
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const swaps = swapsOnly(timed)
  const swapGaps = gapsSec(swaps)
  const threshold = pauseThresholdSec(swapGaps)
  const windows = REPORT_WINDOWS.map((def) => windowStats(timed, t0, t1, def))
  const speedSegments = SPEED_SEGMENTS.map((def) => speedSegmentStats(swaps, t0, t1, def)).filter(
    (seg): seg is SpeedSegment => seg != null && seg.buys + seg.sells > 0,
  )
  const pauses = findPauses(swaps, t0, threshold)
  const quote = pool.quoteSymbol || "quote"
  return {
    baseSymbol: pool.baseSymbol,
    quoteSymbol: pool.quoteSymbol,
    dex: pool.dex,
    startIso: new Date(t0).toISOString(),
    endIso: new Date(t1).toISOString(),
    windows,
    pauses,
    pauseThresholdSec: threshold,
    speedSegments,
    story: buildStory(windows, quote, speedSegments),
    paceStory: buildPaceStory(speedSegments),
    pausesStory: buildPausesStory(pauses, threshold),
  }
}
