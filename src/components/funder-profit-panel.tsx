"use client"

import { useMemo, useState } from "react"
import { formatQuoteAmount, shortAddress } from "@/lib/format"
import { UNKNOWN_FUNDER_KEY, type FunderProfitRow } from "@/lib/funder-profit"

export function FunderProfitPanel({
  rows,
  selected,
  selectedProfit,
  excludedProfit,
  selectedSwaps,
  excludedSwaps,
  quoteSymbol,
  needsLookup,
  onToggle,
  onSelectAll,
  onClear,
}: {
  rows: FunderProfitRow[]
  selected: ReadonlySet<string>
  selectedProfit: string
  excludedProfit: string
  selectedSwaps: number
  excludedSwaps: number
  quoteSymbol: string
  needsLookup: boolean
  onToggle: (key: string) => void
  onSelectAll: () => void
  onClear: () => void
}) {
  const [query, setQuery] = useState("")
  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (!needle) return rows
    return rows.filter((row) => {
      const address = row.address?.toLowerCase() ?? ""
      return row.label.toLowerCase().includes(needle) || address.includes(needle)
    })
  }, [rows, needle])
  const checked = rows.filter((row) => selected.has(row.key)).length

  return (
    <section className="rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10" aria-label="Funded by profit">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Funded by profit</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Buys add {quoteSymbol}. Sells subtract it. Adds and removes are left out.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="text-xs text-foreground underline-offset-2 hover:underline" onClick={onSelectAll}>
            Select all
          </button>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={onClear}>
            Clear
          </button>
        </div>
      </div>

      {needsLookup ? (
        <p className="mt-2 text-xs text-muted-foreground">Load Funded by to split wallets. Until then every row is Unknown.</p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ProfitTotal
          label="Selected"
          detail={`${checked.toLocaleString("en-US")} source${checked === 1 ? "" : "s"} · ${selectedSwaps.toLocaleString("en-US")} swap${selectedSwaps === 1 ? "" : "s"}`}
          amount={selectedProfit}
          quoteSymbol={quoteSymbol}
        />
        <ProfitTotal
          label="Excluding selected"
          detail={`${(rows.length - checked).toLocaleString("en-US")} source${rows.length - checked === 1 ? "" : "s"} · ${excludedSwaps.toLocaleString("en-US")} swap${excludedSwaps === 1 ? "" : "s"}`}
          amount={excludedProfit}
          quoteSymbol={quoteSymbol}
        />
      </div>

      <label className="mt-3 block text-xs text-muted-foreground">
        Find a source
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or address"
          spellCheck={false}
          className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>

      <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-1 py-3 text-sm text-muted-foreground">No funded-by source matches.</li>
        ) : (
          visible.map((row) => (
            <li key={row.key}>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-muted/60">
                <input
                  type="checkbox"
                  checked={selected.has(row.key)}
                  onChange={() => onToggle(row.key)}
                  aria-label={`Include ${row.label}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{sourceTitle(row)}</span>
                  {row.address ? (
                    <span className="block truncate font-mono text-xs text-muted-foreground">{shortAddress(row.address)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right text-xs text-muted-foreground">
                  {row.buys.toLocaleString("en-US")} buy{row.buys === 1 ? "" : "s"} · {row.sells.toLocaleString("en-US")} sell
                  {row.sells === 1 ? "" : "s"}
                </span>
                <span className={`shrink-0 font-mono text-sm ${profitTone(row.profit)}`}>{signedQuote(row.profit)}</span>
              </label>
            </li>
          ))
        )}
      </ul>
    </section>
  )
}

function ProfitTotal({
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

function sourceTitle(row: FunderProfitRow): string {
  if (row.key === UNKNOWN_FUNDER_KEY) return "Unknown"
  if (row.address && row.label.toLowerCase() === row.address.toLowerCase()) return shortAddress(row.address)
  return row.label
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
