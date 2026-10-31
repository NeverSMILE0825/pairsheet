import {
  INIT_V4_TOPIC,
  SWAP_V4_TOPIC,
  decodeInt256,
  decodeWord,
  sameAddress,
} from "./decode"
import type { PoolContext } from "./types"

const Q96 = 1n << 96n
const MIN_TICK = -887272
const MAX_TICK = 887272

export type V4ModifyParsed = {
  tickLower: number
  tickUpper: number
  liquidityDelta: bigint
}

/** Parse ModifyLiquidity event data: tickLower, tickUpper, liquidityDelta, salt. */
export function parseV4ModifyLiquidity(data: string): V4ModifyParsed | null {
  try {
    const tickLower = Number(decodeInt256(data, 0))
    const tickUpper = Number(decodeInt256(data, 1))
    const liquidityDelta = decodeInt256(data, 2)
    if (liquidityDelta === 0n) return null
    if (!Number.isFinite(tickLower) || !Number.isFinite(tickUpper)) return null
    if (tickLower < MIN_TICK || tickUpper > MAX_TICK || tickLower >= tickUpper) return null
    return { tickLower, tickUpper, liquidityDelta }
  } catch {
    return null
  }
}

/**
 * Uniswap TickMath.getSqrtRatioAtTick — sqrt(1.0001^tick) * 2^96 as Q64.96.
 * Ported from v3/v4 core.
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error("Tick out of range")
  }
  const absTick = tick < 0 ? -tick : tick
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n
  if ((absTick & 0x2) !== 0) ratio = (ratio * 0xfff97272373d413259a46990580e213an) >> 128n
  if ((absTick & 0x4) !== 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdccn) >> 128n
  if ((absTick & 0x8) !== 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0n) >> 128n
  if ((absTick & 0x10) !== 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644n) >> 128n
  if ((absTick & 0x20) !== 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0n) >> 128n
  if ((absTick & 0x40) !== 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861n) >> 128n
  if ((absTick & 0x80) !== 0) ratio = (ratio * 0xfe5dee046a99a2a911cd461f65a313f4n) >> 128n
  if ((absTick & 0x100) !== 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4n) >> 128n
  if ((absTick & 0x200) !== 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf5802212n) >> 128n
  if ((absTick & 0x400) !== 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3n) >> 128n
  if ((absTick & 0x800) !== 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9n) >> 128n
  if ((absTick & 0x1000) !== 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825n) >> 128n
  if ((absTick & 0x2000) !== 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5n) >> 128n
  if ((absTick & 0x4000) !== 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7n) >> 128n
  if ((absTick & 0x8000) !== 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6n) >> 128n
  if ((absTick & 0x10000) !== 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9n) >> 128n
  if ((absTick & 0x20000) !== 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604n) >> 128n
  if ((absTick & 0x40000) !== 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98n) >> 128n
  if ((absTick & 0x80000) !== 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2n) >> 128n

  if (tick > 0) ratio = (2n ** 256n - 1n) / ratio

  // Round up to Q32 → Q64.96
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  let a = sqrtA
  let b = sqrtB
  if (a > b) [a, b] = [b, a]
  if (a === 0n) return 0n
  return (liquidity * Q96 * (b - a)) / b / a
}

export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  let a = sqrtA
  let b = sqrtB
  if (a > b) [a, b] = [b, a]
  return (liquidity * (b - a)) / Q96
}

/** Token amounts locked for liquidity L at current sqrtPrice (Uniswap LiquidityAmounts). */
export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  let a = sqrtA
  let b = sqrtB
  if (a > b) [a, b] = [b, a]
  if (sqrtPriceX96 <= a) {
    return { amount0: getAmount0ForLiquidity(a, b, liquidity), amount1: 0n }
  }
  if (sqrtPriceX96 < b) {
    return {
      amount0: getAmount0ForLiquidity(sqrtPriceX96, b, liquidity),
      amount1: getAmount1ForLiquidity(a, sqrtPriceX96, liquidity),
    }
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(a, b, liquidity) }
}

