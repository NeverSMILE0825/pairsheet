"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, Fuel, RefreshCw, X } from "lucide-react"
import {
  GAS_PERCENTILES,
  GAS_REFRESH_MS,
  PRICE_REFRESH_MS,
  changeTone,
  fetchEthSnap,
  fetchGasSnap,
  formatAge,
  formatAgo,
  formatChange,
  formatEthPrice,
  formatGwei,
  sparklinePath,
  type EthSnap,
  type GasSnap,
  type GasTier,
} from "@/lib/live-market"

function EthIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0 text-amber-400">
      <path fill="currentColor" d="M8 0 3 8.2l5 3 5-3L8 0Zm0 12.4-5-3L8 16l5-6.6-5 3Z" opacity="0.95" />
    </svg>
  )
}

function toneClass(tone: "up" | "down" | "flat"): string {
  if (tone === "up") return "text-emerald-400"
  if (tone === "down") return "text-rose-400"
  return "text-muted-foreground"
}

function ChangePill({ label, value }: { label: string; value: number | null | undefined }) {
  const tone = changeTone(value)
  return (
    <span className={`inline-flex items-baseline gap-1 text-xs tabular-nums ${toneClass(tone)}`}>
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      {formatChange(value)}
    </span>
  )
}

function ChangeDetail({ value }: { value: number | null }) {
  const tone = changeTone(value)
  return (
    <span className={`inline-flex items-center gap-1 tabular-nums ${toneClass(tone)}`}>
      {formatChange(value)}
      {tone === "up" ? <ArrowUp className="size-3" aria-hidden /> : null}
      {tone === "down" ? <ArrowDown className="size-3" aria-hidden /> : null}
    </span>
  )
}

function DetailRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{children}</dd>
    </div>
  )
}

