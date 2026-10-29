"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { CandlestickChart, ChartColumn, LineChart, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DEFAULT_INTERVAL_MS,
  MAX_INTERVAL_BUCKETS,
  buildIntervalTape,
  estimateBucketCount,
  formatBucketLabel,
  type MinuteRow,
} from "@/lib/minute-tape"
import type { Trade } from "@/lib/types"

export type ChartYMetric =
  | "buySell"
  | "buyCount"
  | "sellCount"
  | "poolQuote"
  | "marketCap"
  | "price"
  | "holders"
  | "gasFee"
  | "gasFeeTotal"

export type ChartStyle = "line" | "area" | "candles" | "bars" | "columns"

const Y_OPTIONS: { id: ChartYMetric; label: string }[] = [
  { id: "buySell", label: "Buy + Sell" },
  { id: "buyCount", label: "Buy Count" },
  { id: "sellCount", label: "Sell Count" },
  { id: "poolQuote", label: "Pool quote" },
  { id: "marketCap", label: "M. Cap" },
  { id: "price", label: "Price" },
  { id: "holders", label: "Holders" },
  { id: "gasFee", label: "Gas Price" },
  { id: "gasFeeTotal", label: "Gas Fee Total" },
]

const CHART_INTERVALS: { id: string; label: string; ms: number }[] = [
  { id: "12s", label: "12s", ms: 12_000 },
  { id: "1m", label: "1m", ms: 60_000 },
  { id: "5m", label: "5m", ms: 5 * 60_000 },
  { id: "15m", label: "15m", ms: 15 * 60_000 },
  { id: "30m", label: "30m", ms: 30 * 60_000 },
  { id: "1h", label: "1h", ms: 60 * 60_000 },
  { id: "4h", label: "4h", ms: 4 * 60 * 60_000 },
  { id: "1d", label: "1d", ms: 24 * 60 * 60_000 },
]

const STYLE_OPTIONS: { id: ChartStyle; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "columns", label: "Columns" },
]

type Candle = {
  x: number
  open: number
  high: number
  low: number
  close: number
  buy: number
  sell: number
  buyUsd: number
  sellUsd: number
  label: string
}

type Range = { min: number; max: number }
type Zone = "plot" | "yaxis" | "xaxis" | "none"

