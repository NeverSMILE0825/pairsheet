import { marketCapFromPrice, mulDecimals, sumDecimals } from "./format"
import type { Trade } from "./types"

function negateAmount(amount: string): string {
  if (amount.startsWith("-")) return amount.slice(1) || "0"
  if (amount === "0" || amount === "0.0") return "0"
  return `-${amount}`
}

function chronological(trades: Trade[]): Trade[] {
  return [...trades].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
    return a.logIndex - b.logIndex
  })
}

/** Infer USD per 1 quote token from any priced buy/sell on the tape. */
export function inferQuoteUsdPrice(trades: Trade[]): number | null {
  for (const trade of trades) {
    if (trade.type !== "BUY" && trade.type !== "SELL") continue
    if (!trade.totalUsd || !trade.quoteAmount) continue
    const total = Number(trade.totalUsd)
    const quote = Number(trade.quoteAmount)
    if (!(total > 0) || !(quote > 0)) continue
    const unit = total / quote
    if (Number.isFinite(unit) && unit > 0) return unit
  }
  return null
}

/**
 * Actual V4 pool balances after each event (not virtual L/√P reserves).
 * BUY: pool loses base, gains quote. SELL: opposite. ADD/REMOVE: ± both.
 */
export function applyLedgerPoolReserves(trades: Trade[]): Trade[] {
  if (trades.length === 0) return trades
  let base = "0"
  let quote = "0"
  const after = new Map<string, { base: string; quote: string }>()
  for (const trade of chronological(trades)) {
    switch (trade.type) {
      case "INIT":
        base = "0"
        quote = "0"
        break
      case "ADD":
        base = sumDecimals([base, trade.baseAmount])
        quote = sumDecimals([quote, trade.quoteAmount])
        break
      case "REMOVE":
        base = sumDecimals([base, negateAmount(trade.baseAmount)])
        quote = sumDecimals([quote, negateAmount(trade.quoteAmount)])
        break
      case "BUY":
        base = sumDecimals([base, negateAmount(trade.baseAmount)])
        quote = sumDecimals([quote, trade.quoteAmount])
        break
      case "SELL":
        base = sumDecimals([base, trade.baseAmount])
        quote = sumDecimals([quote, negateAmount(trade.quoteAmount)])
        break
    }
    after.set(trade.id, { base, quote })
  }
  return trades.map((trade) => {
    const size = after.get(trade.id)
    if (!size) return trade
    return { ...trade, baseReserve: size.base, quoteReserve: size.quote }
  })
}

function missingUsd(value: string | null): boolean {
  return value == null || value === "" || value === "0" || Number(value) === 0
}

/**
 * Backfill Uniswap V4 INIT unit price and one-sided ADD totals (DEXTools-style),
 * then replace virtual pool columns with the ledger balances above.
 */
export function finalizeV4Tape(trades: Trade[], baseTotalSupply: string | null): Trade[] {
  if (trades.length === 0) return trades

  const ordered = chronological(trades)
  let initPriceQuote: string | null = null
  let initPriceUsd: string | null = null
  for (const trade of ordered) {
    if (trade.type !== "INIT") continue
    if (trade.priceQuote) initPriceQuote = trade.priceQuote
    if (trade.priceUsd) initPriceUsd = trade.priceUsd
  }

  const quoteUsd =
    initPriceUsd && initPriceQuote && Number(initPriceQuote) > 0
      ? Number(initPriceUsd) / Number(initPriceQuote)
      : inferQuoteUsdPrice(trades)

  if (!initPriceUsd && initPriceQuote && quoteUsd != null) {
    initPriceUsd = mulDecimals(initPriceQuote, String(quoteUsd))
  }
  if (!initPriceUsd) {
    const firstPriced = ordered.find(
      (trade) => (trade.type === "BUY" || trade.type === "SELL") && trade.priceUsd,
    )
    if (firstPriced?.priceUsd) initPriceUsd = firstPriced.priceUsd
  }

  const priced = trades.map((trade) => {
    if (trade.type === "INIT") {
      const priceQuote = trade.priceQuote ?? initPriceQuote
      let priceUsd = trade.priceUsd
      if (!priceUsd && priceQuote && quoteUsd != null) {
        priceUsd = mulDecimals(priceQuote, String(quoteUsd))
      }
      if (!priceUsd) priceUsd = initPriceUsd
      return {
        ...trade,
        priceQuote,
        priceUsd,
        marketCapUsd: marketCapFromPrice(priceUsd, baseTotalSupply),
        totalUsd: null,
      }
    }

    if (trade.type === "ADD" || trade.type === "REMOVE") {
      if (!missingUsd(trade.totalUsd)) return trade
      const base = Number(trade.baseAmount)
      const quote = Number(trade.quoteAmount)
      let total = trade.totalUsd
      if (quote > 0 && quoteUsd != null) {
        total = mulDecimals(trade.quoteAmount, String(quoteUsd))
      } else if (base > 0 && initPriceUsd) {
        total = mulDecimals(trade.baseAmount, initPriceUsd)
      }
      if (missingUsd(total)) return trade
      return { ...trade, totalUsd: total }
    }

    return trade
  })

  return applyLedgerPoolReserves(priced)
}
