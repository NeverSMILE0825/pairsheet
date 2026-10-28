import assert from "node:assert/strict"
import test from "node:test"
import { csvFilename, tradesToCsv } from "./csv"
import {
  BURN_V3_TOPIC,
  MINT_V2_TOPIC,
  SWAP_V2_TOPIC,
  SWAP_V4_TOPIC,
  decodeAbiString,
  decodeSwap,
  decodeV2,
  decodeV3,
  liquidityTopics,
  topicOrder,
} from "./decode"
import {
  formatIntegerAmount,
  formatPoolSize,
  formatTiny,
  priceInQuote,
  priceUsdFromTotal,
  sumDecimals,
  totalUsd,
} from "./format"
import { earliestIncoming, funderLabel, type FundingRow } from "./funded"
import {
  clampParts,
  formatParts,
  formatTradeDate,
  formatZoned,
  resolveZone,
  zoneAbbreviation,
  zoneOptions,
  zonedPartsEndMs,
  zonedPartsToUtc,
} from "./timezone"
import { annotateTrades, assignTxNumbers, routersToCheck } from "./annotate"
import { decodeSolanaSwap } from "./solana"
import { assignSync, recordSync, swapKey, type SyncEvent } from "./reserves"
import { EXAMPLE_URL, parseDextoolsUrl } from "./parse-url"
import type { PoolContext, PoolView, RawLog, Trade } from "./types"

const pool: PoolContext = {
  chainId: "ether",
  chainName: "Ethereum",
  address: "0x961bde5165b921561e6e97fee8c2dfbdaf49c737",
  logAddress: "0x961bde5165b921561e6e97fee8c2dfbdaf49c737",
  topic1: null,
  style: "pair",
  dex: "Uniswap V2",
  dexId: "uniswap_v2",
  base: {
    address: "0x8fe342d1165465e7595e3fe61d08ce38341b0bd0",
    symbol: "FWOG",
    decimals: 18,
  },
  quote: {
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    symbol: "WETH",
    decimals: 18,
  },
  token0: "0x8fe342d1165465e7595e3fe61d08ce38341b0bd0",
  token1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  createdAt: null,
  priceUsd: null,
  reserveUsd: null,
  dextoolsUrl: EXAMPLE_URL,
  explorerTx: "https://etherscan.io/tx",
  explorerAddress: "https://etherscan.io/address",
}

const SELL_DATA =
  "0x00000000000000000000000000000000000004ee2d6d415b85acef8100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003de146ad4a46f138"

test("parses DEXTools pair explorer links", () => {
  const parsed = parseDextoolsUrl(EXAMPLE_URL)
  assert.equal(parsed.chain.id, "ether")
  assert.equal(parsed.address, "0x961bde5165b921561e6e97fee8c2dfbdaf49c737")

  const localized = parseDextoolsUrl(
    "https://www.dextools.io/app/en/base/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737?t=1",
  )
  assert.equal(localized.chain.id, "base")

  const bare = parseDextoolsUrl(
    "dextools.io/app/arbitrum/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737/",
  )
  assert.equal(bare.chain.id, "arbitrum")

  const v4 = parseDextoolsUrl(
    "https://www.dextools.io/app/ether/pair-explorer/0x80bcdfbd84b4e2525f71b36b82440f0d435ecebabefb1d286b6fe16a87c67f96",
  )
  assert.equal(v4.chain.id, "ether")
  assert.equal(v4.address, "0x80bcdfbd84b4e2525f71b36b82440f0d435ecebabefb1d286b6fe16a87c67f96")

  const sol = parseDextoolsUrl(
    "https://www.dextools.io/app/solana/pair-explorer/3xbJcFoEpBwnp1eGHpAKkKNmN5kk381F6KETjtEyxpX3",
  )
  assert.equal(sol.chain.id, "solana")
  assert.equal(sol.address, "3xbJcFoEpBwnp1eGHpAKkKNmN5kk381F6KETjtEyxpX3")
})

test("rejects links that are not a pair explorer", () => {
  assert.throws(() => parseDextoolsUrl("https://www.dextools.io/app/ether/hot-pairs"))
  assert.throws(() => parseDextoolsUrl("https://example.com/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737"))
})

