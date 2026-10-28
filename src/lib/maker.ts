import { compareDecimal, decimalRatio, mulDecimals, normalizeAddress, sumDecimals } from "./format"
import type { Trade } from "./types"

export type MakerSummary = {
  buys: number
  sells: number
  adds: number
  removes: number
  boughtUsd: string | null
  soldUsd: string | null
  pnlUsd: string | null
  boughtBase: string
  soldBase: string
  balanceBase: string
  boughtQuote: string
  soldQuote: string
  pnlQuote: string
}

export function summarizeMakers(trades: Trade[]): Map<string, MakerSummary> {
  const groups = new Map<string, Trade[]>()
  for (const trade of trades) {
    const key = normalizeAddress(trade.maker)
    if (!key) continue
    const rows = groups.get(key)
    if (rows) rows.push(trade)
    else groups.set(key, [trade])
  }
  const summaries = new Map<string, MakerSummary>()
  for (const [key, rows] of groups) summaries.set(key, summarizeMaker(rows))
  return summaries
}

// Buy and sell totals for one wallet. Liquidity adds and removes are counted
// separately and left out of the amounts, matching the DEXTools maker card.
export function summarizeMaker(trades: Trade[]): MakerSummary {
  const buys = trades.filter((trade) => trade.type === "BUY")
  const sells = trades.filter((trade) => trade.type === "SELL")
  const boughtUsd = sumSideUsd(buys)
  const soldUsd = sumSideUsd(sells)
  const boughtBase = sumDecimals(buys.map((trade) => trade.baseAmount))
  const soldBase = sumDecimals(sells.map((trade) => trade.baseAmount))
  const boughtQuote = sumDecimals(buys.map((trade) => trade.quoteAmount))
  const soldQuote = sumDecimals(sells.map((trade) => trade.quoteAmount))
  return {
    buys: buys.length,
    sells: sells.length,
    adds: trades.filter((trade) => trade.type === "ADD").length,
    removes: trades.filter((trade) => trade.type === "REMOVE").length,
    boughtUsd,
    soldUsd,
    pnlUsd: boughtUsd !== null && soldUsd !== null ? sumDecimals([soldUsd, `-${boughtUsd}`]) : null,
    boughtBase,
    soldBase,
    balanceBase: sumDecimals([boughtBase, `-${soldBase}`]),
    boughtQuote,
    soldQuote,
    pnlQuote: sumDecimals([soldQuote, `-${boughtQuote}`]),
  }
}

export function latestQuotePrice(trades: Trade[]): string | null {
  let bestTime = ""
  let bestIndex = -1
  let price: string | null = null
  for (const trade of trades) {
    if (!trade.priceQuote) continue
    if (trade.timestamp > bestTime || (trade.timestamp === bestTime && trade.logIndex > bestIndex)) {
      bestTime = trade.timestamp
      bestIndex = trade.logIndex
      price = trade.priceQuote
    }
  }
  return price
}

// Mark-to-market value of tokens still held (bought minus sold). Empty when
// the wallet is flat or short in the loaded tape, or when no price is known.
export function holdingValue(balanceBase: string, price: string | null): string | null {
  if (!price) return null
  if (compareDecimal(balanceBase, "0") <= 0) return null
  return mulDecimals(balanceBase, price)
}

export function balanceShare(balanceBase: string, boughtBase: string): number {
  return decimalRatio(balanceBase, boughtBase)
}

function sumSideUsd(trades: Trade[]): string | null {
  if (trades.length === 0) return "0"
  const values = trades.flatMap((trade) => (trade.totalUsd ? [trade.totalUsd] : []))
  if (values.length === 0) return null
  return sumDecimals(values)
}
