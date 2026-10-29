import { mapPool, rpcBatch } from "./http"
import type { Trade } from "./types"

const GWEI = 10n ** 9n
const ETH = 10n ** 18n
const CANONICAL_GWEI = /^\d+\.\d{3}$/

export type ReceiptGas = {
  gasUsed: bigint
  effectiveGasPrice: bigint
}

/** Effective gas price in gwei with exactly 3 decimal places (rounds half up). */
export function formatGasPriceGwei(effectiveGasPriceWei: bigint): string {
  const scale = 10n ** 6n // 9 - 3
  const rounded =
    effectiveGasPriceWei >= 0n
      ? (effectiveGasPriceWei + scale / 2n) / scale
      : -((-effectiveGasPriceWei + scale / 2n) / scale)
  const negative = rounded < 0n
  const value = negative ? -rounded : rounded
  const whole = value / 1000n
  const frac = (value % 1000n).toString().padStart(3, "0")
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`
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

export function isCanonicalGasPrice(value: string | null | undefined): boolean {
  return typeof value === "string" && CANONICAL_GWEI.test(value)
}

/** Normalize a stored gwei string to exactly 3 decimals. */
export function normalizeGasPriceString(raw: string): string | null {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return null
  return value.toFixed(3)
}

export function tradeNeedsGasFetch(trade: Trade): boolean {
  return !trade.gasPriceGwei || !trade.gasFeeWei
}

export function tradesNeedGasRepair(trades: Trade[]): boolean {
  return trades.some(
    (trade) =>
      tradeNeedsGasFetch(trade) ||
      !isCanonicalGasPrice(trade.gasPriceGwei) ||
      (Boolean(trade.gasFeeWei) && !trade.gasFeeTotalEth),
  )
}

/** Fix gwei formatting on already-saved trades (no RPC). */
export function normalizeTradeGasFormats(trades: Trade[]): { trades: Trade[]; changed: boolean } {
  let changed = false
  const next = trades.map((trade) => {
    if (!trade.gasPriceGwei || isCanonicalGasPrice(trade.gasPriceGwei)) return trade
    const normalized = normalizeGasPriceString(trade.gasPriceGwei)
    if (!normalized || normalized === trade.gasPriceGwei) return trade
    changed = true
    return { ...trade, gasPriceGwei: normalized }
  })
  return { trades: next, changed }
}

export async function fetchReceiptGasMap(
  rpcs: string[],
  hashes: string[],
): Promise<Map<string, ReceiptGas>> {
  const out = new Map<string, ReceiptGas>()
  const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()).filter(Boolean))]
  if (unique.length === 0 || rpcs.length === 0) return out
  const batches: string[][] = []
  for (let index = 0; index < unique.length; index += 20) batches.push(unique.slice(index, index + 20))
  await mapPool(batches, 4, async (batch) => {
    for (const rpc of rpcs) {
      try {
        const results = await rpcBatch(
          rpc,
          batch.map((hash) => ({ method: "eth_getTransactionReceipt", params: [hash] })),
        )
        results.forEach((receipt, id) => {
          const hash = batch[id]
          const gas = parseReceiptGas(receipt)
          if (hash && gas) out.set(hash, gas)
        })
        if (batch.every((hash) => out.has(hash))) return
      } catch {
        continue
      }
    }
  })
  return out
}

/**
 * Repair empty / non-canonical gas fields on a loaded tape.
 * Fetches receipts only for trades missing price or fee wei.
 */
export async function repairTradeGas(
  trades: Trade[],
  rpcs: string[] | null,
): Promise<{ trades: Trade[]; changed: boolean; fetched: number }> {
  const formatted = normalizeTradeGasFormats(trades)
  let next = formatted.trades
  let changed = formatted.changed
  let fetched = 0

  const missing = next.filter(tradeNeedsGasFetch)
  if (rpcs && rpcs.length > 0 && missing.length > 0) {
    const map = await fetchReceiptGasMap(
      rpcs,
      missing.map((trade) => trade.txHash),
    )
    fetched = map.size
    if (map.size > 0) {
      next = applyGasFees(next, map)
      changed = true
    }
  }

  if (changed || next.some((trade) => trade.gasFeeWei && !trade.gasFeeTotalEth)) {
    next = assignGasFeeTotals(next)
    changed = true
  }

  const polished = normalizeTradeGasFormats(next)
  return { trades: polished.trades, changed: changed || polished.changed, fetched }
}