test("decodes the FWOG sell from the screenshot", () => {
  const swap = decodeV2(SELL_DATA, pool)
  assert.ok(swap)
  assert.equal(swap.type, "SELL")
  assert.equal(swap.baseRaw, 10n ** 32n)
  assert.equal(swap.quoteRaw, 4458922816162951480n)

  const quote = priceInQuote(swap.quoteRaw, 18, swap.baseRaw, 18)
  assert.equal(quote.startsWith("0.000000000000044589"), true)

  const usd = totalUsd(swap.quoteRaw, 18, 2833.24)
  assert.ok(usd)
  assert.equal(usd.startsWith("12633."), true)
  const unit = priceUsdFromTotal(usd, "100000000000000")
  assert.ok(unit)
  assert.equal(unit.startsWith("0.000000000126"), true)
  assert.equal(SWAP_V2_TOPIC.startsWith("0xd78ad95f"), true)
})

test("decodes a v3 buy of token0", () => {
  const data = `0x${encodeInt(-2_000000000000000000n)}${encodeInt(1_500000000000000000n)}${"0".repeat(64 * 3)}`
  const swap = decodeV3(data, pool)
  assert.ok(swap)
  assert.equal(swap.type, "BUY")
  assert.equal(swap.baseRaw, 2_000000000000000000n)
  assert.equal(swap.quoteRaw, 1_500000000000000000n)
})

test("decodes a solana pool swap from token balance deltas", () => {
  const solPool: PoolContext = {
    ...pool,
    chainId: "solana",
    chainName: "Solana",
    address: "3xbJcFoEpBwnp1eGHpAKkKNmN5kk381F6KETjtEyxpX3",
    logAddress: "3xbJcFoEpBwnp1eGHpAKkKNmN5kk381F6KETjtEyxpX3",
    dex: "PumpSwap",
    dexId: "pumpswap",
    base: { address: "4Kgx3bNBfdA8DgPGSfAd1tTSEc9x6Qd3bTeTtoyQpump", symbol: "OpenBot", decimals: 6 },
    quote: { address: "So11111111111111111111111111111111111111112", symbol: "SOL", decimals: 9 },
    token0: "4Kgx3bNBfdA8DgPGSfAd1tTSEc9x6Qd3bTeTtoyQpump",
    token1: "So11111111111111111111111111111111111111112",
    explorerTx: "https://solscan.io/tx",
    explorerAddress: "https://solscan.io/account",
  }
  const trade = decodeSolanaSwap(solPool, "sig123", {
    slot: 10,
    blockTime: 1_700_000_000,
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 4,
          mint: solPool.base.address,
          owner: solPool.address,
          uiTokenAmount: { amount: "1000000000", decimals: 6 },
        },
        {
          accountIndex: 5,
          mint: solPool.quote.address,
          owner: solPool.address,
          uiTokenAmount: { amount: "2000000000", decimals: 9 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 4,
          mint: solPool.base.address,
          owner: solPool.address,
          uiTokenAmount: { amount: "900000000", decimals: 6 },
        },
        {
          accountIndex: 5,
          mint: solPool.quote.address,
          owner: solPool.address,
          uiTokenAmount: { amount: "2100000000", decimals: 9 },
        },
      ],
    },
    transaction: { message: { accountKeys: ["Maker1111111111111111111111111111111111111"] } },
  })
  assert.ok(trade)
  assert.equal(trade.type, "BUY")
  assert.equal(trade.baseAmount, "100")
  assert.equal(trade.quoteAmount, "0.1")
  assert.equal(trade.maker, "Maker1111111111111111111111111111111111111")
})

test("decodes a uniswap v4 swap with the same amount layout as v3", () => {
  const poolId = "0x80bcdfbd84b4e2525f71b36b82440f0d435ecebabefb1d286b6fe16a87c67f96"
  const v4Pool: PoolContext = {
    ...pool,
    address: poolId,
    logAddress: "0x000000000004444c5dc75cb358380d2e3de08a90",
    topic1: poolId,
    style: "v4",
    dex: "Uniswap V4 (Ethereum)",
    dexId: "uniswap-v4-ethereum",
  }
  assert.deepEqual(topicOrder(v4Pool.dexId, v4Pool.dex, v4Pool.style), [SWAP_V4_TOPIC])
  assert.deepEqual(liquidityTopics(SWAP_V4_TOPIC), [])
  const data = `0x${encodeInt(-2_000000000000000000n)}${encodeInt(1_500000000000000000n)}${"0".repeat(64 * 4)}`
  const log = {
    data,
    topics: [SWAP_V4_TOPIC, poolId, "0x00000000000000000000000066a9893cc07d91d95644aedd05d03f95e1dba8af"],
    blockNumber: 1,
    timestamp: 1,
    txHash: "0xabc",
    logIndex: 1,
  }
  const swap = decodeSwap(log, v4Pool)
  assert.ok(swap)
  assert.equal(swap.type, "BUY")
  assert.equal(swap.baseRaw, 2_000000000000000000n)
  assert.equal(swap.quoteRaw, 1_500000000000000000n)
})

