import type { Trade } from "./types"

const GWEI = 10n ** 9n
const ETH = 10n ** 18n

export type ReceiptGas = {
  gasUsed: bigint
  effectiveGasPrice: bigint
}

/** Effective gas price in gwei (string; trim trailing zeros). */
export function formatGasPriceGwei(effectiveGasPriceWei: bigint): string {
  const whole = effectiveGasPriceWei / GWEI
  const frac = effectiveGasPriceWei % GWEI
  if (frac === 0n) return whole.toString()
  const fracText = frac.toString().padStart(9, "0").replace(/0+$/, "")
  return `${whole.toString()}.${fracText}`
}

/** ETH amount with exactly 4 decimal places (rounds half up). */
export function formatEth4(wei: bigint): string {
  const scale = 10n ** 14n // 18 - 4
  const rounded = wei >= 0n ? (wei + scale / 2n) / scale : -((-wei + scale / 2n) / scale)
  const negative = rounded < 0n
  const value = negative ? -rounded : rounded
  const whole = value / 10_000n
  const frac = (value % 10_000n).toString().padStart(4, "0")
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`
}

export function feeWeiFromReceipt(gas: ReceiptGas): bigint {
  return gas.gasUsed * gas.effectiveGasPrice
}

export function parseReceiptGas(receipt: unknown): ReceiptGas | null {
  if (!receipt || typeof receipt !== "object") return null
  const row = receipt as {
    gasUsed?: unknown
    effectiveGasPrice?: unknown
    gasPrice?: unknown
  }
  const gasUsed = parseHexBigInt(row.gasUsed)
  const price = parseHexBigInt(row.effectiveGasPrice) ?? parseHexBigInt(row.gasPrice)
  if (gasUsed === null || price === null) return null
  return { gasUsed, effectiveGasPrice: price }
}

function parseHexBigInt(value: unknown): bigint | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) {
    try {
      return BigInt(value)
    } catch {
      return null
    }
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value))
  }
  return null
}

/**
 * Fill gasPriceGwei + gasFeeWei from a receipt map, then set gasFeeTotalEth as the
 * running sum of unique tx fees in chronological order (oldest first).
 * Shared tx hashes only add once to the running total.
 */
export function applyGasFees(
  trades: Trade[],
  gasByTx: Map<string, ReceiptGas>,
): Trade[] {
  const withFees = trades.map((trade) => {
    const gas = gasByTx.get(trade.txHash.toLowerCase())
    if (!gas) {
      return {
        ...trade,
        gasPriceGwei: trade.gasPriceGwei ?? null,
        gasFeeWei: trade.gasFeeWei ?? null,
        gasFeeTotalEth: null as string | null,
      }
    }
    const feeWei = feeWeiFromReceipt(gas)
    return {
      ...trade,
      gasPriceGwei: formatGasPriceGwei(gas.effectiveGasPrice),
      gasFeeWei: feeWei.toString(),
      gasFeeTotalEth: null as string | null,
    }
  })
  return assignGasFeeTotals(withFees)
}

/** Recompute cumulative ETH totals from gasFeeWei (call after full history is loaded). */
export function assignGasFeeTotals(trades: Trade[]): Trade[] {
  const ranked = [...trades].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex || a.id.localeCompare(b.id),
  )
  const totals = new Map<string, string | null>()
  const seen = new Set<string>()
  let running = 0n
  for (const trade of ranked) {
    const hash = trade.txHash.toLowerCase()
    const feeWei = trade.gasFeeWei && /^\d+$/.test(trade.gasFeeWei) ? BigInt(trade.gasFeeWei) : null
    if (feeWei !== null && !seen.has(hash)) {
      running += feeWei
      seen.add(hash)
    }
    totals.set(trade.id, feeWei !== null || seen.has(hash) ? formatEth4(running) : null)
  }
  return trades.map((trade) => ({
    ...trade,
    gasPriceGwei: trade.gasPriceGwei ?? null,
    gasFeeWei: trade.gasFeeWei ?? null,
    gasFeeTotalEth: totals.get(trade.id) ?? null,
  }))
}

export function ethFromWei(wei: bigint): string {
  const whole = wei / ETH
  const frac = wei % ETH
  if (frac === 0n) return whole.toString()
  return `${whole.toString()}.${frac.toString().padStart(18, "0").replace(/0+$/, "")}`
}
