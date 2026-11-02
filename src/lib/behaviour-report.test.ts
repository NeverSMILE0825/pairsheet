import assert from "node:assert/strict"
import test from "node:test"
import {
  buildBehaviourReport,
  findPauses,
  formatBehaviourReportText,
  formatDuration,
  formatReportNumber,
  formatReportTime,
  formatWindowParagraph,
} from "./behaviour-report"
import type { PoolView, Trade } from "./types"

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "type" | "timestamp">): Trade {
  return {
    txNo: 0,
    blockNumber: 1,
    logIndex: 0,
    priceUsd: null,
    marketCapUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "0",
    quoteAmount: "0",
    baseReserve: null,
    quoteReserve: null,
    holders: null,
    maker: "0xabc",
    router: "",
    makerTxCount: 0,
    makerTags: [],
    txHash: "0x1",
    fundedBy: null,
    fundedByAddress: null,
    gasPriceGwei: null,
    gasFeeWei: null,
    gasFeeTotalEth: null,
    ...partial,
  }
}

const pool: PoolView = {
  chainId: "ether",
  chainName: "Ethereum",
  address: "0x80",
  dex: "Uniswap V4 (Ethereum)",
  baseSymbol: "GINNAN",
  quoteSymbol: "ETH",
  baseAddress: "0xbase",
  quoteAddress: "0x0",
  createdAt: null,
  priceUsd: null,
  reserveUsd: null,
  baseTotalSupply: null,
  dextoolsUrl: "",
  explorerTx: "",
  explorerAddress: "",
}

test("formatReportNumber keeps at most 2 decimals", () => {
  assert.equal(formatReportNumber(111.2967), "111.3")
  assert.equal(formatReportNumber(9.92), "9.92")
  assert.equal(formatReportNumber(null), "n/a")
})

test("formatDuration covers seconds minutes and hours", () => {
  assert.equal(formatDuration(45), "45s")
  assert.equal(formatDuration(90), "1m 30s")
  assert.equal(formatDuration(3600), "1h")
  assert.equal(formatDuration(3660), "1h 1m")
})

test("findPauses reports when and how long quiet stretches lasted", () => {
  const swaps: Trade[] = [
    trade({ id: "b1", type: "BUY", timestamp: "2026-10-26T16:20:59.000Z" }),
    trade({ id: "b2", type: "BUY", timestamp: "2026-10-26T16:21:11.000Z" }),
    trade({ id: "s1", type: "SELL", timestamp: "2026-10-26T18:21:11.000Z" }),
  ]
  const t0 = Date.parse(swaps[0].timestamp)
  const pauses = findPauses(swaps, t0, 5 * 60)
  assert.equal(pauses.length, 1)
  assert.equal(pauses[0].durationSec, 2 * 60 * 60)
  assert.equal(pauses[0].afterType, "BUY")
  assert.equal(pauses[0].beforeType, "SELL")
})

test("buildBehaviourReport summarizes windows, pauses, and speed rings", () => {
  const t0 = "2026-10-26T16:20:59.000Z"
  const trades: Trade[] = [
    trade({
      id: "b1",
      type: "BUY",
      timestamp: t0,
      quoteAmount: "0.5",
      totalUsd: "1000",
      logIndex: 1,
    }),
    trade({
      id: "b2",
      type: "BUY",
      timestamp: "2026-10-26T16:21:11.000Z",
      quoteAmount: "0.25",
      totalUsd: "500",
      logIndex: 2,
    }),
    trade({
      id: "s1",
      type: "SELL",
      timestamp: "2026-10-26T16:35:59.000Z",
      quoteAmount: "0.4",
      totalUsd: "800",
      logIndex: 3,
    }),
    trade({
      id: "b3",
      type: "BUY",
      timestamp: "2026-10-26T18:20:59.000Z",
      quoteAmount: "1",
      totalUsd: "2000",
      blockNumber: 2,
      logIndex: 1,
    }),
    trade({
      id: "s2",
      type: "SELL",
      timestamp: "2026-10-27T06:20:59.000Z",
      quoteAmount: "0.2",
      totalUsd: "400",
      blockNumber: 3,
      logIndex: 1,
    }),
  ]
  const report = buildBehaviourReport(trades, pool)
  assert.ok(report)
  assert.equal(report.baseSymbol, "GINNAN")
  assert.equal(report.quoteSymbol, "ETH")
  const first15 = report.windows.find((w) => w.id === "15m")
  assert.ok(first15)
  assert.equal(first15.buys, 2)
  assert.equal(first15.sells, 1)
  assert.equal(first15.buyEthSum, 0.75)
  assert.ok(first15.buyPerHour != null && first15.buyPerHour > 0)
  const full = report.windows.find((w) => w.id === "full")
  assert.ok(full)
  assert.equal(full.buys, 3)
  assert.equal(full.sells, 2)
  assert.ok(report.pauses.length >= 1)
  assert.ok(report.pauses[0].durationSec >= 5 * 60)
  assert.ok(report.speedSegments.length >= 2)
  assert.match(report.paceStory, /buys\/h/)
  assert.match(report.pausesStory, /Paused|pause|quiet/i)
  const paragraph = formatWindowParagraph(first15, "ETH")
  assert.match(paragraph, /2 buys and 1 sells/)
  assert.match(paragraph, /0\.75 ETH/)
  assert.match(paragraph, /buys\/h/)
  assert.ok(report.story.length > 0)
  assert.match(formatReportTime("2026-10-29T19:45:11.000Z"), /2026-10-29 15:45:11 ED[TS]/)
  assert.match(report.pausesStory, /ED[TS]/)
  const text = formatBehaviourReportText(report, pool)
  assert.match(text, /Buy & sell behaviour report/)
  assert.match(text, /Pauses — when and how long/)
  assert.match(text, /ED[TS]/)
})
