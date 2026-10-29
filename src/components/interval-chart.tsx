"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatBucketLabel, type MinuteRow } from "@/lib/minute-tape"

export type ChartYMetric =
  | "buyCount"
  | "sellCount"
  | "poolQuote"
  | "marketCap"
  | "price"
  | "holders"

const Y_OPTIONS: { id: ChartYMetric; label: string }[] = [
  { id: "buyCount", label: "Buy Count" },
  { id: "sellCount", label: "Sell Count" },
  { id: "poolQuote", label: "Pool quote" },
  { id: "marketCap", label: "M. Cap" },
  { id: "price", label: "Price" },
  { id: "holders", label: "Holders" },
]

type Point = { x: number; y: number; label: string; buy: number; sell: number }
type Range = { min: number; max: number }
type Zone = "plot" | "yaxis" | "xaxis" | "none"

function metricValue(row: MinuteRow, metric: ChartYMetric): number | null {
  if (metric === "buyCount") return row.buyCount
  if (metric === "sellCount") return row.sellCount
  if (metric === "holders") return row.endHolders
  const raw =
    metric === "poolQuote"
      ? row.endQuoteReserve
      : metric === "marketCap"
        ? row.endMarketCapUsd
        : row.endPriceUsd
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
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
  if (metric === "buyCount" || metric === "sellCount" || metric === "holders") {
    return Math.round(value).toLocaleString("en-US")
  }
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

function nearestPoint(points: Point[], x: number): Point | null {
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

export function IntervalChartDialog({
  open,
  onClose,
  rows,
  intervalMs,
  quoteSymbol,
}: {
  open: boolean
  onClose: () => void
  rows: MinuteRow[]
  intervalMs: number
  quoteSymbol: string
}) {
  const [metric, setMetric] = useState<ChartYMetric>("buyCount")
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
    intervalMs,
  })

  const width = 980
  const height = 520
  const pad = { top: 36, right: 72, bottom: 44, left: 16 }
  const volumeH = 56
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom - volumeH

  const points = useMemo(() => {
    const out: Point[] = []
    for (const row of rows) {
      const y = metricValue(row, metric)
      if (y === null) continue
      out.push({
        x: row.startMs,
        y,
        label: formatBucketLabel(row.start, intervalMs),
        buy: row.buyCount,
        sell: row.sellCount,
      })
    }
    return out
  }, [rows, metric, intervalMs])

  const dataBounds = useMemo(() => {
    if (points.length === 0) return null
    let minX = points[0].x
    let maxX = points[0].x
    let minY = points[0].y
    let maxY = points[0].y
    for (const point of points) {
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    if (minX === maxX) maxX = minX + intervalMs
    if (minY === maxY) {
      const padY = Math.abs(minY) > 0 ? Math.abs(minY) * 0.12 : 1
      minY -= padY
      maxY += padY
    } else {
      const padY = (maxY - minY) * 0.08
      minY -= padY
      maxY += padY
    }
    if (minY > 0 && minY / maxY < 0.15) minY = 0
    return { minX, maxX, minY, maxY }
  }, [points, intervalMs])

  const xr = xRange ?? (dataBounds ? { min: dataBounds.minX, max: dataBounds.maxX } : null)
  const yr = yRange ?? (dataBounds ? { min: dataBounds.minY, max: dataBounds.maxY } : null)

  stateRef.current = { xRange: xr, yRange: yr, dataBounds, intervalMs }

  useEffect(() => {
    if (!open || !dataBounds) return
    setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
    setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
    setAutoY(true)
    setCursor(null)
  }, [open, dataBounds, metric])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const visible = useMemo(() => {
    if (!xr) return [] as Point[]
    return points.filter((point) => point.x >= xr.min && point.x <= xr.max)
  }, [points, xr])

  useEffect(() => {
    if (!autoY || visible.length === 0 || !dataBounds) return
    let minY = visible[0].y
    let maxY = visible[0].y
    for (const point of visible) {
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    if (minY === maxY) {
      const padY = Math.abs(minY) > 0 ? Math.abs(minY) * 0.12 : 1
      minY -= padY
      maxY += padY
    } else {
      const padY = (maxY - minY) * 0.1
      minY -= padY
      maxY += padY
    }
    if (minY > 0 && minY / maxY < 0.15) minY = 0
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
        const yFull = {
          min: bounds.minY - dataSpan,
          max: bounds.maxY + dataSpan,
        }
        setYRange(zoomRange(curY, yFull, anchor, factor, dataSpan * 0.02))
        return
      }

      const xSpan = curX.max - curX.min
      const ratio = Math.min(1, Math.max(0, (pt.x - pad.left) / plotW))
      const anchor = curX.min + ratio * xSpan
      setXRange(zoomRange(curX, { min: bounds.minX, max: bounds.maxX }, anchor, factor, step))
    }

    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [open, points.length])

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
        } else {
          setCursor(null)
        }
        return
      }
      if (!bounds || !curX || !curY) return
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
        clampRange(
          { min: drag.xRange.min + dx, max: drag.xRange.max + dx },
          { min: bounds.minX, max: bounds.maxX },
          step,
        ),
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

  const metricLabel = Y_OPTIONS.find((option) => option.id === metric)?.label ?? metric
  const poolLabel = metric === "poolQuote" ? `Pool ${quoteSymbol}` : metricLabel
  const hover = cursor ? nearestPoint(visible, cursor.x) : null
  const last = visible.length > 0 ? visible[visible.length - 1] : null
  const first = visible.length > 0 ? visible[0] : null
  const change =
    first && last && first.y !== 0 ? ((last.y - first.y) / Math.abs(first.y)) * 100 : first && last ? last.y - first.y : null
  const upOverall = change == null ? true : change >= 0

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

  const maxVolume = Math.max(1, ...visible.map((point) => point.buy + point.sell))
  const volumeTop = pad.top + plotH + 8

  const areaPath =
    visible.length > 0
      ? `${visible
          .map((point, index) => `${index === 0 ? "M" : "L"}${xToPx(point.x).toFixed(1)},${yToPx(point.y).toFixed(1)}`)
          .join(" ")} L${xToPx(visible[visible.length - 1].x).toFixed(1)},${(pad.top + plotH).toFixed(1)} L${xToPx(visible[0].x).toFixed(1)},${(pad.top + plotH).toFixed(1)} Z`
      : ""

  function resetZoom() {
    if (!dataBounds) return
    setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
    setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
    setAutoY(true)
  }

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
        <div className="flex flex-col gap-3 border-b border-white/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="interval-chart-title" className="text-base font-semibold tracking-tight text-white">
              Interval chart
            </h2>
            <p className="mt-0.5 text-xs text-white/50">
              Scroll the chart to zoom time. Scroll the right Y-axis to scale values. Drag to pan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-white/60">
              Y axis
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

        <div className="overflow-x-auto p-2 sm:p-3">
          {points.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-white/50">No data points for {poolLabel}.</p>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="h-auto w-full min-w-[720px] touch-none select-none"
              role="img"
              aria-label={`${poolLabel} over time`}
              onMouseLeave={() => {
                if (!dragRef.current) setCursor(null)
              }}
              onMouseDown={(event) => {
                if (!xr || !yr) return
                const pt = svgPoint(event.clientX, event.clientY)
                if (!pt) return
                const zone = zoneAt(pt.x, pt.y)
                if (zone === "none") return
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
              <rect x={pad.left} y={volumeTop} width={plotW} height={volumeH - 8} fill="#0f1318" />

              {yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  <line
                    x1={pad.left}
                    x2={pad.left + plotW}
                    y1={yToPx(tick)}
                    y2={yToPx(tick)}
                    stroke="#1f2933"
                    strokeDasharray="2 4"
                  />
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
                  <line
                    y1={pad.top}
                    y2={pad.top + plotH}
                    x1={xToPx(tick)}
                    x2={xToPx(tick)}
                    stroke="#1f2933"
                    strokeDasharray="2 4"
                  />
                  <text
                    x={xToPx(tick)}
                    y={height - 12}
                    textAnchor="middle"
                    fill="#8b98a5"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatTimeLabel(tick, intervalMs)}
                  </text>
                </g>
              ))}

              {visible.map((point) => {
                const total = point.buy + point.sell
                if (total <= 0) return null
                const h = Math.max(2, (total / maxVolume) * (volumeH - 14))
                const bw = Math.max(1, Math.min(8, (plotW / Math.max(visible.length, 1)) * 0.7))
                const x = xToPx(point.x) - bw / 2
                const buyH = (point.buy / total) * h
                return (
                  <g key={`vol-${point.x}`}>
                    <rect x={x} y={volumeTop + (volumeH - 14) - h} width={bw} height={h - buyH} fill="#f43f5e" opacity={0.55} />
                    <rect x={x} y={volumeTop + (volumeH - 14) - buyH} width={bw} height={buyH} fill="#22c55e" opacity={0.7} />
                  </g>
                )
              })}

              <g clipPath="url(#pair-sheet-plot-clip)">
                {areaPath ? (
                  <path d={areaPath} fill={upOverall ? "url(#pair-sheet-area-up)" : "url(#pair-sheet-area-down)"} />
                ) : null}
                {visible.slice(1).map((point, index) => {
                  const prev = visible[index]
                  const up = point.y >= prev.y
                  return (
                    <line
                      key={`seg-${point.x}`}
                      x1={xToPx(prev.x)}
                      y1={yToPx(prev.y)}
                      x2={xToPx(point.x)}
                      y2={yToPx(point.y)}
                      stroke={up ? "#22c55e" : "#f43f5e"}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  )
                })}
              </g>

              {last ? (
                <g>
                  <line
                    x1={pad.left}
                    x2={pad.left + plotW}
                    y1={yToPx(last.y)}
                    y2={yToPx(last.y)}
                    stroke={upOverall ? "#22c55e" : "#f43f5e"}
                    strokeDasharray="4 4"
                    opacity={0.45}
                  />
                  <rect
                    x={width - pad.right + 4}
                    y={yToPx(last.y) - 10}
                    width={pad.right - 8}
                    height={20}
                    rx={3}
                    fill={upOverall ? "#22c55e" : "#f43f5e"}
                  />
                  <text
                    x={width - 10}
                    y={yToPx(last.y)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="#0b0e11"
                    fontSize={10}
                    fontWeight={700}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatAxis(last.y, metric)}
                  </text>
                </g>
              ) : null}

              {hover && cursor ? (
                <g pointerEvents="none">
                  <line
                    x1={xToPx(hover.x)}
                    x2={xToPx(hover.x)}
                    y1={pad.top}
                    y2={pad.top + plotH + volumeH - 8}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    opacity={0.8}
                  />
                  <line
                    x1={pad.left}
                    x2={pad.left + plotW}
                    y1={yToPx(hover.y)}
                    y2={yToPx(hover.y)}
                    stroke="#94a3b8"
                    strokeDasharray="3 3"
                    opacity={0.8}
                  />
                  <circle cx={xToPx(hover.x)} cy={yToPx(hover.y)} r={4} fill="#e2e8f0" stroke="#0b0e11" strokeWidth={2} />
                  <rect
                    x={Math.min(Math.max(xToPx(hover.x) - 70, pad.left), pad.left + plotW - 140)}
                    y={height - 28}
                    width={140}
                    height={18}
                    rx={3}
                    fill="#1e293b"
                  />
                  <text
                    x={Math.min(Math.max(xToPx(hover.x), pad.left + 70), pad.left + plotW - 70)}
                    y={height - 15}
                    textAnchor="middle"
                    fill="#e2e8f0"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatTimeLabel(hover.x, intervalMs)}
                  </text>
                  <rect x={width - pad.right + 4} y={yToPx(hover.y) - 10} width={pad.right - 8} height={20} rx={3} fill="#334155" />
                  <text
                    x={width - 10}
                    y={yToPx(hover.y)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="#f8fafc"
                    fontSize={10}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {formatAxis(hover.y, metric)}
                  </text>
                </g>
              ) : null}

              <rect x={width - pad.right} y={pad.top} width={pad.right} height={plotH} fill="transparent" style={{ cursor: "ns-resize" }} />
              <rect x={pad.left} y={pad.top + plotH} width={plotW} height={pad.bottom + volumeH} fill="transparent" style={{ cursor: "ew-resize" }} />

              <text x={pad.left + 4} y={22} fill="#e2e8f0" fontSize={12} fontWeight={600}>
                {poolLabel}
                {last ? (
                  <tspan fill={upOverall ? "#22c55e" : "#f43f5e"}>
                    {`  ${formatAxis(last.y, metric)}`}
                    {change != null ? `  ${change >= 0 ? "+" : ""}${change.toFixed(2)}%` : ""}
                  </tspan>
                ) : null}
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
                  {` · ${formatAxis(hover.y, metric)} · buy ${hover.buy} / sell ${hover.sell}`}
                </text>
              ) : null}
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
