import type { ReactNode } from "react"
import { tradeSizeFromUsd, type TradeSizeTier } from "@/lib/trade-size"

const TONE: Record<TradeSizeTier, string> = {
  plankton: "text-amber-300",
  shrimp: "text-orange-400",
  fish: "text-sky-400",
  dolphin: "text-cyan-300",
  whale: "text-violet-300",
}

function PlanktonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.2 8.9 6.1 13.8 7 8.9 7.9 8 12.8 7.1 7.9 2.2 7 7.1 6.1Z"
      />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" opacity="0.85" />
    </svg>
  )
}

function ShrimpIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.2 9.2c.4-2.4 2.2-4.2 4.8-4.6 1.6-.3 3.1.2 4.2 1.2l.7-.9.9.7-.8 1c.7 1.1.9 2.5.5 3.8-.5 1.6-1.8 2.8-3.4 3.2-2.3.5-4.6-.6-5.6-2.6-.3.5-.8.9-1.4 1.1l-.4-1.1c.5-.2.9-.6 1.1-1.1Zm2.1.2c.5 1.3 1.8 2.1 3.2 1.8 1.1-.2 2-1.1 2.3-2.2.3-1.1 0-2.2-.8-3-.9-.7-2.1-.8-3.1-.3-1.2.6-1.9 1.9-1.6 3.7Z"
      />
      <circle cx="11.4" cy="6.2" r="0.7" fill="currentColor" />
    </svg>
  )
}

function FishIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.5 8c2.2-3.2 5.1-4.4 8.2-3.4 1.5.5 2.7 1.5 3.5 2.8L15 5.8v4.4l-1.8-1.6c-.8 1.3-2 2.3-3.5 2.8C6.6 12.4 3.7 11.2 1.5 8Zm3.3 0c0 .6.5 1.1 1.1 1.1S7 8.6 7 8s-.5-1.1-1.1-1.1S4.8 7.4 4.8 8Z"
      />
    </svg>
  )
}

function DolphinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.8 9.2c1.9-3.5 5.2-4.8 8.6-3.5 1.3.5 2.4 1.4 3.1 2.6l1.3-1.1v3.6l-1.4-1.1c-.4.8-1 1.5-1.8 2-.4.3-.9.4-1.4.4-1.1 0-2-.5-2.6-1.3-.7.7-1.7 1.1-2.8 1-1.7-.2-3-1.4-3-3.6Zm3.4-.2c0 .5.4.9.9.9s.9-.4.9-.9-.4-.9-.9-.9-.9.4-.9.9Z"
      />
      <path fill="currentColor" d="M7.2 4.2c.6-.9 1.6-1.5 2.7-1.5.3 0 .6 0 .8.1-.7.6-1.2 1.4-1.4 2.3-.7.1-1.4.4-2.1.8Z" />
    </svg>
  )
}

function WhaleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.2 8.6c1.8-3.8 5.4-5.4 9.2-4.2 1.6.5 2.9 1.6 3.6 3.1L15.5 6v4.2l-1.5-1.2c-.4 1-1.1 1.9-2.1 2.5-1.3.8-2.9.9-4.3.4l-.6 1.6-1.1-.4.5-1.4c-1.9-.8-3.4-2.3-4.2-4.1Zm3.6.1c0 .6.5 1.1 1.1 1.1s1.1-.5 1.1-1.1-.5-1.1-1.1-1.1-1.1.5-1.1 1.1Z"
      />
      <path fill="currentColor" d="M6.8 3.4c.8-1.1 2-1.8 3.4-1.8.4 0 .7.1 1.1.2-.9.7-1.5 1.7-1.7 2.8-1 .2-1.9.6-2.8 1.2Z" />
    </svg>
  )
}

const ICONS: Record<TradeSizeTier, (props: { className?: string }) => ReactNode> = {
  plankton: PlanktonIcon,
  shrimp: ShrimpIcon,
  fish: FishIcon,
  dolphin: DolphinIcon,
  whale: WhaleIcon,
}

export function TradeSizeIcon({
  usd,
  className = "",
}: {
  usd: number | string | null | undefined
  className?: string
}) {
  const info = tradeSizeFromUsd(usd)
  if (!info) return null
  const Icon = ICONS[info.tier]
  return (
    <span
      className={`inline-flex size-3.5 shrink-0 items-center justify-center ${TONE[info.tier]} ${className}`}
      title={`${info.label} · ${info.range}`}
      aria-label={`${info.label} trade (${info.range})`}
    >
      <Icon className="size-3.5" />
    </span>
  )
}
