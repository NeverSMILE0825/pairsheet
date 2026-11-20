"use client"

import { DextoolsBotIcon } from "@/components/dextools-bot-icon"
import { formatQuoteAmount } from "@/lib/format"
import type { DextoolsBotProfit } from "@/lib/dextools-bots"

export function DextoolsBotPanel({
  profit,
  quoteSymbol,
  scanning,
}: {
  profit: DextoolsBotProfit
  quoteSymbol: string
  scanning: boolean
}) {
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-card px-3 py-1.5 ring-1 ring-foreground/10" aria-label="Bot and smart contract profit">
      <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        <DextoolsBotIcon className="h-3.5 w-auto" />
        Bot
      </h2>
      <Total
        label="With"
        detail={`${profit.withBuys.toLocaleString("en-US")} buy · ${profit.withSells.toLocaleString("en-US")} sell`}
        amount={profit.withProfit}
        quoteSymbol={quoteSymbol}
      />
      <Total
        label="Without"
        detail={`${profit.withoutBuys.toLocaleString("en-US")} buy · ${profit.withoutSells.toLocaleString("en-US")} sell`}
        amount={profit.withoutProfit}
        quoteSymbol={quoteSymbol}
      />
      {scanning ? <span className="text-xs text-muted-foreground">Matching…</span> : null}
      {!scanning && profit.unknown > 0 ? (
        <span className="text-xs text-muted-foreground">{profit.unknown.toLocaleString("en-US")} unmarked</span>
      ) : null}
    </section>
  )
}

function Total({
  label,
  detail,
  amount,
  quoteSymbol,
}: {
  label: string
  detail: string
  amount: string
  quoteSymbol: string
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono font-semibold ${profitTone(amount)}`}>
        {signedQuote(amount)} {quoteSymbol}
      </span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </span>
  )
}

function signedQuote(amount: string): string {
  const shown = formatQuoteAmount(amount)
  if (shown === "—" || shown === "0" || amount.startsWith("-")) return shown
  return `+${shown}`
}

function profitTone(amount: string): string {
  if (amount.startsWith("-")) return "text-rose-400"
  if (amount === "0") return "text-muted-foreground"
  return "text-emerald-400"
}