test("decodes a token symbol from ABI data", () => {
  const hex =
    "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000446574f4700000000000000000000000000000000000000000000000000000000"
  assert.equal(decodeAbiString(hex), "FWOG")
})

test("shows the base token column as a whole number", () => {
  assert.equal(formatIntegerAmount("16829.0324"), "16,829")
  assert.equal(formatIntegerAmount("16829.5"), "16,830")
  assert.equal(formatIntegerAmount("100000000000000"), "100,000,000,000,000")
  assert.equal(formatIntegerAmount("0.4"), "0")
  assert.equal(formatIntegerAmount("-1.6"), "-2")
})

test("formats tiny prices with subscript zeros", () => {
  assert.equal(formatTiny(0.0000000001263), "0.0₉1263")
  assert.equal(formatTradeDate("2024-08-04T15:54:23.000Z"), "Aug 4 24 15:54:23")
})

test("writes an excel-friendly csv", () => {
  const view: PoolView = {
    chainId: "ether",
    chainName: "Ethereum",
    address: pool.address,
    dex: "Uniswap V2",
    baseSymbol: "FWOG",
    quoteSymbol: "WETH",
    baseAddress: pool.base.address,
    quoteAddress: pool.quote.address,
    createdAt: null,
    priceUsd: null,
    reserveUsd: null,
    dextoolsUrl: EXAMPLE_URL,
    explorerTx: pool.explorerTx,
    explorerAddress: pool.explorerAddress,
  }
  const trade: Trade = {
    id: "tx-1",
    txNo: 17,
    timestamp: "2024-08-04T15:54:23.000Z",
    blockNumber: 20456217,
    logIndex: 206,
    type: "SELL",
    priceUsd: "0.00000000012633",
    totalUsd: "12633.15",
    priceQuote: "0.000000000000044589",
    baseAmount: "100000000000000",
    quoteAmount: "4.45892281616295148",
    baseReserve: "1234.5",
    quoteReserve: "0.0000099",
    maker: "0x591f85c11cafea17f7cc926f13e2ed7c794f2522",
    router: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
    makerTxCount: 40,
    makerTags: ["bot", "team"],
    txHash: "0xabc,def",
    fundedBy: "Disperse.app",
    fundedByAddress: "0xd152f549545093347a162dce210e7293f1452150",
  }
  const csv = tradesToCsv(view, [trade], "Asia/Seoul")
  assert.equal(csv.startsWith("\uFEFF"), true)
  assert.match(csv, /tx_no,date_utc,date_local,timezone,type,price_usd,total_usd/)
  assert.match(csv, /17,2024-08-04T15:54:23\.000Z,2024-08-05 00:54:23,Asia\/Seoul,SELL/)
  assert.match(csv, /quote_amount,pool_base_after,pool_quote_after,maker/)
  assert.match(csv, /4\.45892281616295148,1234\.5,0\.0000099,0x591f/)
  assert.match(csv, /,40,bot;team,0x7a250d56/)
  assert.match(csv, /"0xabc,def"/)
  assert.match(csv, /Disperse\.app,0xd152f549545093347a162dce210e7293f1452150/)
  assert.equal(csvFilename(view), "fwog-weth-ether-swaps.csv")
})

test("picks the earliest incoming funding and the public label", () => {
  const maker = "0x591f85c11cafea17f7cc926f13e2ed7c794f2522"
  const rows: FundingRow[] = [
    {
      from: "0x130522d07a21ca506a0ac76bca5f9f20f6bb9101",
      to: maker,
      value: "4458922816162951480",
      blockNumber: 20456217,
      timestamp: 1722786863,
    },
    {
      from: "0xd152f549545093347a162dce210e7293f1452150",
      to: maker,
      value: "100000000000000000",
      blockNumber: 20451599,
      timestamp: 1722731279,
    },
    {
      from: maker,
      to: "0x130522d07a21ca506a0ac76bca5f9f20f6bb9101",
      value: "0",
      blockNumber: 20451627,
      timestamp: 1722731615,
    },
  ]
  const first = earliestIncoming(maker, rows)
  assert.ok(first)
  assert.equal(first.from, "0xd152f549545093347a162dce210e7293f1452150")
  assert.equal(funderLabel(first.from, { name: "Disperse" }), "Disperse.app")
  assert.equal(funderLabel("0xabc1230000000000000000000000000000000001", { name: "Router" }), "Router")
})

