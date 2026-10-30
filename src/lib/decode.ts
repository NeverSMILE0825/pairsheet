import { hexToUtf8 } from "./bytes"
import { formatScaled } from "./format"
import type { PoolContext, RawLog, Side } from "./types"

const Q96 = 1n << 96n

export const SWAP_V2_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"
export const SWAP_V3_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
/** Uniswap V4 PoolManager: Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24) */
export const SWAP_V4_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"
/** Uniswap V4 PoolManager: Initialize(bytes32,address,address,uint24,int24,address,uint160,int24) */
export const INIT_V4_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"
/** Uniswap V4 PoolManager: ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32) */
export const MODIFY_LIQUIDITY_V4_TOPIC =
  "0xf208f4912782fd25c7f114ca3723a2d5dd6f3bcc3ac8db5af63baa85f711d5ec"

export const MINT_V2_TOPIC =
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f"
export const BURN_V2_TOPIC =
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496"
export const MINT_V3_TOPIC =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde"
export const BURN_V3_TOPIC =
  "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c"

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const V2_FAMILY = [SWAP_V2_TOPIC, MINT_V2_TOPIC, BURN_V2_TOPIC]

export function isV2Family(topic: string): boolean {
  return V2_FAMILY.includes(topic.toLowerCase())
}

export function liquidityTopics(swapTopic: string): string[] {
  const topic = swapTopic.toLowerCase()
  if (topic === SWAP_V4_TOPIC) return [INIT_V4_TOPIC, MODIFY_LIQUIDITY_V4_TOPIC]
  return topic === SWAP_V3_TOPIC ? [MINT_V3_TOPIC, BURN_V3_TOPIC] : [MINT_V2_TOPIC, BURN_V2_TOPIC]
}

export type DecodedSwap = {
  type: Side
  baseRaw: bigint
  quoteRaw: bigint
}

export function topicOrder(dexId: string, dexName: string, style?: string): string[] {
  const label = `${dexId} ${dexName}`.toLowerCase()
  if (style === "v4" || /uniswap-v4|(^|[^0-9])v4([^0-9]|$)/.test(label)) {
    return [SWAP_V4_TOPIC]
  }
  const concentrated = /v3|algebra|slipstream|concentrated/.test(label)
  return concentrated
    ? [SWAP_V3_TOPIC, SWAP_V2_TOPIC]
    : [SWAP_V2_TOPIC, SWAP_V3_TOPIC]
}

export function decodeWord(data: string, index: number): bigint {
  const clean = data.startsWith("0x") ? data.slice(2) : data
  const word = clean.slice(index * 64, (index + 1) * 64)
  if (word.length !== 64) {
    throw new Error("Swap log data is shorter than expected")
  }
  return BigInt(`0x${word}`)
}

export function decodeInt256(data: string, index: number): bigint {
  const value = decodeWord(data, index)
  const limit = 1n << 255n
  return value >= limit ? value - (1n << 256n) : value
}

export function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function decodeSwap(log: RawLog, pool: PoolContext): DecodedSwap | null {
  const topic = (log.topics[0] || "").toLowerCase()
  if (topic === SWAP_V2_TOPIC) return decodeV2(log.data, pool)
  if (topic === SWAP_V3_TOPIC) return decodeV3(log.data, pool)
  if (topic === SWAP_V4_TOPIC) {
    if (pool.topic1 && (log.topics[1] || "").toLowerCase() !== pool.topic1.toLowerCase()) return null
    return decodeV4(log.data, pool)
  }
  if (topic === INIT_V4_TOPIC) {
    if (pool.topic1 && (log.topics[1] || "").toLowerCase() !== pool.topic1.toLowerCase()) return null
    return { type: "INIT", baseRaw: 0n, quoteRaw: 0n }
  }
  if (topic === MODIFY_LIQUIDITY_V4_TOPIC) {
    if (pool.topic1 && (log.topics[1] || "").toLowerCase() !== pool.topic1.toLowerCase()) return null
    return decodeV4ModifyLiquidity(log.data)
  }
  if (topic === MINT_V2_TOPIC) return decodeLiquidity(log.data, pool, 0, "ADD")
  if (topic === BURN_V2_TOPIC) return decodeLiquidity(log.data, pool, 0, "REMOVE")
  if (topic === MINT_V3_TOPIC) return decodeLiquidity(log.data, pool, 2, "ADD")
  if (topic === BURN_V3_TOPIC) return decodeLiquidity(log.data, pool, 1, "REMOVE")
  return null
}

