import assert from "node:assert/strict"
import test from "node:test"
import { buildBehaviourReport, formatReportNumber, formatWindowParagraph } from "./behaviour-report"
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

test("buildBehaviourReport summarizes cumulative windows from tape start", () => {
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
  const full = report.windows.find((w) => w.id === "full")
  assert.ok(full)
  assert.equal(full.buys, 3)
  assert.equal(full.sells, 1)
  const paragraph = formatWindowParagraph(first15, "ETH")
  assert.match(paragraph, /2 buys and 1 sells/)
  assert.match(paragraph, /0\.75 ETH/)
  assert.ok(report.story.includes("buy rush"))
})
