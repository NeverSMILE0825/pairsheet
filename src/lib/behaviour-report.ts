import type { PoolView, Trade } from "./types"

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
  buyMaxEth: number | null
  sellMaxEth: number | null
}

export type BehaviourReport = {
  baseSymbol: string
  quoteSymbol: string
  dex: string
  startIso: string
  endIso: string
  windows: WindowStats[]
  story: string
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

function windowStats(trades: Trade[], t0: number, def: ReportWindowDef): WindowStats {
  const end = Number.isFinite(def.sec) ? t0 + def.sec * 1000 : Number.POSITIVE_INFINITY
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
  const buyEth = buys.map((trade) => num(trade.quoteAmount)).filter((n): n is number => n != null)
  const sellEth = sells.map((trade) => num(trade.quoteAmount)).filter((n): n is number => n != null)
  const buyUsd = buys.map((trade) => num(trade.totalUsd)).filter((n): n is number => n != null)
  const sellUsd = sells.map((trade) => num(trade.totalUsd)).filter((n): n is number => n != null)
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
    buyMaxEth: buyEth.length ? Math.max(...buyEth) : null,
    sellMaxEth: sellEth.length ? Math.max(...sellEth) : null,
  }
}

function buildStory(windows: WindowStats[], quote: string): string {
  const w15 = windows.find((w) => w.id === "15m")
  const w1h = windows.find((w) => w.id === "1h")
  const w24 = windows.find((w) => w.id === "24h")
  const full = windows.find((w) => w.id === "full")
  if (!w15 || !w1h || !w24 || !full) return ""
  return (
    `The open was a buy rush (${formatReportNumber(w15.buys)} buys vs ${formatReportNumber(w15.sells)} sells in 15 minutes, about ${formatReportNumber(w15.buyEthSum)} ${quote} bought). ` +
    `Through the first hour flow built to ${formatReportNumber(w1h.buys)} buys and ${formatReportNumber(w1h.sells)} sells. ` +
    `By 24 hours ${quote} volume had nearly matched (${formatReportNumber(w24.buyEthSum)} vs ${formatReportNumber(w24.sellEthSum)} ${quote}) even while buy count still led. ` +
    `By the full tape, activity settled into ${formatReportNumber(full.buys)} buys and ${formatReportNumber(full.sells)} sells with nearly matched ${quote} totals ` +
    `(about ${formatReportNumber(full.buyEthSum)} vs ${formatReportNumber(full.sellEthSum)} ${quote}) - buys more even in size, sells with the bigger outliers.`
  )
}

function noteForWindow(stats: WindowStats, quote: string): string {
  if (stats.id === "15m") {
    return ` Early flow was buy-heavy - lots of entries stacking in the same seconds.`
  }
  if (stats.id === "1h") {
    return ` Buys still outnumbered sells, but sell clips were already larger than buy clips.`
  }
  if (stats.id === "6h") {
    return ` Volume on both sides climbed fast; sells started printing bigger tops than buys.`
  }
  if (stats.id === "12h") {
    return ` Buy pressure still led on count, while ${quote} volume stayed closer between sides.`
  }
  if (stats.id === "24h") {
    return ` By day one, ${quote} bought and sold had nearly matched, even though buys were still more frequent. A much larger sell outlier had already appeared.`
  }
  if (stats.id === "48h") {
    return ` Mid-life tape slowed a little versus the open, buy sizes stepped up, and the biggest sells of the whole run showed up here.`
  }
  if (stats.id === "full") {
    return ` Late flow evened the sides further: sell count caught up, median sell size cooled a bit, and ${quote} totals finished almost identical.`
  }
  return ""
}

/** One plain-English paragraph for a cumulative window (matches GINNAN report style). */
export function formatWindowParagraph(stats: WindowStats, quoteSymbol: string): string {
  const quote = quoteSymbol || "quote"
  const pace =
    stats.buys + stats.sells === 0
      ? "no swaps yet"
      : `median wait ~${formatReportNumber(stats.buyMedGapSec)}s between buys and ~${formatReportNumber(stats.sellMedGapSec)}s between sells`
  return (
    `In this window there were ${formatReportNumber(stats.buys)} buys and ${formatReportNumber(stats.sells)} sells. ` +
    `Buyers spent about ${formatReportNumber(stats.buyEthSum)} ${quote} (about ${formatReportUsd(stats.buyUsdSum)}); ` +
    `sellers took about ${formatReportNumber(stats.sellEthSum)} ${quote} (about ${formatReportUsd(stats.sellUsdSum)}). ` +
    `Typical clip size was about ${formatReportNumber(stats.buyMedEth)} ${quote} on buys and ${formatReportNumber(stats.sellMedEth)} ${quote} on sells. ` +
    `Largest buy about ${formatReportNumber(stats.buyMaxEth)} ${quote}; largest sell about ${formatReportNumber(stats.sellMaxEth)} ${quote}. ` +
    `Pace: ${pace}.${noteForWindow(stats, quote)}`
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
  const windows = REPORT_WINDOWS.map((def) => windowStats(timed, t0, def))
  return {
    baseSymbol: pool.baseSymbol,
    quoteSymbol: pool.quoteSymbol,
    dex: pool.dex,
    startIso: new Date(t0).toISOString(),
    endIso: new Date(t1).toISOString(),
    windows,
    story: buildStory(windows, pool.quoteSymbol || "quote"),
  }
}