function decodeLiquidity(
  data: string,
  pool: PoolContext,
  firstAmountWord: number,
  type: "ADD" | "REMOVE",
): DecodedSwap | null {
  const amount0 = decodeWord(data, firstAmountWord)
  const amount1 = decodeWord(data, firstAmountWord + 1)
  if (amount0 === 0n && amount1 === 0n) return null
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  return {
    type,
    baseRaw: baseIs0 ? amount0 : amount1,
    quoteRaw: baseIs0 ? amount1 : amount0,
  }
}

function decodeV4ModifyLiquidity(data: string): DecodedSwap | null {
  // data: tickLower, tickUpper, liquidityDelta, salt
  const liquidityDelta = decodeInt256(data, 2)
  if (liquidityDelta === 0n) return null
  return {
    type: liquidityDelta > 0n ? "ADD" : "REMOVE",
    // Token amounts are filled from the tx receipt (ModifyLiquidity has no amounts).
    baseRaw: 0n,
    quoteRaw: 0n,
  }
}

function flows(data: string, pool: PoolContext, v3: boolean) {
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  if (!v3) {
    const amount0In = decodeWord(data, 0)
    const amount1In = decodeWord(data, 1)
    const amount0Out = decodeWord(data, 2)
    const amount1Out = decodeWord(data, 3)
    const baseIn = baseIs0 ? amount0In : amount1In
    const baseOut = baseIs0 ? amount0Out : amount1Out
    const quoteIn = baseIs0 ? amount1In : amount0In
    const quoteOut = baseIs0 ? amount1Out : amount0Out
    return { baseIn, baseOut, quoteIn, quoteOut }
  }

  const amount0 = decodeInt256(data, 0)
  const amount1 = decodeInt256(data, 1)
  const baseDelta = baseIs0 ? amount0 : amount1
  const quoteDelta = baseIs0 ? amount1 : amount0
  return {
    baseIn: baseDelta > 0n ? baseDelta : 0n,
    baseOut: baseDelta < 0n ? -baseDelta : 0n,
    quoteIn: quoteDelta > 0n ? quoteDelta : 0n,
    quoteOut: quoteDelta < 0n ? -quoteDelta : 0n,
  }
}

/**
 * V4 Swap amounts are BalanceDelta for the caller: positive = caller received
 * that currency (tokens left the pool). That is the opposite of Uniswap V3's
 * pool-delta convention.
 */
function flowsV4(data: string, pool: PoolContext) {
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  const amount0 = decodeInt256(data, 0)
  const amount1 = decodeInt256(data, 1)
  const baseDelta = baseIs0 ? amount0 : amount1
  const quoteDelta = baseIs0 ? amount1 : amount0
  return {
    baseIn: baseDelta < 0n ? -baseDelta : 0n,
    baseOut: baseDelta > 0n ? baseDelta : 0n,
    quoteIn: quoteDelta < 0n ? -quoteDelta : 0n,
    quoteOut: quoteDelta > 0n ? quoteDelta : 0n,
  }
}

function classify(flow: {
  baseIn: bigint
  baseOut: bigint
  quoteIn: bigint
  quoteOut: bigint
}): DecodedSwap | null {
  if (flow.baseIn > 0n && flow.quoteOut > 0n && flow.baseIn >= flow.baseOut) {
    return { type: "SELL", baseRaw: flow.baseIn, quoteRaw: flow.quoteOut }
  }
  if (flow.quoteIn > 0n && flow.baseOut > 0n) {
    return { type: "BUY", baseRaw: flow.baseOut, quoteRaw: flow.quoteIn }
  }
  return null
}

export function decodeV2(data: string, pool: PoolContext): DecodedSwap | null {
  return classify(flows(data, pool, false))
}