function encodeInt(value: bigint): string {
  const mod = (1n << 256n) + (value < 0n ? value : 0n)
  const encoded = value < 0n ? mod : value
  return encoded.toString(16).padStart(64, "0")
}

test("sums WETH amounts exactly", () => {
  assert.equal(sumDecimals(["0.1", "0.2"]), "0.3")
  assert.equal(sumDecimals(["4.45892281616295148", "0.3", "1"]), "5.75892281616295148")
  assert.equal(sumDecimals(["10", "-2.5"]), "7.5")
  assert.equal(sumDecimals([]), "0")
})

test("reads the pool size from the Sync event right before each swap", () => {
  const word = (value: bigint) => value.toString(16).padStart(64, "0")
  const hash = "0xAA11"
  const byTx = new Map<string, SyncEvent[]>()
  recordSync(byTx, hash, 205, `0x${word(5n * 10n ** 18n)}${word(2n * 10n ** 18n)}`)
  recordSync(byTx, hash, 210, `0x${word(7n * 10n ** 18n)}${word(1n * 10n ** 17n)}`)
  const swap = (logIndex: number): RawLog => ({
    data: "0x",
    topics: [SWAP_V2_TOPIC],
    blockNumber: 1,
    timestamp: 1,
    txHash: hash,
    logIndex,
  })
  const sizes = new Map()
  const flipped = { ...pool, token0: pool.quote.address, token1: pool.base.address }
  assignSync(flipped, [swap(206), swap(211)], byTx, sizes)
  assert.deepEqual(sizes.get(swapKey(swap(206))), { base: "2", quote: "5" })
  assert.deepEqual(sizes.get(swapKey(swap(211))), { base: "0.1", quote: "7" })
  const direct = new Map()
  assignSync({ ...pool, token0: pool.base.address, token1: pool.quote.address }, [swap(206)], byTx, direct)
  assert.deepEqual(direct.get(swapKey(swap(206))), { base: "5", quote: "2" })
})

test("keeps significant digits for tiny pool sizes", () => {
  assert.equal(formatPoolSize("0.000009890697146748"), "0.00000989")
  assert.equal(formatPoolSize("4.458932706860098228"), "4.4589")
  assert.equal(formatPoolSize("0"), "0")
})

test("decodes liquidity adds and removes", () => {
  const word = (value: bigint) => value.toString(16).padStart(64, "0")
  const log = (topic: string, words: bigint[]): RawLog => ({
    data: `0x${words.map(word).join("")}`,
    topics: [topic],
    blockNumber: 1,
    timestamp: 1,
    txHash: "0x1",
    logIndex: 1,
  })
  const flipped = { ...pool, token0: pool.quote.address, token1: pool.base.address }
  const add = decodeSwap(log(MINT_V2_TOPIC, [3n * 10n ** 18n, 5n * 10n ** 18n]), flipped)
  assert.deepEqual(add, { type: "ADD", baseRaw: 5n * 10n ** 18n, quoteRaw: 3n * 10n ** 18n })
  const burn = decodeSwap(log(BURN_V3_TOPIC, [999n, 0n, 7n]), { ...pool, token0: pool.base.address, token1: pool.quote.address })
  assert.deepEqual(burn, { type: "REMOVE", baseRaw: 0n, quoteRaw: 7n })
  assert.equal(decodeSwap(log(BURN_V3_TOPIC, [999n, 0n, 0n]), pool), null)
  assert.equal(liquidityTopics(SWAP_V2_TOPIC).length, 2)
})

