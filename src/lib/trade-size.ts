/** DEXTools trade-size animals (same tiers + colors as Pair Explorer). */
export type TradeSizeTier = "flea" | "shrimp" | "fish" | "dolphin" | "whale"

export type TradeSizeInfo = {
  tier: TradeSizeTier
  label: string
  /** Short range shown in tooltips. */
  range: string
  color: string
}

const TIERS: { tier: TradeSizeTier; min: number; label: string; range: string; color: string }[] = [
  { tier: "whale", min: 100_000, label: "Whale", range: "$100k+", color: "#35c4dc" },
  { tier: "dolphin", min: 10_000, label: "Dolphin", range: "$10k–$100k", color: "#818ea1" },
  { tier: "fish", min: 1_000, label: "Fish", range: "$1k–$10k", color: "#8183f4" },
  { tier: "shrimp", min: 1, label: "Shrimp", range: "$1–$1k", color: "#fa8e42" },
  { tier: "flea", min: 0, label: "Flea", range: "under $1", color: "#bf8c00" },
]

export function tradeSizeFromUsd(usd: number | string | null | undefined): TradeSizeInfo | null {
  if (usd === null || usd === undefined || usd === "") return null
  const value = typeof usd === "number" ? usd : Number(usd)
  if (!Number.isFinite(value) || value < 0) return null
  for (const tier of TIERS) {
    if (value >= tier.min) {
      return { tier: tier.tier, label: tier.label, range: tier.range, color: tier.color }
    }
  }
  return TIERS[TIERS.length - 1]
}

/** Quote-token USD unit price implied by a trade's total and quote amount. */
export function quoteUsdPriceFromTrade(totalUsd: string | null, quoteAmount: string): number | null {
  if (!totalUsd) return null
  const total = Number(totalUsd)
  const quote = Number(quoteAmount)
  if (!Number.isFinite(total) || !Number.isFinite(quote) || quote <= 0) return null
  const price = total / quote
  return Number.isFinite(price) && price > 0 ? price : null
}

export function latestQuoteUsdPrice(
  trades: { totalUsd: string | null; quoteAmount: string; timestamp: string; logIndex: number }[],
): number | null {
  let bestTime = ""
  let bestIndex = -1
  let price: number | null = null
  for (const trade of trades) {
    const unit = quoteUsdPriceFromTrade(trade.totalUsd, trade.quoteAmount)
    if (unit === null) continue
    if (trade.timestamp > bestTime || (trade.timestamp === bestTime && trade.logIndex > bestIndex)) {
      bestTime = trade.timestamp
      bestIndex = trade.logIndex
      price = unit
    }
  }
  return price
}

export function quoteAmountToUsd(amount: string | null, quoteUsdPrice: number | null): number | null {
  if (!amount || quoteUsdPrice === null) return null
  const qty = Number(amount)
  if (!Number.isFinite(qty) || qty < 0) return null
  const usd = qty * quoteUsdPrice
  return Number.isFinite(usd) ? usd : null
}