export function decodeV3(data: string, pool: PoolContext): DecodedSwap | null {
  return classify(flows(data, pool, true))
}

export function decodeV4(data: string, pool: PoolContext): DecodedSwap | null {
  return classify(flowsV4(data, pool))
}

export function decodeAbiString(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex
  if (!clean || /^0+$/.test(clean)) return ""
  if (clean.length === 64) {
    return hexToUtf8(clean)
  }
  const offsetBytes = Number(BigInt(`0x${clean.slice(0, 64)}`))
  const start = offsetBytes * 2
  const length = Number(BigInt(`0x${clean.slice(start, start + 64)}`))
  const data = clean.slice(start + 64, start + 64 + length * 2)
  return hexToUtf8(data)
}

/**
 * Quote-token price of one base token from Uniswap V4 sqrtPriceX96.
 * token1/token0 = (sqrtPriceX96 / 2^96)^2; oriented to pool.base / pool.quote.
 */
export function priceQuoteFromV4SqrtPrice(
  sqrtPriceX96: bigint,
  pool: PoolContext,
  places = 18,
): string | null {
  if (sqrtPriceX96 === 0n) return null
  const scale = 10n ** BigInt(places)
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  const scaled = baseIs0
    ? (sqrtPriceX96 * sqrtPriceX96 * scale) / (Q96 * Q96)
    : (Q96 * Q96 * scale) / (sqrtPriceX96 * sqrtPriceX96)
  return formatScaled(scaled, places)
}

/** Initialize log data: fee, tickSpacing, hooks, sqrtPriceX96, tick. */
export function priceQuoteFromV4InitData(data: string, pool: PoolContext): string | null {
  try {
    return priceQuoteFromV4SqrtPrice(decodeWord(data, 3), pool)
  } catch {
    return null
  }
}

/** Find Initialize for this pool inside a receipt (same tx as the first ADD). */
export function priceQuoteFromV4InitLogs(
  pool: PoolContext,
  receiptLogs: { topics?: string[]; data?: string }[],
): string | null {
  const poolId = (pool.topic1 || "").toLowerCase()
  for (const log of receiptLogs) {
    if (!Array.isArray(log.topics) || typeof log.data !== "string") continue
    if ((log.topics[0] || "").toLowerCase() !== INIT_V4_TOPIC) continue
    if (poolId && (log.topics[1] || "").toLowerCase() !== poolId) continue
    return priceQuoteFromV4InitData(log.data, pool)
  }
  return null
}

/** Sum ERC-20 transfers of base/quote to or from the V4 PoolManager in a receipt. */
export function amountsFromV4Receipt(
  pool: PoolContext,
  type: "ADD" | "REMOVE",
  receiptLogs: { address?: string; topics?: string[]; data?: string }[],
): { baseRaw: bigint; quoteRaw: bigint } {
  let baseRaw = 0n
  let quoteRaw = 0n
  const manager = pool.logAddress.toLowerCase()
  const base = pool.base.address.toLowerCase()
  const quote = pool.quote.address.toLowerCase()

  for (const log of receiptLogs) {
    if (!log.address || !Array.isArray(log.topics) || log.topics.length < 3 || typeof log.data !== "string") continue
    if ((log.topics[0] || "").toLowerCase() !== TRANSFER_TOPIC) continue
    const token = log.address.toLowerCase()
    if (token !== base && token !== quote) continue
    const from = `0x${log.topics[1].slice(-40).toLowerCase()}`
    const to = `0x${log.topics[2].slice(-40).toLowerCase()}`
    let amount = 0n
    try {
      amount = BigInt(log.data)
    } catch {
      continue
    }
    if (amount === 0n) continue
    const intoManager = to === manager && from !== manager
    const outOfManager = from === manager && to !== manager
    const count = type === "ADD" ? intoManager : outOfManager
    if (!count) continue
    if (token === base) baseRaw += amount
    if (token === quote) quoteRaw += amount
  }

  // Native currency has no ERC-20 Transfer — leave 0 (DEXTools shows 0 ETH on one-sided adds).
  return { baseRaw, quoteRaw }
}