export function amountsFromLiquidityParams(
  pool: PoolContext,
  tickLower: number,
  tickUpper: number,
  liquidityAbs: bigint,
  sqrtPriceX96: bigint,
): { baseRaw: bigint; quoteRaw: bigint } {
  const { amount0, amount1 } = getAmountsForLiquidity(
    sqrtPriceX96,
    getSqrtRatioAtTick(tickLower),
    getSqrtRatioAtTick(tickUpper),
    liquidityAbs,
  )
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  return {
    baseRaw: baseIs0 ? amount0 : amount1,
    quoteRaw: baseIs0 ? amount1 : amount0,
  }
}

function sqrtPriceX96FromInitData(data: string): bigint | null {
  try {
    const price = decodeWord(data, 3)
    return price > 0n ? price : null
  } catch {
    return null
  }
}

function sqrtPriceX96FromSwapData(data: string): bigint | null {
  try {
    // Swap: amount0, amount1, sqrtPriceX96, liquidity, tick, fee
    const price = decodeWord(data, 2)
    return price > 0n ? price : null
  } catch {
    return null
  }
}

type ReceiptLog = { address?: string; topics?: string[]; data?: string; logIndex?: number | string }

function logIndexOf(log: ReceiptLog): number {
  if (typeof log.logIndex === "number" && Number.isFinite(log.logIndex)) return log.logIndex
  if (typeof log.logIndex === "string") {
    const n = log.logIndex.startsWith("0x") ? Number.parseInt(log.logIndex, 16) : Number(log.logIndex)
    return Number.isFinite(n) ? n : -1
  }
  return -1
}

/** Best sqrtPrice for a ModifyLiquidity: last Swap before it, else Initialize in the receipt. */
export function sqrtPriceX96BeforeModify(
  pool: PoolContext,
  modifyLogIndex: number,
  receiptLogs: ReceiptLog[],
): bigint | null {
  const poolId = (pool.topic1 || "").toLowerCase()
  let initPrice: bigint | null = null
  let lastSwapPrice: bigint | null = null
  let lastSwapIndex = -1

  for (const log of receiptLogs) {
    if (!Array.isArray(log.topics) || typeof log.data !== "string") continue
    const topic = (log.topics[0] || "").toLowerCase()
    const id = (log.topics[1] || "").toLowerCase()
    if (poolId && id !== poolId) continue
    const idx = logIndexOf(log)

    if (topic === INIT_V4_TOPIC) {
      initPrice = sqrtPriceX96FromInitData(log.data) ?? initPrice
      continue
    }
    if (topic === SWAP_V4_TOPIC) {
      if (modifyLogIndex >= 0 && idx >= 0 && idx >= modifyLogIndex) continue
      const price = sqrtPriceX96FromSwapData(log.data)
      if (price == null) continue
      if (idx >= lastSwapIndex) {
        lastSwapPrice = price
        lastSwapIndex = idx
      }
    }
  }

  return lastSwapPrice ?? initPrice
}

/**
 * DEXTools-style V4 ADD/REMOVE amounts from liquidity math (not raw receipt transfers).
 * Receipt transfers over-count when the same tx also swaps (e.g. shows 0.5 WETH on a one-sided ADD).
 */
export function amountsFromV4LiquidityMath(
  pool: PoolContext,
  modifyData: string,
  modifyLogIndex: number,
  receiptLogs: ReceiptLog[],
): { baseRaw: bigint; quoteRaw: bigint } | null {
  const parsed = parseV4ModifyLiquidity(modifyData)
  if (!parsed) return null
  const sqrtP = sqrtPriceX96BeforeModify(pool, modifyLogIndex, receiptLogs)
  if (sqrtP == null) return null
  const liquidityAbs = parsed.liquidityDelta < 0n ? -parsed.liquidityDelta : parsed.liquidityDelta
  return amountsFromLiquidityParams(pool, parsed.tickLower, parsed.tickUpper, liquidityAbs, sqrtP)
}
