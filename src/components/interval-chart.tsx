"use client"

import { useEffect, useMemo, useRef, useState, type WheelEvent } from "react"
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

type Point = { x: number; y: number; label: string }

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
  const [xRange, setXRange] = useState<{ min: number; max: number } | null>(null)
  const [yRange, setYRange] = useState<{ min: number; max: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const points = useMemo(() => {
    const out: Point[] = []
    for (const row of rows) {
      const y = metricValue(row, metric)
      if (y === null) continue
      out.push({
        x: row.startMs,
        y,
        label: formatBucketLabel(row.start, intervalMs),
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
      const pad = Math.abs(minY) > 0 ? Math.abs(minY) * 0.1 : 1
      minY -= pad
      maxY += pad
    } else {
      const pad = (maxY - minY) * 0.08
      minY -= pad
      maxY += pad
    }
    return { minX, maxX, minY, maxY }
  }, [points, intervalMs])

  useEffect(() => {
    if (!open || !dataBounds) return
    setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
    setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
  }, [open, dataBounds, metric])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  const width = 900
  const height = 460
  const pad = { top: 24, right: 20, bottom: 48, left: 64 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const xr = xRange ?? (dataBounds ? { min: dataBounds.minX, max: dataBounds.maxX } : null)
  const yr = yRange ?? (dataBounds ? { min: dataBounds.minY, max: dataBounds.maxY } : null)

  function xToPx(x: number): number {
    if (!xr || xr.max === xr.min) return pad.left
    return pad.left + ((x - xr.min) / (xr.max - xr.min)) * plotW
  }
  function yToPx(y: number): number {
    if (!yr || yr.max === yr.min) return pad.top + plotH
    return pad.top + (1 - (y - yr.min) / (yr.max - yr.min)) * plotH
  }

  const visible = points.filter((point) => xr && point.x >= xr.min && point.x <= xr.max)
  const path = visible
    .map((point, index) => `${index === 0 ? "M" : "L"}${xToPx(point.x).toFixed(1)},${yToPx(point.y).toFixed(1)}`)
    .join(" ")

  const yTicks = (() => {
    if (!yr) return [] as number[]
    const step = niceStep(yr.max - yr.min, 6)
    const start = Math.ceil(yr.min / step) * step
    const ticks: number[] = []
    for (let value = start; value <= yr.max + step * 0.01; value += step) ticks.push(value)
    return ticks.slice(0, 10)
  })()

  const xTicks = (() => {
    if (!xr) return [] as number[]
    const step = niceStep(xr.max - xr.min, 6)
    const start = Math.ceil(xr.min / step) * step
    const ticks: number[] = []
    for (let value = start; value <= xr.max + step * 0.01; value += step) ticks.push(value)
    return ticks.slice(0, 10)
  })()

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    if (!xr || !yr || !dataBounds) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const mx = ((event.clientX - rect.left) / rect.width) * width
    const my = ((event.clientY - rect.top) / rect.height) * height
    const inPlot = mx >= pad.left && mx <= width - pad.right && my >= pad.top && my <= height - pad.bottom
    if (!inPlot) return

    const factor = event.deltaY > 0 ? 1.12 : 0.88
    const xRatio = (mx - pad.left) / plotW
    const yRatio = 1 - (my - pad.top) / plotH
    const xSpan = xr.max - xr.min
    const ySpan = yr.max - yr.min
    const nextXSpan = Math.max(intervalMs, Math.min(dataBounds.maxX - dataBounds.minX, xSpan * factor))
    const nextYSpan = Math.max((dataBounds.maxY - dataBounds.minY) * 0.02, Math.min((dataBounds.maxY - dataBounds.minY) * 4, ySpan * factor))
    let nextXMin = xr.min + xRatio * xSpan - xRatio * nextXSpan
    let nextXMax = nextXMin + nextXSpan
    let nextYMin = yr.min + yRatio * ySpan - yRatio * nextYSpan
    let nextYMax = nextYMin + nextYSpan

    if (nextXMin < dataBounds.minX) {
      nextXMin = dataBounds.minX
      nextXMax = nextXMin + nextXSpan
    }
    if (nextXMax > dataBounds.maxX) {
      nextXMax = dataBounds.maxX
      nextXMin = nextXMax - nextXSpan
    }
    setXRange({ min: nextXMin, max: nextXMax })
    setYRange({ min: nextYMin, max: nextYMax })
  }

  const metricLabel = Y_OPTIONS.find((option) => option.id === metric)?.label ?? metric
  const poolLabel = metric === "poolQuote" ? `Pool ${quoteSymbol}` : metricLabel

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interval-chart-title"
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
      >
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="interval-chart-title" className="text-base font-semibold tracking-tight">
              Interval chart
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Scroll on the plot to zoom X and Y. Reset restores the full range.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Y axis
              <select
                aria-label="Chart Y axis"
                value={metric}
                onChange={(event) => setMetric(event.target.value as ChartYMetric)}
                className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
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
              onClick={() => {
                if (!dataBounds) return
                setXRange({ min: dataBounds.minX, max: dataBounds.maxX })
                setYRange({ min: dataBounds.minY, max: dataBounds.maxY })
              }}
            >
              Reset zoom
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Close chart" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto p-3">
          {points.length === 0 ? (
            <p className="px-2 py-16 text-center text-sm text-muted-foreground">No data points for {poolLabel}.</p>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`0 0 ${width} ${height}`}
              className="h-auto w-full min-w-[640px] touch-none"
              role="img"
              aria-label={`${poolLabel} over time`}
              onWheel={onWheel}
            >
              <rect x={0} y={0} width={width} height={height} fill="transparent" />
              <rect
                x={pad.left}
                y={pad.top}
                width={plotW}
                height={plotH}
                className="fill-muted/20 stroke-border"
                strokeWidth={1}
              />
              {yTicks.map((tick) => (
                <g key={`y-${tick}`}>
                  <line
                    x1={pad.left}
                    x2={pad.left + plotW}
                    y1={yToPx(tick)}
                    y2={yToPx(tick)}
                    className="stroke-border/70"
                    strokeDasharray="3 4"
                  />
                  <text
                    x={pad.left - 8}
                    y={yToPx(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {formatAxis(tick, metric)}
                  </text>
                </g>
              ))}
              {xTicks.map((tick) => {
                const short = new Date(tick).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  ...(intervalMs < 60_000 ? { second: "2-digit" as const } : {}),
                })
                return (
                  <g key={`x-${tick}`}>
                    <line
                      y1={pad.top}
                      y2={pad.top + plotH}
                      x1={xToPx(tick)}
                      x2={xToPx(tick)}
                      className="stroke-border/50"
                      strokeDasharray="3 4"
                    />
                    <text
                      x={xToPx(tick)}
                      y={height - 16}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[10px]"
                    >
                      {short}
                    </text>
                    <title>{short}</title>
                  </g>
                )
              })}
              {path ? <path d={path} fill="none" className="stroke-primary" strokeWidth={2} /> : null}
              {visible.map((point) => (
                <circle
                  key={`${point.x}-${point.y}`}
                  cx={xToPx(point.x)}
                  cy={yToPx(point.y)}
                  r={3}
                  className="fill-primary"
                >
                  <title>{`${point.label}: ${formatAxis(point.y, metric)}`}</title>
                </circle>
              ))}
              <text x={pad.left} y={16} className="fill-foreground text-[12px] font-medium">
                {poolLabel}
              </text>
            </svg>
          )}
        </div>
      </div>
    </div>
  )
}
