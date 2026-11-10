import { formatScaled } from "./format"

export type PoolMcapAnchor = {
  quoteReserve: string
  marketCapUsd: string
}

type Scaled = { negative: boolean; scaled: bigint; places: number }

/** Newest row that has both a positive pool quote balance and a market cap. */
export function latestPoolMcapAnchor(
  trades: {
    blockNumber: number
    logIndex: number
    quoteReserve: string | null
    marketCapUsd: string | null
  }[],
): PoolMcapAnchor | null {
  let best: PoolMcapAnchor | null = null
  let bestBlock = -1
  let bestLog = -1
  for (const trade of trades) {
    if (!isPositiveDecimal(trade.quoteReserve) || !isPositiveDecimal(trade.marketCapUsd)) continue
    if (trade.blockNumber > bestBlock || (trade.blockNumber === bestBlock && trade.logIndex > bestLog)) {
      bestBlock = trade.blockNumber
      bestLog = trade.logIndex
      best = { quoteReserve: trade.quoteReserve, marketCapUsd: trade.marketCapUsd }
    }
  }
  return best
}

/**
 * Constant-product market cap at a different pooled quote amount.
 * Price (and therefore market cap) scales with the square of the quote
 * reserve, and the current pool amount reproduces the latest row exactly.
 */
export function marketCapAtPooledQuote(
  currentQuote: string,
  currentMarketCapUsd: string,
  pooledQuote: string,
): string | null {
  const current = parsePositive(currentQuote)
  const cap = parsePositive(currentMarketCapUsd)
  const pooled = parsePositive(normalizePooledQuote(pooledQuote))
  if (!current || !cap || !pooled) return null
  const places = Math.max(current.places, pooled.places)
  const currentScaled = current.scaled * 10n ** BigInt(places - current.places)
  const pooledScaled = pooled.scaled * 10n ** BigInt(places - pooled.places)
  if (currentScaled === 0n) return null
  const extra = 8
  const numer = cap.scaled * pooledScaled * pooledScaled * 10n ** BigInt(extra)
  const denom = currentScaled * currentScaled
  return formatScaled(numer / denom, cap.places + extra)
}

export function normalizePooledQuote(value: string): string {
  return value.trim().replace(/,/g, "").replace(/^\+/, "")
}

/** Short comparison such as "4× higher" or "same as the latest row". */
export function describeMcapMultiple(currentMarketCapUsd: string, nextMarketCapUsd: string): string {
  const current = Number(currentMarketCapUsd)
  const next = Number(nextMarketCapUsd)
  if (!Number.isFinite(current) || !Number.isFinite(next) || current <= 0 || next < 0) return ""
  const ratio = next / current
  if (!Number.isFinite(ratio)) return ""
  if (Math.abs(ratio - 1) < 0.0005) return "same as the latest row"
  const digits = ratio >= 100 ? 0 : ratio >= 10 ? 1 : 2
  const text = ratio.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")
  return `${text}× ${ratio > 1 ? "higher" : "lower"}`
}

export function trimDecimal(value: string): string {
  if (!value.includes(".")) return value
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
}

function parsePositive(value: string | null | undefined): Scaled | null {
  if (!value) return null
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const fraction = match[2] ?? ""
  const scaled = BigInt(match[1] + fraction)
  if (scaled <= 0n) return null
  return { negative: false, scaled, places: fraction.length }
}

function isPositiveDecimal(value: string | null | undefined): value is string {
  return parsePositive(value) !== null
}
