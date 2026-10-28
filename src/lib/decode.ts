import { hexToUtf8 } from "./bytes"
import type { PoolContext, RawLog, Side } from "./types"

export const SWAP_V2_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822"
export const SWAP_V3_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67"
/** Uniswap V4 PoolManager: Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24) */
export const SWAP_V4_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"

export const MINT_V2_TOPIC =
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f"
export const BURN_V2_TOPIC =
  "0xdccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496"
export const MINT_V3_TOPIC =
  "0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde"
export const BURN_V3_TOPIC =
  "0x0c396cd989a39f4459b5fa1aed6a9a8dcdbc45908acfd67e028cd568da98982c"

const V2_FAMILY = [SWAP_V2_TOPIC, MINT_V2_TOPIC, BURN_V2_TOPIC]

export function isV2Family(topic: string): boolean {
  return V2_FAMILY.includes(topic.toLowerCase())
}

export function liquidityTopics(swapTopic: string): string[] {
  const topic = swapTopic.toLowerCase()
  if (topic === SWAP_V4_TOPIC) return []
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
    return decodeV3(log.data, pool)
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