test("counts wallet transactions and tags bots and team wallets", () => {
  const base = {
    timestamp: "2024-08-04T15:54:23.000Z",
    priceUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "1",
    quoteAmount: "1",
    baseReserve: null,
    quoteReserve: null,
    fundedBy: null,
    fundedByAddress: null,
    txHash: "0x1",
  }
  const lp = "0x1111111111111111111111111111111111111111"
  const dev = "0x2222222222222222222222222222222222222222"
  const user = "0x3333333333333333333333333333333333333333"
  const router = "0x4444444444444444444444444444444444444444"
  const botContract = "0x5555555555555555555555555555555555555555"
  const make = (id: string, type: Trade["type"], maker: string, to: string, block: number): Trade => ({
    ...base,
    id,
    txNo: 0,
    type,
    maker,
    router: to,
    makerTxCount: 0,
    makerTags: [],
    blockNumber: block,
    logIndex: 1,
  })
  const trades = [
    make("a", "ADD", lp, router, 10),
    make("b", "BUY", user, router, 11),
    make("c", "SELL", user, botContract, 12),
    make("d", "BUY", dev, router, 13),
  ]
  const facts = {
    contracts: { [router]: { contract: true, verified: true }, [botContract]: { contract: true, verified: false } },
    deployer: dev,
  }
  const out = annotateTrades(trades, pool.address, facts)
  assert.deepEqual(out.map((trade) => trade.makerTxCount), [1, 2, 2, 1])
  assert.deepEqual(out.map((trade) => trade.makerTags), [["team"], [], ["bot"], ["team"]])
  assert.deepEqual(out.map((trade) => trade.txNo), [1, 2, 3, 4])
  assert.deepEqual(routersToCheck(trades, pool.address, 1), [router])
})

test("numbers transactions oldest-first and keeps them when reordered", () => {
  const base = {
    timestamp: "2024-08-04T15:54:23.000Z",
    type: "BUY" as const,
    priceUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "1",
    quoteAmount: "1",
    baseReserve: null,
    quoteReserve: null,
    maker: "0x3333333333333333333333333333333333333333",
    router: "0x4444444444444444444444444444444444444444",
    makerTxCount: 0,
    makerTags: [] as Trade["makerTags"],
    fundedBy: null,
    fundedByAddress: null,
    txHash: "0x1",
  }
  const newestFirst = [
    { ...base, id: "new", txNo: 0, blockNumber: 30, logIndex: 2 },
    { ...base, id: "mid", txNo: 0, blockNumber: 20, logIndex: 5 },
    { ...base, id: "old", txNo: 0, blockNumber: 10, logIndex: 9 },
  ]
  const numbered = assignTxNumbers(newestFirst)
  assert.deepEqual(
    numbered.map((trade) => [trade.id, trade.txNo]),
    [
      ["new", 3],
      ["mid", 2],
      ["old", 1],
    ],
  )
  const byPrice = [numbered[1], numbered[0], numbered[2]]
  assert.deepEqual(
    byPrice.map((trade) => trade.txNo),
    [2, 3, 1],
  )
})

test("shows times in the chosen time zone", () => {
  const iso = "2024-08-04T15:54:23.000Z"
  assert.equal(formatTradeDate(iso), "Aug 4 24 15:54:23")
  assert.equal(formatTradeDate(iso, "Asia/Seoul"), "Aug 5 24 00:54:23")
  assert.equal(formatTradeDate(iso, "America/Los_Angeles"), "Aug 4 24 08:54:23")
  assert.equal(formatZoned(iso, "Asia/Kolkata"), "2024-08-04 21:24:23")
  assert.equal(zoneAbbreviation("UTC"), "UTC")
  assert.equal(resolveZone("Not/AZone"), "UTC")
  const options = zoneOptions()
  assert.equal(options.some((option) => option.value === "Asia/Seoul"), true)
  assert.match(options.find((option) => option.value === "Asia/Seoul")?.label ?? "", /^\(UTC\+09:00\) Asia\/Seoul$/)
})

test("converts wall-clock parts in a zone to UTC and back", () => {
  const seoul = { year: 2024, month: 8, day: 5, hour: 0, minute: 54, second: 23 }
  const utc = zonedPartsToUtc(seoul, "Asia/Seoul")
  assert.equal(utc.toISOString(), "2024-08-04T15:54:23.000Z")
  assert.equal(formatParts(seoul), "Aug 5 24 00:54:23")
  assert.equal(zonedPartsEndMs(seoul, "Asia/Seoul") - utc.getTime(), 999)
  const feb = clampParts({ year: 2023, month: 2, day: 31, hour: 0, minute: 0, second: 0 })
  assert.equal(feb.day, 28)
})
