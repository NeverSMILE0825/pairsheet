import assert from "node:assert/strict"
import test from "node:test"
import { INIT_V4_TOPIC, MODIFY_LIQUIDITY_V4_TOPIC, SWAP_V4_TOPIC, amountsFromV4Receipt } from "./decode"
import {
  amountsFromLiquidityParams,
  amountsFromV4LiquidityMath,
  getSqrtRatioAtTick,
  parseV4ModifyLiquidity,
} from "./v4-liquidity"
import type { PoolContext } from "./types"

const Q96 = 1n << 96n

const pool: PoolContext = {
  chainId: "ether",
  chainName: "Ethereum",
  address: "0xafc46cc375c436a89b572700b8111ceaad08ec79e900a9932ccd45d9c6364ec6",
  logAddress: "0x000000000004444c5dc75cb358380d2e3de08a90",
  topic1: "0xafc46cc375c436a89b572700b8111ceaad08ec79e900a9932ccd45d9c6364ec6",
  style: "v4",
  dex: "Uniswap V4 (Ethereum)",
  dexId: "uniswap-v4-ethereum",
  base: { address: "0x1111111111111111111111111111111111111111", symbol: "MINIMAL", decimals: 18 },
  quote: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18 },
  token0: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  token1: "0x1111111111111111111111111111111111111111",
  createdAt: null,
  priceUsd: null,
  reserveUsd: null,
  baseTotalSupply: null,
  dextoolsUrl: "",
  explorerTx: "",
  explorerAddress: "",
}

function encodeInt(value: bigint): string {
  const asUint = value < 0n ? (1n << 256n) + value : value
  return asUint.toString(16).padStart(64, "0")
}

test("getSqrtRatioAtTick(0) is Q96", () => {
  assert.equal(getSqrtRatioAtTick(0), Q96)
})

test("one-sided add above range has zero token0 (WETH) like DEXTools", () => {
  // Price above upper tick → only token1 (MINIMAL) is required.
  const tickLower = 0
  const tickUpper = 100
  const sqrtP = getSqrtRatioAtTick(200)
  const liquidity = 10n ** 18n
  const amounts = amountsFromLiquidityParams(pool, tickLower, tickUpper, liquidity, sqrtP)
  assert.equal(amounts.quoteRaw, 0n)
  assert.ok(amounts.baseRaw > 0n)
})

test("amountsFromV4LiquidityMath prefers liquidity math over bundled swap transfers", () => {
  const poolId = pool.topic1!
  const manager = pool.logAddress
  const weth = pool.quote.address
  const token = pool.base.address
  const tickLower = 0
  const tickUpper = 100
  const liquidity = 10n ** 18n
  const modifyData = `0x${encodeInt(BigInt(tickLower))}${encodeInt(BigInt(tickUpper))}${encodeInt(liquidity)}${"0".repeat(64)}`
  const parsed = parseV4ModifyLiquidity(modifyData)
  assert.ok(parsed)

  const sqrtPrice = getSqrtRatioAtTick(200)
  const initData = `0x${"0".repeat(64)}${encodeInt(60n)}${"0".repeat(64)}${encodeInt(sqrtPrice)}${encodeInt(200n)}`
  const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`
  const halfEth = 5n * 10n ** 17n
  const billion = 10n ** 27n

  const receiptLogs = [
    {
      logIndex: 0,
      topics: [INIT_V4_TOPIC, poolId, pad("0x0000000000000000000000000000000000000000"), pad("0x0000000000000000000000008fe342d1165465e7595e3fe61d08ce38341b0bd0")],
      data: initData,
    },
    {
      logIndex: 1,
      topics: [MODIFY_LIQUIDITY_V4_TOPIC, poolId, pad("0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e")],
      data: modifyData,
    },
    // Bundled WETH transfer that must NOT become the ADD quote amount.
    {
      address: weth,
      logIndex: 2,
      topics: [transfer, pad("0x5c4b3436d963c34b16acbc0e8274e84f8d522a46"), pad(manager)],
      data: `0x${halfEth.toString(16).padStart(64, "0")}`,
    },
    {
      address: token,
      logIndex: 3,
      topics: [transfer, pad("0x5c4b3436d963c34b16acbc0e8274e84f8d522a46"), pad(manager)],
      data: `0x${billion.toString(16).padStart(64, "0")}`,
    },
  ]

  const fromMath = amountsFromV4LiquidityMath(pool, modifyData, 1, receiptLogs)
  assert.ok(fromMath)
  assert.equal(fromMath.quoteRaw, 0n)
  assert.ok(fromMath.baseRaw > 0n)

  // Receipt-only path (without swap subtract) would still see the 0.5 WETH.
  const fromReceipt = amountsFromV4Receipt(pool, "ADD", receiptLogs)
  assert.equal(fromReceipt.quoteRaw, halfEth)
})

test("amountsFromV4Receipt subtracts same-tx swap quote inflow", () => {
  const poolId = pool.topic1!
  const manager = pool.logAddress
  const weth = pool.quote.address
  const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  const pad = (address: string) => `0x${"0".repeat(24)}${address.slice(2)}`
  const halfEth = 5n * 10n ** 17n
  // Swap: caller BalanceDelta — paid 0.5 WETH (amount0 negative), received base (amount1 positive)
  const swapData = `0x${encodeInt(-halfEth)}${encodeInt(10n ** 24n)}${encodeInt(Q96)}${encodeInt(0n)}${encodeInt(0n)}${encodeInt(0n)}`
  const receiptLogs = [
    {
      address: weth,
      topics: [transfer, pad("0x5c4b3436d963c34b16acbc0e8274e84f8d522a46"), pad(manager)],
      data: `0x${halfEth.toString(16).padStart(64, "0")}`,
    },
    {
      topics: [SWAP_V4_TOPIC, poolId, pad("0x5c4b3436d963c34b16acbc0e8274e84f8d522a46")],
      data: swapData,
    },
  ]
  const amounts = amountsFromV4Receipt(pool, "ADD", receiptLogs)
  assert.equal(amounts.quoteRaw, 0n)
})