function MarketPopover({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-black/50 p-3 pt-16 sm:items-start sm:p-4 sm:pt-20"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[min(36rem,calc(100vh-5rem))] w-full overflow-y-auto rounded-2xl bg-card p-4 shadow-xl ring-1 ring-foreground/10 ${
          wide ? "max-w-xl" : "max-w-md"
        }`}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <p className="text-xs font-medium tracking-[0.16em] text-muted-foreground uppercase">{title}</p>
          <button type="button" className="rounded-md p-1 text-muted-foreground hover:text-foreground" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function TierRow({ name, tier, highlight }: { name: string; tier: GasTier | undefined; highlight?: boolean }) {
  return (
    <tr className={highlight ? "font-medium text-foreground" : "text-foreground"}>
      <th scope="row" className="py-1.5 pr-2 text-left text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {name}
      </th>
      <td className="py-1.5 text-right tabular-nums">{formatGwei(tier?.gwei)}</td>
      <td className="py-1.5 text-right text-xs text-muted-foreground tabular-nums">{tier ? formatGwei(tier.priorityFee) : "—"}</td>
      <td className="py-1.5 text-right text-xs text-muted-foreground tabular-nums">{tier ? `~${tier.estimatedSeconds}s` : "—"}</td>
    </tr>
  )
}

export function LiveMarketWidgets() {
  const [eth, setEth] = useState<EthSnap | null>(null)
  const [gas, setGas] = useState<GasSnap | null>(null)
  const [ethBusy, setEthBusy] = useState(false)
  const [gasBusy, setGasBusy] = useState(false)
  const [ethError, setEthError] = useState<string | null>(null)
  const [gasError, setGasError] = useState<string | null>(null)
  const [ethMove, setEthMove] = useState<"up" | "down" | null>(null)
  const [gasMove, setGasMove] = useState<"up" | "down" | null>(null)
  const [panel, setPanel] = useState<"eth" | "gas" | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const prevEth = useRef<number | null>(null)
  const prevGas = useRef<number | null>(null)
  const moveTimers = useRef<number[]>([])
  const refreshEthRef = useRef<() => Promise<void>>(async () => {})
  const refreshGasRef = useRef<() => Promise<void>>(async () => {})

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const clearMoves = () => {
      for (const id of moveTimers.current) window.clearTimeout(id)
      moveTimers.current = []
    }

    async function refreshPrice() {
      setEthBusy(true)
      try {
        const next = await fetchEthSnap()
        if (cancelled) return
        if (prevEth.current != null && prevEth.current !== next.priceUsd) {
          setEthMove(next.priceUsd > prevEth.current ? "up" : "down")
          moveTimers.current.push(window.setTimeout(() => setEthMove(null), 2000))
        }
        prevEth.current = next.priceUsd
        setEth(next)
        setEthError(null)
      } catch (error) {
        if (!cancelled) setEthError(error instanceof Error ? error.message : "ETH price unavailable")
      } finally {
        if (!cancelled) setEthBusy(false)
      }
    }

    async function refreshGas() {
      setGasBusy(true)
      try {
        const next = await fetchGasSnap()
        if (cancelled) return
        if (prevGas.current != null && prevGas.current !== next.standard.gwei) {
          setGasMove(next.standard.gwei > prevGas.current ? "up" : "down")
          moveTimers.current.push(window.setTimeout(() => setGasMove(null), 2000))
        }
        prevGas.current = next.standard.gwei
        setGas(next)
        setGasError(null)
      } catch (error) {
        if (!cancelled) setGasError(error instanceof Error ? error.message : "Gas unavailable")
      } finally {
        if (!cancelled) setGasBusy(false)
      }
    }

    refreshEthRef.current = refreshPrice
    refreshGasRef.current = refreshGas

    function tick(force: boolean) {
      if (document.hidden && !force) return
      void refreshPrice()
      void refreshGas()
    }

    tick(true)
    const priceTimer = window.setInterval(() => {
      if (!document.hidden) void refreshPrice()
    }, PRICE_REFRESH_MS)
    const gasTimer = window.setInterval(() => {
      if (!document.hidden) void refreshGas()
    }, GAS_REFRESH_MS)
    const onVisible = () => {
      if (!document.hidden) tick(true)
    }
    document.addEventListener("visibilitychange", onVisible)

    return () => {
      cancelled = true
      clearMoves()
      window.clearInterval(priceTimer)
      window.clearInterval(gasTimer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const ethAge = eth ? Math.max(0, now - eth.observedAt) : null
  const gasAge = gas ? Math.max(0, now - gas.observedAt) : null
  const sparkUp = changeTone(eth?.change24h) !== "down"
  const spark = eth ? sparklinePath(eth.sparkline, 280, 72) : ""
  const liveDot = eth || gas ? "bg-emerald-500" : "bg-muted-foreground"

  return (
    <>
      <div className="flex flex-wrap items-center gap-2" aria-label="Live Ethereum price and gas">
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg bg-card px-2.5 ring-1 ring-foreground/10 hover:ring-foreground/25 sm:px-3"
          onClick={() => setPanel("eth")}
          aria-expanded={panel === "eth"}
          title="Open Ethereum price details"
        >
          <EthIcon />
          <span className="text-sm font-semibold tabular-nums text-foreground">{formatEthPrice(eth?.priceUsd)}</span>
          {ethMove === "up" ? <ArrowUp className="size-3 text-emerald-400" aria-hidden /> : null}
          {ethMove === "down" ? <ArrowDown className="size-3 text-rose-400" aria-hidden /> : null}
          <ChangePill label="24H" value={eth?.change24h ?? null} />
          <span className={`hidden text-xs tabular-nums sm:inline ${toneClass(changeTone(eth?.change1h))}`}>
            <span className="text-[10px] text-muted-foreground">1H </span>
            {formatChange(eth?.change1h)}
          </span>
        </button>

        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-lg bg-card px-2.5 ring-1 ring-foreground/10 hover:ring-foreground/25 sm:px-3"
          onClick={() => setPanel("gas")}
          aria-expanded={panel === "gas"}
          title="Open Ethereum gas details"
        >
          <Fuel className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground">STD</span>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {gas ? formatGwei(gas.standard.gwei) : "—"}
          </span>
          <span className="hidden text-[10px] text-muted-foreground sm:inline">gwei</span>
          {gasMove === "up" ? <ArrowUp className="size-3 text-emerald-400" aria-hidden /> : null}
          {gasMove === "down" ? <ArrowDown className="size-3 text-rose-400" aria-hidden /> : null}
          <span aria-hidden className={`size-1.5 rounded-full ${liveDot}`} />
        </button>
      </div>

      <MarketPopover open={panel === "eth"} onClose={() => setPanel(null)} title="Ethereum" wide>
        <div className="flex items-start justify-between gap-3">
          <p className="text-2xl font-semibold tabular-nums">{formatEthPrice(eth?.priceUsd)}</p>
          <span className={`inline-flex items-center gap-1.5 text-xs ${eth ? "text-emerald-400" : "text-muted-foreground"}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${eth ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            {eth ? "Live" : ethBusy ? "Refreshing" : "Unavailable"}
          </span>
        </div>
        {spark ? (
          <svg viewBox="0 0 280 72" className="mt-3 h-20 w-full" role="img" aria-label="ETH price sparkline">
            <path d={spark} fill="none" stroke={sparkUp ? "#34d399" : "#fb7185"} strokeWidth={2} />
          </svg>
        ) : (
          <div className="mt-3 grid h-20 place-items-center rounded-lg bg-muted/40 text-xs text-muted-foreground">
            {ethBusy ? "Loading chart…" : "No sparkline from this source"}
          </div>
        )}
        <dl className="mt-3 divide-y divide-foreground/10">
          <DetailRow label="1 Hour">
            <ChangeDetail value={eth?.change1h ?? null} />
          </DetailRow>
          <DetailRow label="24 Hours">
            <ChangeDetail value={eth?.change24h ?? null} />
          </DetailRow>
          <DetailRow label="7 Days">
            <ChangeDetail value={eth?.change7d ?? null} />
          </DetailRow>
          <DetailRow label="Updated">{eth ? formatAgo(ethAge) : "—"}</DetailRow>
          <DetailRow label="Source">{eth?.sourceLabel ?? "—"}</DetailRow>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          {eth?.source === "coinbase"
            ? "Live trade price. 1H, 24H, and 7D are calculated against the Coinbase price exactly that long ago."
            : eth?.source === "coingecko"
              ? "CoinGecko supplies the 1H, 24H, and 7D changes directly."
              : "Waiting for the first price."}
        </p>
        {ethError ? <p className="mt-2 text-xs text-amber-400">Last refresh failed. {eth ? "Showing the last good price." : ethError}</p> : null}
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
          disabled={ethBusy}
          onClick={() => void refreshEthRef.current()}
        >
          <RefreshCw className={`size-3 ${ethBusy ? "animate-spin" : ""}`} aria-hidden />
          {ethBusy ? "Refreshing…" : "Refresh"}
        </button>
      </MarketPopover>

      <MarketPopover open={panel === "gas"} onClose={() => setPanel(null)} title="Ethereum gas">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">Estimate</p>
          <span className={`inline-flex items-center gap-1.5 text-xs ${gas ? "text-emerald-400" : "text-muted-foreground"}`}>
            <span aria-hidden className={`size-1.5 rounded-full ${gas ? "bg-emerald-500" : "bg-muted-foreground"}`} />
            {gas ? `Updated ${formatAge(gasAge)}` : gasBusy ? "Refreshing" : "Unavailable"}
          </span>
        </div>
        <table className="mt-2 w-full">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase">
              <th className="pb-1 text-left font-medium">Level</th>
              <th className="pb-1 text-right font-medium">Gwei</th>
              <th className="pb-1 text-right font-medium">Tip</th>
              <th className="pb-1 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-foreground/10">
            <TierRow name="Standard" tier={gas?.standard} highlight />
            <TierRow name="Fast" tier={gas?.fast} />
            <TierRow name="Rapid" tier={gas?.rapid} />
          </tbody>
        </table>
        <dl className="mt-2 divide-y divide-foreground/10 border-t border-foreground/10">
          <DetailRow label="Base fee">{gas ? `${formatGwei(gas.baseFee)} gwei` : "—"}</DetailRow>
          <DetailRow label="Block">{gas?.blockNumber != null ? gas.blockNumber.toLocaleString("en-US") : "—"}</DetailRow>
          <DetailRow label="Updated">{gas ? formatAgo(gasAge) : "—"}</DetailRow>
          <DetailRow label="Source">{gas?.sourceLabel ?? "—"}</DetailRow>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          Next block&apos;s base fee plus the median {GAS_PERCENTILES.map((value) => `${value}th`).join(" / ")} percentile tip
          over the last 20 blocks. Gwei is what a transaction pays per gas; the tip column is the priority fee part.
        </p>
        {gasError ? <p className="mt-2 text-xs text-amber-400">Last refresh failed. {gas ? "Showing the last good estimate." : gasError}</p> : null}
        <button
          type="button"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-60"
          disabled={gasBusy}
          onClick={() => void refreshGasRef.current()}
        >
          <RefreshCw className={`size-3 ${gasBusy ? "animate-spin" : ""}`} aria-hidden />
          {gasBusy ? "Refreshing…" : "Refresh"}
        </button>
      </MarketPopover>
    </>
  )
}