function num(raw: string | null): number | null {
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function startMetric(row: MinuteRow, metric: ChartYMetric): number | null {
  if (metric === "buyCount" || metric === "buySell") return row.buyCount
  if (metric === "sellCount") return row.sellCount
  if (metric === "holders") return row.startHolders
  if (metric === "gasFee") return num(row.startGasPriceGwei)
  if (metric === "gasFeeTotal") return num(row.startGasFeeTotalEth)
  if (metric === "poolQuote") return num(row.startQuoteReserve)
  if (metric === "marketCap") return num(row.startMarketCapUsd)
  return num(row.startPriceUsd)
}

function endMetric(row: MinuteRow, metric: ChartYMetric): number | null {
  if (metric === "buyCount" || metric === "buySell") return row.buyCount
  if (metric === "sellCount") return row.sellCount
  if (metric === "holders") return row.endHolders
  if (metric === "gasFee") return num(row.endGasPriceGwei)
  if (metric === "gasFeeTotal") return num(row.endGasFeeTotalEth)
  if (metric === "poolQuote") return num(row.endQuoteReserve)
  if (metric === "marketCap") return num(row.endMarketCapUsd)
  return num(row.endPriceUsd)
}

function niceStep(span: number, targetTicks: number): number {
  if (!(span > 0)) return 1
  const rough = span / Math.max(1, targetTicks)
  const power = 10 ** Math.floor(Math.log10(rough))
  const normalized = rough / power
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return nice * power
}

function formatAxis(value: number, metric: ChartYMetric): string {
  if (metric === "buyCount" || metric === "sellCount" || metric === "buySell" || metric === "holders") {
    return Math.round(value).toLocaleString("en-US")
  }
  if (metric === "gasFee") return `${value.toFixed(3)} gwei`
  if (metric === "gasFeeTotal") return `${value.toFixed(4)} ETH`
  if (metric === "marketCap") {
    if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
    if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`
    return `$${Math.round(value).toLocaleString("en-US")}`
  }
  if (metric === "price") {
    if (value === 0) return "$0"
    if (value >= 1) return `$${value.toFixed(2)}`
    if (value >= 0.0001) return `$${value.toPrecision(3)}`
    return `$${value.toExponential(1)}`
  }
  if (Math.abs(value) >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 1 })
  if (Math.abs(value) >= 1) return value.toFixed(2)
  return value.toPrecision(3)
}

function formatUsdCompact(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0"
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

function formatTimeLabel(ms: number, intervalMs: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(intervalMs < 60_000 ? { second: "2-digit" as const } : {}),
  })
}

function clampRange(next: Range, full: Range, minSpan: number): Range {
  let span = Math.max(minSpan, next.max - next.min)
  const fullSpan = Math.max(minSpan, full.max - full.min)
  span = Math.min(span, fullSpan)
  let min = next.min
  let max = min + span
  if (min < full.min) {
    min = full.min
    max = min + span
  }
  if (max > full.max) {
    max = full.max
    min = max - span
  }
  return { min, max }
}

function zoomRange(range: Range, full: Range, anchor: number, factor: number, minSpan: number): Range {
  const span = range.max - range.min
  if (!(span > 0)) return range
  const ratio = Math.min(1, Math.max(0, (anchor - range.min) / span))
  const nextSpan = span * factor
  const min = anchor - ratio * nextSpan
  return clampRange({ min, max: min + nextSpan }, full, minSpan)
}

function nearestCandle(points: Candle[], x: number): Candle | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDist = Math.abs(points[0].x - x)
  for (const point of points) {
    const dist = Math.abs(point.x - x)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  return best
}

function buildCandles(
  rows: MinuteRow[],
  trades: Trade[],
  metric: ChartYMetric,
  intervalMs: number,
): Candle[] {
  const byBucket = new Map<number, Trade[]>()
  for (const trade of trades) {
    const time = Date.parse(trade.timestamp)
    if (!Number.isFinite(time)) continue
    const bucket = Math.floor(time / intervalMs) * intervalMs
    const list = byBucket.get(bucket)
    if (list) list.push(trade)
    else byBucket.set(bucket, [trade])
  }

  const out: Candle[] = []
  for (const row of rows) {
    const close = endMetric(row, metric)
    const openRaw = startMetric(row, metric)
    if (close === null && openRaw === null) continue
    const open = openRaw ?? close ?? 0
    const end = close ?? open
    let high = Math.max(open, end)
    let low = Math.min(open, end)
    let buyUsd = 0
    let sellUsd = 0

    const bucketTrades = byBucket.get(row.startMs) ?? []
    for (const trade of bucketTrades) {
      const total = Number(trade.totalUsd)
      if (trade.type === "BUY" && Number.isFinite(total)) buyUsd += total
      if (trade.type === "SELL" && Number.isFinite(total)) sellUsd += total
      if (metric === "price" && trade.priceUsd != null) {
        const price = Number(trade.priceUsd)
        if (Number.isFinite(price)) {
          high = Math.max(high, price)
          low = Math.min(low, price)
        }
      }
      if (metric === "marketCap" && trade.marketCapUsd != null) {
        const mcap = Number(trade.marketCapUsd)
        if (Number.isFinite(mcap)) {
          high = Math.max(high, mcap)
          low = Math.min(low, mcap)
        }
      }
      if (metric === "poolQuote" && trade.quoteReserve != null) {
        const reserve = Number(trade.quoteReserve)
        if (Number.isFinite(reserve)) {
          high = Math.max(high, reserve)
          low = Math.min(low, reserve)
        }
      }
      if (metric === "holders" && trade.holders != null) {
        high = Math.max(high, trade.holders)
        low = Math.min(low, trade.holders)
      }
      if (metric === "gasFee" && trade.gasPriceGwei != null) {
        const gwei = Number(trade.gasPriceGwei)
        if (Number.isFinite(gwei)) {
          high = Math.max(high, gwei)
          low = Math.min(low, gwei)
        }
      }
      if (metric === "gasFeeTotal" && trade.gasFeeTotalEth != null) {
        const total = Number(trade.gasFeeTotalEth)
        if (Number.isFinite(total)) {
          high = Math.max(high, total)
          low = Math.min(low, total)
        }
      }
    }

    out.push({
      x: row.startMs,
      open,
      high,
      low,
      close: end,
      buy: row.buyCount,
      sell: row.sellCount,
      buyUsd,
      sellUsd,
      label: formatBucketLabel(row.start, intervalMs),
    })
  }
  return out
}

export function IntervalChartDialog({
  open,
  onClose,
  trades,
  zone,
  initialIntervalMs = DEFAULT_INTERVAL_MS,
  quoteSymbol,
}: {
  open: boolean
  onClose: () => void
  trades: Trade[]
  zone: string
  initialIntervalMs?: number
  quoteSymbol: string
}) {
  const [metric, setMetric] = useState<ChartYMetric>("buySell")
  const [style, setStyle] = useState<ChartStyle>("candles")
  const [chartIntervalMs, setChartIntervalMs] = useState(initialIntervalMs)
  const [showIntervals, setShowIntervals] = useState(false)
  const [showStyles, setShowStyles] = useState(false)
  const [xRange, setXRange] = useState<Range | null>(null)
  const [yRange, setYRange] = useState<Range | null>(null)
  const [autoY, setAutoY] = useState(true)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{
    zone: "plot" | "yaxis"
    startX: number
    startY: number
    xRange: Range
    yRange: Range
  } | null>(null)
  const stateRef = useRef({
    xRange: null as Range | null,
    yRange: null as Range | null,
    dataBounds: null as { minX: number; maxX: number; minY: number; maxY: number } | null,
    intervalMs: chartIntervalMs,
  })

  const width = 980
  const height = 560
  const pad = { top: 44, right: 72, bottom: 52, left: 16 }
  const volumeH = 64
  const ratioH = 28
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom - volumeH - ratioH

  useEffect(() => {
    if (open) setChartIntervalMs(initialIntervalMs)
  }, [open, initialIntervalMs])

  const tooFine = estimateBucketCount(trades, chartIntervalMs) > MAX_INTERVAL_BUCKETS
  const rows = useMemo(() => {
    if (!open || tooFine) return [] as MinuteRow[]
    return buildIntervalTape(trades, zone, chartIntervalMs)
  }, [open, trades, zone, chartIntervalMs, tooFine])

  const candles = useMemo(
    () => buildCandles(rows, trades, metric === "buySell" ? "buyCount" : metric, chartIntervalMs),
    [rows, trades, metric, chartIntervalMs],
  )

  const dataBounds = useMemo(() => {
    if (candles.length === 0) return null
    let minX = candles[0].x
    let maxX = candles[0].x
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const c of candles) {
      if (c.x < minX) minX = c.x
      if (c.x > maxX) maxX = c.x
      if (metric === "buySell") {
        minY = Math.min(minY, 0, c.buy, c.sell)
        maxY = Math.max(maxY, c.buy, c.sell)
      } else {
        minY = Math.min(minY, c.low, c.open, c.close)
        maxY = Math.max(maxY, c.high, c.open, c.close)
      }
    }
    if (minX === maxX) maxX = minX + chartIntervalMs
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null
    if (minY === maxY) {
      const padY = Math.abs(minY) > 0 ? Math.abs(minY) * 0.12 : 1
      minY -= padY
      maxY += padY
    } else {
      const padY = (maxY - minY) * 0.08
      minY -= padY
      maxY += padY
    }
    if (minY > 0 && minY / maxY < 0.12) minY = 0
    return { minX, maxX, minY, maxY }
  }, [candles, chartIntervalMs, metric])

  const xr = xRange ?? (dataBounds ? { min: dataBounds.minX, max: dataBounds.maxX } : null)
  const yr = yRange ?? (dataBounds ? { min: dataBounds.minY, max: dataBounds.maxY } : null)
  stateRef.current = { xRange: xr, yRange: yr, dataBounds, intervalMs: chartIntervalMs }

  useEffect(() => {
    if (!open || !dataBounds) return
    setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
    setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
    setAutoY(true)
    setCursor(null)
  }, [open, dataBounds, metric, chartIntervalMs])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const visible = useMemo(() => {
    if (!xr) return [] as Candle[]
    return candles.filter((c) => c.x >= xr.min && c.x <= xr.max)
  }, [candles, xr])

  useEffect(() => {
    if (!autoY || visible.length === 0 || !dataBounds) return
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const c of visible) {
      if (metric === "buySell") {
        minY = Math.min(minY, 0, c.buy, c.sell)
        maxY = Math.max(maxY, c.buy, c.sell)
      } else {
        minY = Math.min(minY, c.low)
        maxY = Math.max(maxY, c.high)
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return
    if (minY === maxY) {
      const padY = Math.abs(minY) > 0 ? Math.abs(minY) * 0.12 : 1
      minY -= padY
      maxY += padY
    } else {
      const padY = (maxY - minY) * 0.1
      minY -= padY
      maxY += padY
    }
    if (minY > 0 && minY / maxY < 0.12) minY = 0
    setYRange({ min: minY, max: maxY })
  }, [autoY, visible, dataBounds, metric])

  function xToPx(x: number): number {
    if (!xr || xr.max === xr.min) return pad.left
    return pad.left + ((x - xr.min) / (xr.max - xr.min)) * plotW
  }
  function yToPx(y: number): number {
    if (!yr || yr.max === yr.min) return pad.top + plotH
    return pad.top + (1 - (y - yr.min) / (yr.max - yr.min)) * plotH
  }

  function zoneAt(mx: number, my: number): Zone {
    if (mx >= width - pad.right && mx <= width && my >= pad.top && my <= pad.top + plotH) return "yaxis"
    if (mx >= pad.left && mx <= pad.left + plotW && my >= pad.top + plotH && my <= height) return "xaxis"
    if (mx >= pad.left && mx <= pad.left + plotW && my >= pad.top && my <= pad.top + plotH + volumeH) return "plot"
    return "none"
  }

  function svgPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    }
  }

  useEffect(() => {
    if (!open) return
    const svg = svgRef.current
    if (!svg) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      const { xRange: curX, yRange: curY, dataBounds: bounds, intervalMs: step } = stateRef.current
      if (!curX || !curY || !bounds) return
      const pt = svgPoint(event.clientX, event.clientY)
      if (!pt) return
      const zone = zoneAt(pt.x, pt.y)
      if (zone === "none") return
      const factor = event.deltaY > 0 ? 1.14 : 0.88
      if (zone === "yaxis") {
        setAutoY(false)
        const ySpan = curY.max - curY.min
        const ratio = Math.min(1, Math.max(0, 1 - (pt.y - pad.top) / plotH))
        const anchor = curY.min + ratio * ySpan
        const dataSpan = Math.max(bounds.maxY - bounds.minY, Math.abs(bounds.maxY) * 0.01, 1e-12)
        setYRange(zoomRange(curY, { min: bounds.minY - dataSpan, max: bounds.maxY + dataSpan }, anchor, factor, dataSpan * 0.02))
        return
      }
      const xSpan = curX.max - curX.min
      const ratio = Math.min(1, Math.max(0, (pt.x - pad.left) / plotW))
      const anchor = curX.min + ratio * xSpan
      setXRange(zoomRange(curX, { min: bounds.minX, max: bounds.maxX }, anchor, factor, step))
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [open, candles.length])

  useEffect(() => {
    if (!open) return
    function onMove(event: MouseEvent) {
      const drag = dragRef.current
      const pt = svgPoint(event.clientX, event.clientY)
      if (!pt) return
      const { xRange: curX, yRange: curY, dataBounds: bounds, intervalMs: step } = stateRef.current
      if (!drag) {
        if (pt.x >= pad.left && pt.x <= pad.left + plotW && pt.y >= pad.top && pt.y <= pad.top + plotH + volumeH && curX && curY) {
          const xSpan = curX.max - curX.min
          const ySpan = curY.max - curY.min
          setCursor({
            x: curX.min + ((pt.x - pad.left) / plotW) * xSpan,
            y: curY.min + (1 - (pt.y - pad.top) / plotH) * ySpan,
          })
        } else setCursor(null)
        return
      }
      if (!bounds) return
      const svg = svgRef.current
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const dxPx = ((event.clientX - drag.startX) / rect.width) * width
      const dyPx = ((event.clientY - drag.startY) / rect.height) * height
      if (drag.zone === "yaxis") {
        setAutoY(false)
        const ySpan = drag.yRange.max - drag.yRange.min
        const dy = (dyPx / plotH) * ySpan
        const dataSpan = Math.max(bounds.maxY - bounds.minY, 1e-12)
        setYRange(
          clampRange(
            { min: drag.yRange.min + dy, max: drag.yRange.max + dy },
            { min: bounds.minY - dataSpan, max: bounds.maxY + dataSpan },
            ySpan,
          ),
        )
        return
      }
      const xSpan = drag.xRange.max - drag.xRange.min
      const dx = -(dxPx / plotW) * xSpan
      setXRange(
        clampRange({ min: drag.xRange.min + dx, max: drag.xRange.max + dx }, { min: bounds.minX, max: bounds.maxX }, step),
      )
    }
    function onUp() {
      dragRef.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [open])

  if (!open) return null

  const metricLabel =
    metric === "poolQuote" ? `Pool ${quoteSymbol}` : (Y_OPTIONS.find((option) => option.id === metric)?.label ?? metric)
  const hover = cursor ? nearestCandle(visible, cursor.x) : null
  const last = visible.length > 0 ? visible[visible.length - 1] : null
  const first = visible.length > 0 ? visible[0] : null
  const change =
    metric !== "buySell" && first && last && first.close !== 0
      ? ((last.close - first.close) / Math.abs(first.close)) * 100
      : null
  const upOverall = change == null ? true : change >= 0

  let minVisible = Number.POSITIVE_INFINITY
  let maxVisible = Number.NEGATIVE_INFINITY
  let buyUsdTotal = 0
  let sellUsdTotal = 0
  let buyCountTotal = 0
  let sellCountTotal = 0
  for (const c of visible) {
    if (metric === "buySell") {
      minVisible = Math.min(minVisible, c.buy, c.sell)
      maxVisible = Math.max(maxVisible, c.buy, c.sell)
    } else {
      minVisible = Math.min(minVisible, c.low)
      maxVisible = Math.max(maxVisible, c.high)
    }
    buyUsdTotal += c.buyUsd
    sellUsdTotal += c.sellUsd
    buyCountTotal += c.buy
    sellCountTotal += c.sell
  }
  if (!Number.isFinite(minVisible)) minVisible = 0
  if (!Number.isFinite(maxVisible)) maxVisible = 0

  const volumeUsdMode = buyUsdTotal + sellUsdTotal > 0
  const buyShare = volumeUsdMode
    ? buyUsdTotal / Math.max(buyUsdTotal + sellUsdTotal, 1)
    : buyCountTotal / Math.max(buyCountTotal + sellCountTotal, 1)

  const yTicks = (() => {
    if (!yr) return [] as number[]
    const step = niceStep(yr.max - yr.min, 7)
    const start = Math.ceil(yr.min / step) * step
    const ticks: number[] = []
    for (let value = start; value <= yr.max + step * 0.01; value += step) ticks.push(value)
    return ticks.slice(0, 12)
  })()

  const xTicks = (() => {
    if (!xr) return [] as number[]
    const step = niceStep(xr.max - xr.min, 7)
    const start = Math.ceil(xr.min / step) * step
    const ticks: number[] = []
    for (let value = start; value <= xr.max + step * 0.01; value += step) ticks.push(value)
    return ticks.slice(0, 12)
  })()

  const maxVolume = Math.max(1, ...visible.map((c) => c.buy + c.sell))
  const volumeTop = pad.top + plotH + 8
  const ratioTop = volumeTop + volumeH
  const candleW = Math.max(2, Math.min(14, (plotW / Math.max(visible.length, 1)) * 0.65))
  const activeStyle = metric === "buySell" && (style === "candles" || style === "bars") ? "columns" : style

  function resetZoom() {
    if (!dataBounds) return
    setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
    setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
    setAutoY(true)
  }

  function renderSeries() {
    if (metric === "buySell") {
      if (activeStyle === "columns") {
        return visible.map((c) => {
          const x = xToPx(c.x)
          const w = Math.max(1, candleW * 0.4)
          return (
            <g key={`bs-${c.x}`}>
              <rect x={x - w - 1} y={yToPx(c.buy)} width={w} height={Math.max(1, yToPx(0) - yToPx(c.buy))} fill="#22c55e" opacity={0.9} />
              <rect x={x + 1} y={yToPx(c.sell)} width={w} height={Math.max(1, yToPx(0) - yToPx(c.sell))} fill="#f43f5e" opacity={0.9} />
            </g>
          )
        })
      }
      const buyPath = visible
        .map((c, i) => `${i === 0 ? "M" : "L"}${xToPx(c.x).toFixed(1)},${yToPx(c.buy).toFixed(1)}`)
        .join(" ")
      const sellPath = visible
        .map((c, i) => `${i === 0 ? "M" : "L"}${xToPx(c.x).toFixed(1)},${yToPx(c.sell).toFixed(1)}`)
        .join(" ")
      return (
        <>
          {activeStyle === "area" && buyPath ? (
            <path
              d={`${buyPath} L${xToPx(visible[visible.length - 1].x).toFixed(1)},${yToPx(0).toFixed(1)} L${xToPx(visible[0].x).toFixed(1)},${yToPx(0).toFixed(1)} Z`}
              fill="#22c55e"
              opacity={0.12}
            />
          ) : null}
          {activeStyle === "area" && sellPath ? (
            <path
              d={`${sellPath} L${xToPx(visible[visible.length - 1].x).toFixed(1)},${yToPx(0).toFixed(1)} L${xToPx(visible[0].x).toFixed(1)},${yToPx(0).toFixed(1)} Z`}
              fill="#f43f5e"
              opacity={0.12}
            />
          ) : null}
          {buyPath ? <path d={buyPath} fill="none" stroke="#22c55e" strokeWidth={2} /> : null}
          {sellPath ? <path d={sellPath} fill="none" stroke="#f43f5e" strokeWidth={2} /> : null}
        </>
      )
    }

    if (activeStyle === "candles" || activeStyle === "bars") {
      return visible.map((c) => {
        const up = c.close >= c.open
        const color = up ? "#22c55e" : "#f43f5e"
        const x = xToPx(c.x)
        const yHigh = yToPx(c.high)
        const yLow = yToPx(c.low)
        const yOpen = yToPx(c.open)
        const yClose = yToPx(c.close)
        if (activeStyle === "bars") {
          return (
            <g key={`bar-${c.x}`}>
              <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1.5} />
              <line x1={x - candleW / 2} x2={x} y1={yOpen} y2={yOpen} stroke={color} strokeWidth={2} />
              <line x1={x} x2={x + candleW / 2} y1={yClose} y2={yClose} stroke={color} strokeWidth={2} />
            </g>
          )
        }
        const top = Math.min(yOpen, yClose)
        const body = Math.max(1, Math.abs(yClose - yOpen))
        return (
          <g key={`cndl-${c.x}`}>
            <line x1={x} x2={x} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1.25} />
            <rect x={x - candleW / 2} y={top} width={candleW} height={body} fill={color} stroke={color} />
          </g>
        )
      })
    }

    if (activeStyle === "columns") {
      return visible.map((c) => {
        const up = c.close >= c.open
        const x = xToPx(c.x)
        const y0 = yToPx(Math.max(0, yr?.min ?? 0))
        const y1 = yToPx(c.close)
        return (
          <rect
            key={`col-${c.x}`}
            x={x - candleW / 2}
            y={Math.min(y0, y1)}
            width={candleW}
            height={Math.max(1, Math.abs(y0 - y1))}
            fill={up ? "#22c55e" : "#f43f5e"}
            opacity={0.85}
          />
        )
      })
    }

    const path = visible
      .map((c, i) => `${i === 0 ? "M" : "L"}${xToPx(c.x).toFixed(1)},${yToPx(c.close).toFixed(1)}`)
      .join(" ")
    const area =
      activeStyle === "area" && visible.length > 0
        ? `${path} L${xToPx(visible[visible.length - 1].x).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xToPx(visible[0].x).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`
        : ""
    return (
      <>
        {area ? <path d={area} fill={upOverall ? "url(#pair-sheet-area-up)" : "url(#pair-sheet-area-down)"} /> : null}
        {visible.slice(1).map((c, index) => {
          const prev = visible[index]
          const up = c.close >= prev.close
          return (
            <line
              key={`seg-${c.x}`}
              x1={xToPx(prev.x)}
              y1={yToPx(prev.close)}
              x2={xToPx(c.x)}
              y2={yToPx(c.close)}
              stroke={up ? "#22c55e" : "#f43f5e"}
              strokeWidth={2}
              strokeLinecap="round"
            />
          )
        })}
      </>
    )
  }

  const intervalLabel = CHART_INTERVALS.find((item) => item.ms === chartIntervalMs)?.label ?? `${chartIntervalMs / 1000}s`

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interval-chart-title"
        className="flex w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[#0b0e11] shadow-xl ring-1 ring-white/10"
      >
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="interval-chart-title" className="text-base font-semibold tracking-tight text-white">
                Interval chart
              </h2>
              <p className="mt-0.5 text-xs text-white/50">
                Scroll chart = time zoom · Scroll right axis = value scale · Drag to pan
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-white/60">
                Y
                <select
                  aria-label="Chart Y axis"
                  value={metric}
                  onChange={(event) => setMetric(event.target.value as ChartYMetric)}
                  className="h-9 rounded-lg border border-white/15 bg-[#12161c] px-2 text-sm text-white"
                >
                  {Y_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.id === "poolQuote" ? `Pool ${quoteSymbol}` : option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={`border-white/15 bg-transparent ${autoY ? "text-emerald-400" : "text-white/70"}`}
                onClick={() => setAutoY(true)}
              >
                auto
              </Button>
              <Button type="button" size="sm" variant="outline" className="border-white/15 bg-transparent text-white/80" onClick={resetZoom}>
                Reset
              </Button>
              <Button type="button" size="icon" variant="ghost" className="text-white/70 hover:text-white" aria-label="Close chart" onClick={onClose}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex flex-wrap items-center gap-1">
              {CHART_INTERVALS.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={chartIntervalMs === item.ms}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    chartIntervalMs === item.ms ? "bg-primary text-primary-foreground" : "bg-white/5 text-white/70 hover:bg-white/10"
                  }`}
                  onClick={() => setChartIntervalMs(item.ms)}
                >
                  {item.label}
                </button>
              ))}
              <button
                type="button"
                className="rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10"
                aria-expanded={showIntervals}
                onClick={() => {
                  setShowIntervals((v) => !v)
                  setShowStyles(false)
                }}
              >
                {intervalLabel} ▾
              </button>
              {showIntervals ? (
                <div className="absolute top-8 left-0 z-10 grid max-h-64 w-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-white/10 bg-[#12161c] p-2 shadow-xl">
                  {CHART_INTERVALS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`rounded px-2 py-1 text-left text-xs ${
                        chartIntervalMs === item.ms ? "bg-primary text-primary-foreground" : "text-white/80 hover:bg-white/10"
                      }`}
                      onClick={() => {
                        setChartIntervalMs(item.ms)
                        setShowIntervals(false)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#12161c] px-2.5 py-1.5 text-xs text-white/80"
                aria-expanded={showStyles}
                onClick={() => {
                  setShowStyles((v) => !v)
                  setShowIntervals(false)
                }}
              >
                {activeStyle === "candles" ? <CandlestickChart className="size-3.5" /> : null}
                {activeStyle === "columns" || activeStyle === "bars" ? <ChartColumn className="size-3.5" /> : null}
                {activeStyle === "line" || activeStyle === "area" ? <LineChart className="size-3.5" /> : null}
                {STYLE_OPTIONS.find((s) => s.id === activeStyle)?.label ?? activeStyle}
                ▾
              </button>
              {showStyles ? (
                <div className="absolute top-9 left-0 z-10 w-40 rounded-lg border border-white/10 bg-[#12161c] p-1 shadow-xl">
                  {STYLE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`block w-full rounded px-2 py-1.5 text-left text-xs ${
                        activeStyle === option.id ? "bg-primary text-primary-foreground" : "text-white/80 hover:bg-white/10"
                      }`}
                      onClick={() => {
                        setStyle(option.id)
                        setShowStyles(false)
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-3 text-xs tabular-nums">
              <span className="text-emerald-400">Max: {formatAxis(maxVisible, metric)}</span>
              <span className="text-rose-400">Min: {formatAxis(minVisible, metric)}</span>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto p-2 sm:p-3">
          {tooFine ? (
            <p className="px-2 py-16 text-center text-sm text-amber-300">
              Interval {intervalLabel} is too fine for this tape. Pick a coarser interval.
            </p>
          ) : candles.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-white/50">No data points for {metricLabel}.</p>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="h-auto w-full min-w-[720px] touch-none select-none"
              role="img"
              aria-label={`${metricLabel} over time`}
              onMouseLeave={() => {
                if (!dragRef.current) setCursor(null)
              }}
              onMouseDown={(event) => {
                if (!xr || !yr) return
                const pt = svgPoint(event.clientX, event.clientY)
                if (!pt) return
                const zone = zoneAt(pt.x, pt.y)
                if (zone === "none") return
                setShowIntervals(false)
                setShowStyles(false)
                dragRef.current = {
                  zone: zone === "yaxis" ? "yaxis" : "plot",
                  startX: event.clientX,
                  startY: event.clientY,
                  xRange: xr,
                  yRange: yr,
                }
              }}
              style={{ cursor: "crosshair" }}
            >
              <defs>
                <linearGradient id="pair-sheet-area-up" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="pair-sheet-area-down" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
                </linearGradient>
                <clipPath id="pair-sheet-plot-clip">
                  <rect x={pad.left} y={pad.top} width={plotW} height={plotH} />
                </clipPath>
              </defs>

              <rect x={0} y={0} width={width} height={height} fill="#0b0e11" />
              <rect x={pad.left} y={pad.top} width={plotW} height={plotH} fill="#0f1318" />
              <rect x={pad.left} y={volumeTop} width={plotW} height={volumeH - 10} fill="#0f1318" />

              {yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  <line x1={pad.left} x2={pad.left + plotW} y1={yToPx(tick)} y2={yToPx(tick)} stroke="#1f2933" strokeDasharray="2 4" />
                  <text
                    x={width - 10}
                    y={yToPx(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="#8b98a5"
                    fontSize={11}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatAxis(tick, metric)}
                  </text>
                </g>
              ))}

              {xTicks.map((tick) => (
                <g key={`x-${tick}`}>
                  <line y1={pad.top} y2={pad.top + plotH} x1={xToPx(tick)} x2={xToPx(tick)} stroke="#1f2933" strokeDasharray="2 4" />
                  <text
                    x={xToPx(tick)}
                    y={height - 8}
                    textAnchor="middle"
                    fill="#8b98a5"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatTimeLabel(tick, chartIntervalMs)}
                  </text>
                </g>
              ))}

              {visible.map((c) => {
                const total = c.buy + c.sell
                if (total <= 0) return null
                const h = Math.max(2, (total / maxVolume) * (volumeH - 16))
                const bw = Math.max(1, Math.min(8, (plotW / Math.max(visible.length, 1)) * 0.7))
                const x = xToPx(c.x) - bw / 2
                const buyH = (c.buy / total) * h
                return (
                  <g key={`vol-${c.x}`}>
                    <rect x={x} y={volumeTop + (volumeH - 16) - h} width={bw} height={h - buyH} fill="#f43f5e" opacity={0.55} />
                    <rect x={x} y={volumeTop + (volumeH - 16) - buyH} width={bw} height={buyH} fill="#22c55e" opacity={0.7} />
                  </g>
                )
              })}

              <g clipPath="url(#pair-sheet-plot-clip)">{renderSeries()}</g>

              {/* Buy / sell ratio bar */}
              <rect x={pad.left} y={ratioTop} width={plotW * buyShare} height={18} fill="#22c55e" opacity={0.85} rx={2} />
              <rect
                x={pad.left + plotW * buyShare}
                y={ratioTop}
                width={plotW * (1 - buyShare)}
                height={18}
                fill="#f43f5e"
                opacity={0.85}
                rx={2}
              />
              <text x={pad.left + 8} y={ratioTop + 13} fill="#052e16" fontSize={11} fontWeight={700}>
                {volumeUsdMode ? formatUsdCompact(buyUsdTotal) : `${buyCountTotal.toLocaleString("en-US")} buys`}
              </text>
              <text x={pad.left + plotW - 8} y={ratioTop + 13} textAnchor="end" fill="#4c0519" fontSize={11} fontWeight={700}>
                {volumeUsdMode ? formatUsdCompact(sellUsdTotal) : `${sellCountTotal.toLocaleString("en-US")} sells`}
              </text>

              {last && metric !== "buySell" ? (
                <g>
                  <line
                    x1={pad.left}
                    x2={pad.left + plotW}
                    y1={yToPx(last.close)}
                    y2={yToPx(last.close)}
                    stroke={upOverall ? "#22c55e" : "#f43f5e"}
                    strokeDasharray="4 4"
                    opacity={0.45}
                  />
                  <rect
                    x={width - pad.right + 4}
                    y={yToPx(last.close) - 10}
                    width={pad.right - 8}
                    height={20}
                    rx={3}
                    fill={upOverall ? "#22c55e" : "#f43f5e"}
                  />
                  <text
                    x={width - 10}
                    y={yToPx(last.close)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="#0b0e11"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatAxis(last.close, metric)}
                  </text>
                </g>
              ) : null}

              {hover && cursor ? (
                <g pointerEvents="none">
                  <line
                    x1={xToPx(hover.x)}
                    x2={xToPx(hover.x)}
                    y1={pad.top}
                    y2={ratioTop + 18}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    opacity={0.8}
                  />
                  {metric !== "buySell" ? (
                    <line
                      x1={pad.left}
                      x2={pad.left + plotW}
                      y1={yToPx(hover.close)}
                      y2={yToPx(hover.close)}
                      stroke="#94a3b8"
                      strokeDasharray="3 3"
                      opacity={0.8}
                    />
                  ) : null}
                  <circle
                    cx={xToPx(hover.x)}
                    cy={yToPx(metric === "buySell" ? hover.buy : hover.close)}
                    r={3.5}
                    fill="#e2e8f0"
                    stroke="#0b0e11"
                    strokeWidth={2}
                  />
                </g>
              ) : null}

              <rect x={width - pad.right} y={pad.top} width={pad.right} height={plotH} fill="transparent" style={{ cursor: "ns-resize" }} />
              <rect x={pad.left} y={pad.top + plotH} width={plotW} height={pad.bottom + volumeH + ratioH} fill="transparent" style={{ cursor: "ew-resize" }} />

              <text x={pad.left + 4} y={18} fill="#e2e8f0" fontSize={12} fontWeight={600}>
                {metricLabel}
                {metric === "buySell" ? (
                  <tspan fill="#94a3b8">{`  buy ${last?.buy ?? 0} / sell ${last?.sell ?? 0}`}</tspan>
                ) : last ? (
                  <tspan fill={upOverall ? "#22c55e" : "#f43f5e"}>
                    {`  ${formatAxis(last.close, metric)}`}
                    {change != null ? `  ${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : ""}
                  </tspan>
                ) : null}
                <tspan fill="#22c55e">{`   Max ${formatAxis(maxVisible, metric)}`}</tspan>
                <tspan fill="#f43f5e">{`  Min ${formatAxis(minVisible, metric)}`}</tspan>
              </text>
              {hover ? (
                <text
                  x={pad.left + 4}
                  y={pad.top + 14}
                  fill="#94a3b8"
                  fontSize={11}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {hover.label}
                  {metric === "buySell"
                    ? ` · buy ${hover.buy} / sell ${hover.sell}`
                    : ` · O ${formatAxis(hover.open, metric)} H ${formatAxis(hover.high, metric)} L ${formatAxis(hover.low, metric)} C ${formatAxis(hover.close, metric)}`}
                  {` · buy ${hover.buy} / sell ${hover.sell}`}
                </text>
              ) : null}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
