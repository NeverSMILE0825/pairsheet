import { netQuoteFlow } from "./team-labels"

/** Trades with no Funded by address share this row so they can be checked or left out. */
export const UNKNOWN_FUNDER_KEY = "__none__"

export type FunderProfitTrade = {
  type: string
  quoteAmount: string
  fundedBy: string | null
  fundedByAddress: string | null
}

export type FunderProfitRow = {
  key: string
  label: string
  address: string | null
  count: number
  buys: number
  sells: number
  profit: string
}

export type FunderProfitSummary = {
  rows: FunderProfitRow[]
  selectedProfit: string
  excludedProfit: string
  selectedSwaps: number
  excludedSwaps: number
}

/**
 * Plain click toggles one source. Shift+click checks every source from the
 * anchor through this one, in the order shown.
 */
export function sourceClickSelection(
  keys: readonly string[],
  anchor: number | null,
  index: number,
  shiftKey: boolean,
): { mode: "add" | "toggle"; keys: string[]; anchor: number } | null {
  if (index < 0 || index >= keys.length) return null
  if (shiftKey && anchor !== null && anchor >= 0 && anchor < keys.length) {
    const from = Math.min(anchor, index)
    const to = Math.max(anchor, index)
    return { mode: "add", keys: keys.slice(from, to + 1), anchor: index }
  }
  return { mode: "toggle", keys: [keys[index]], anchor: index }
}

export function funderProfitKey(trade: { fundedByAddress: string | null }): string {
  const address = trade.fundedByAddress?.trim() ?? ""
  if (!address) return UNKNOWN_FUNDER_KEY
  if (/^0x[a-f0-9]+$/i.test(address)) return address.toLowerCase()
  return address
}

/** Group the tape by Funded by. Profit adds buy quote and subtracts sell quote. */
export function summarizeFunderProfit(
  trades: FunderProfitTrade[],
  selected: ReadonlySet<string>,
): FunderProfitSummary {
  const groups = new Map<string, FunderProfitTrade[]>()
  const labels = new Map<string, { label: string; address: string | null }>()
  for (const trade of trades) {
    const key = funderProfitKey(trade)
    const rows = groups.get(key)
    if (rows) rows.push(trade)
    else groups.set(key, [trade])
    const named = trade.fundedBy?.trim() ?? ""
    const current = labels.get(key)
    if (!current) {
      labels.set(key, {
        label: named || (key === UNKNOWN_FUNDER_KEY ? "Unknown" : key),
        address: key === UNKNOWN_FUNDER_KEY ? null : trade.fundedByAddress,
      })
    } else if (named && (current.label === key || current.label === "Unknown")) {
      current.label = named
    }
  }

  const rows: FunderProfitRow[] = []
  const selectedTrades: FunderProfitTrade[] = []
  const excludedTrades: FunderProfitTrade[] = []
  for (const [key, group] of groups) {
    const meta = labels.get(key) ?? { label: key === UNKNOWN_FUNDER_KEY ? "Unknown" : key, address: null }
    rows.push({
      key,
      label: meta.label,
      address: meta.address,
      count: group.length,
      buys: group.filter((trade) => trade.type === "BUY").length,
      sells: group.filter((trade) => trade.type === "SELL").length,
      profit: netQuoteFlow(group),
    })
    const bucket = selected.has(key) ? selectedTrades : excludedTrades
    for (const trade of group) bucket.push(trade)
  }
  rows.sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
  return {
    rows,
    selectedProfit: netQuoteFlow(selectedTrades),
    excludedProfit: netQuoteFlow(excludedTrades),
    selectedSwaps: selectedTrades.filter((trade) => trade.type === "BUY" || trade.type === "SELL").length,
    excludedSwaps: excludedTrades.filter((trade) => trade.type === "BUY" || trade.type === "SELL").length,
  }
}
