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
    <section className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10" aria-label="Bot and smart contract profit">
      <div className="flex flex-wrap items-center gap-2">
        <DextoolsBotIcon className="size-[18px]" />
        <h2 className="text-sm font-semibold tracking-tight">Bot / Smart contract</h2>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Same mark DEXTools puts on a swap. Buys add {quoteSymbol}. Sells subtract it. Loaded with every swap tape.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Total
          label="With icon"
          detail={`${profit.withBuys.toLocaleString("en-US")} buy${profit.withBuys === 1 ? "" : "s"} · ${profit.withSells.toLocaleString("en-US")} sell${profit.withSells === 1 ? "" : "s"}`}
          amount={profit.withProfit}
          quoteSymbol={quoteSymbol}
        />
        <Total
          label="Without icon"
          detail={`${profit.withoutBuys.toLocaleString("en-US")} buy${profit.withoutBuys === 1 ? "" : "s"} · ${profit.withoutSells.toLocaleString("en-US")} sell${profit.withoutSells === 1 ? "" : "s"}`}
          amount={profit.withoutProfit}
          quoteSymbol={quoteSymbol}
        />
      </div>
      {scanning ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Matching Bot / Smart contract marks from DEXTools…
        </p>
      ) : null}
      {!scanning && profit.unknown > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {profit.unknown.toLocaleString("en-US")} buy/sell row{profit.unknown === 1 ? "" : "s"} were not on the DEXTools tape, so they are in neither total.
        </p>
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
    <div className="rounded-xl bg-muted/40 px-3 py-2">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold ${profitTone(amount)}`}>
        {signedQuote(amount)} {quoteSymbol}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
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
