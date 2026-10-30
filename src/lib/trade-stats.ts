import type { Side } from "./types"

export type TradeStats = {
  count: number
  buys: number
  sells: number
  adds: number
  removes: number
  volume: number
}

/** Count sides for the header stats. INIT is its own type — never counted as ADD. */
export function summarizeTrades(trades: { type: Side; totalUsd: string | null }[]): TradeStats {
  let buys = 0
  let sells = 0
  let adds = 0
  let removes = 0
  let volume = 0
  for (const trade of trades) {
    if (trade.type === "ADD") {
      adds += 1
      continue
    }
    if (trade.type === "REMOVE") {
      removes += 1
      continue
    }
    if (trade.type === "INIT") continue
    if (trade.type === "BUY") buys += 1
    else if (trade.type === "SELL") sells += 1
    const total = Number(trade.totalUsd)
    if (Number.isFinite(total)) volume += total
  }
  return {
    count: trades.length,
    buys,
    sells,
    adds,
    removes,
    volume,
  }
}
