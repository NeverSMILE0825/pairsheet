"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowDown, ArrowUp, Fuel } from "lucide-react"
import {
  GAS_REFRESH_MS,
  PRICE_REFRESH_MS,
  changeTone,
  fetchEthSnap,
  fetchGasSnap,
  formatChange,
  formatEthPrice,
  formatGwei,
  type EthSnap,
  type GasSnap,
} from "@/lib/live-market"

function EthIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden className="shrink-0 text-amber-400">
      <path
        fill="currentColor"
        d="M8 0 3 8.2l5 3 5-3L8 0Zm0 12.4-5-3L8 16l5-6.6-5 3Z"
        opacity="0.95"
      />
    </svg>
  )
}

function toneClass(tone: "up" | "down" | "flat"): string {
  if (tone === "up") return "text-emerald-400"
  if (tone === "down") return "text-rose-400"
  return "text-muted-foreground"
}

export function LiveMarketWidgets() {
  const [eth, setEth] = useState<EthSnap | null>(null)
  const [gas, setGas] = useState<GasSnap | null>(null)
  const [ethMove, setEthMove] = useState<"up" | "down" | null>(null)
  const [gasMove, setGasMove] = useState<"up" | "down" | null>(null)
  const prevEth = useRef<number | null>(null)
  const prevGas = useRef<number | null>(null)
  const moveTimers = useRef<number[]>([])

  useEffect(() => {
    let cancelled = false
    const clearMoves = () => {
      for (const id of moveTimers.current) window.clearTimeout(id)
      moveTimers.current = []
    }

    async function refreshPrice() {
      try {
        const next = await fetchEthSnap()
        if (cancelled) return
        if (prevEth.current != null && prevEth.current !== next.priceUsd) {
          setEthMove(next.priceUsd > prevEth.current ? "up" : "down")
          const timer = window.setTimeout(() => setEthMove(null), 2000)
          moveTimers.current.push(timer)
        }
        prevEth.current = next.priceUsd
        setEth(next)
      } catch {
        // Keep last good reading.
      }
    }

    async function refreshGas() {
      try {
        const next = await fetchGasSnap()
        if (cancelled) return
        if (prevGas.current != null && prevGas.current !== next.standardGwei) {
          setGasMove(next.standardGwei > prevGas.current ? "up" : "down")
          const timer = window.setTimeout(() => setGasMove(null), 2000)
          moveTimers.current.push(timer)
        }
        prevGas.current = next.standardGwei
        setGas(next)
      } catch {
        // Keep last good reading.
      }
    }

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

  const ethTone = changeTone(eth?.change24h)
  const live = Boolean(eth || gas)

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Live Ethereum price and gas"
    >
      <div
        className="flex h-9 items-center gap-2 rounded-lg bg-card px-2.5 ring-1 ring-foreground/10 sm:px-3"
        title={eth ? `ETH · ${eth.source} · updated ${new Date(eth.observedAt).toLocaleTimeString()}` : "Loading ETH price"}
      >
        <EthIcon />
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatEthPrice(eth?.priceUsd)}
        </span>
        <span className={`hidden text-xs font-medium tabular-nums sm:inline ${toneClass(ethTone)}`}>
          24H {formatChange(eth?.change24h)}
        </span>
        {ethMove === "up" ? (
          <ArrowUp className="size-3 text-emerald-400" aria-hidden />
        ) : ethMove === "down" ? (
          <ArrowDown className="size-3 text-rose-400" aria-hidden />
        ) : null}
      </div>

      <div
        className="flex h-9 items-center gap-2 rounded-lg bg-card px-2.5 ring-1 ring-foreground/10 sm:px-3"
        title={gas ? `Standard gas · ${gas.source} · updated ${new Date(gas.observedAt).toLocaleTimeString()}` : "Loading gas"}
      >
        <Fuel className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-[10px] font-medium tracking-wide text-muted-foreground">STD</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {gas ? `${formatGwei(gas.standardGwei)} gwei` : "— gwei"}
        </span>
        {gasMove === "up" ? (
          <ArrowUp className="size-3 text-emerald-400" aria-hidden />
        ) : gasMove === "down" ? (
          <ArrowDown className="size-3 text-rose-400" aria-hidden />
        ) : null}
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${live ? "bg-emerald-500" : "bg-muted-foreground"}`}
        />
      </div>
    </div>
  )
}
