import assert from "node:assert/strict"
import test from "node:test"
import {
  decimalRatio,
  formatCompact,
  formatPanelUsd,
  formatQuoteAmount,
  mulDecimals,
} from "./format"
import { balanceShare, holdingValue, latestQuotePrice, summarizeMaker, summarizeMakers } from "./maker"
import type { Trade } from "./types"

function trade(partial: Partial<Trade> & Pick<Trade, "type" | "maker">): Trade {
  return {
    id: partial.txHash ?? partial.maker,
    txNo: 0,
    timestamp: "2024-01-01T00:00:00.000Z",
    blockNumber: 1,
    logIndex: 0,
    priceUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "0",
    quoteAmount: "0",
    baseReserve: null,
    holders: null,
    quoteReserve: null,
    router: "",
    makerTxCount: 0,
    makerTags: [],
    txHash: "0x1",
    fundedBy: null,
    fundedByAddress: null,
    ...partial,
  }
}

test("sums buys and sells and leaves liquidity out of the totals", () => {
  const summary = summarizeMaker([
    trade({
      type: "BUY",
      maker: "0xabc",
      baseAmount: "1000",
      quoteAmount: "2",
      totalUsd: "5000",
      txHash: "0xa",
    }),
    trade({
      type: "BUY",
      maker: "0xabc",
      baseAmount: "500",
      quoteAmount: "1.5",
      totalUsd: "4000",
      txHash: "0xb",
    }),
    trade({
      type: "SELL",
      maker: "0xabc",
      baseAmount: "200",
      quoteAmount: "1",
      totalUsd: "2500",
      txHash: "0xc",
    }),
    trade({
      type: "ADD",
      maker: "0xabc",
      baseAmount: "10",
      quoteAmount: "0.1",
      totalUsd: "100",
      txHash: "0xd",
    }),
  ])

  assert.equal(summary.buys, 2)
  assert.equal(summary.sells, 1)
  assert.equal(summary.adds, 1)
  assert.equal(summary.removes, 0)
  assert.equal(summary.boughtBase, "1500")
  assert.equal(summary.soldBase, "200")
  assert.equal(summary.balanceBase, "1300")
  assert.equal(summary.boughtQuote, "3.5")
  assert.equal(summary.soldQuote, "1")
  assert.equal(summary.pnlQuote, "-2.5")
  assert.equal(summary.boughtUsd, "9000")
  assert.equal(summary.soldUsd, "2500")
  assert.equal(summary.pnlUsd, "-6500")
})

test("groups makers without regard to address case", () => {
  const summaries = summarizeMakers([
    trade({ type: "BUY", maker: "0xAbC", baseAmount: "1", quoteAmount: "0.1", totalUsd: "10" }),
    trade({ type: "SELL", maker: "0xabc", baseAmount: "0.4", quoteAmount: "0.2", totalUsd: "30", txHash: "0x2" }),
  ])
  assert.equal(summaries.size, 1)
  const summary = summaries.get("0xabc")
  assert.ok(summary)
  assert.equal(summary.buys, 1)
  assert.equal(summary.sells, 1)
  assert.equal(summary.balanceBase, "0.6")
  assert.equal(summary.pnlQuote, "0.1")
  assert.equal(summary.pnlUsd, "20")
})

test("leaves PnL blank when a side has no USD price", () => {
  const summary = summarizeMaker([
    trade({ type: "BUY", maker: "0xabc", baseAmount: "1", quoteAmount: "1", totalUsd: null }),
    trade({ type: "SELL", maker: "0xabc", baseAmount: "1", quoteAmount: "2", totalUsd: "10", txHash: "0x2" }),
  ])
  assert.equal(summary.boughtUsd, null)
  assert.equal(summary.soldUsd, "10")
  assert.equal(summary.pnlUsd, null)
  assert.equal(summary.pnlQuote, "1")
})

test("values remaining tokens with the pool price and the latest quote price", () => {
  const rows = [
    trade({
      type: "BUY",
      maker: "0xabc",
      baseAmount: "100",
      quoteAmount: "1",
      totalUsd: "10",
      priceQuote: "0.01",
      timestamp: "2024-01-01T00:00:00.000Z",
      logIndex: 1,
    }),
    trade({
      type: "SELL",
      maker: "0xdef",
      baseAmount: "1",
      quoteAmount: "0.02",
      totalUsd: "1",
      priceQuote: "0.004",
      timestamp: "2024-06-01T00:00:00.000Z",
      logIndex: 4,
    }),
  ]
  const summary = summarizeMaker(rows.filter((row) => row.maker === "0xabc"))
  assert.equal(holdingValue(summary.balanceBase, "2"), "200")
  assert.equal(holdingValue(summary.balanceBase, latestQuotePrice(rows)), "0.4")
  assert.equal(holdingValue("0", "2"), null)
  assert.equal(holdingValue("-1", "2"), null)
  assert.equal(balanceShare(summary.balanceBase, summary.boughtBase), 1)
  assert.equal(decimalRatio("176.01", "1760000"), 0.0001)
})

test("formats the maker panel the way the hover card reads", () => {
  assert.equal(formatPanelUsd("151.77"), "$151.77")
  assert.equal(formatPanelUsd("-10.83"), "-$10.83")
  assert.equal(formatPanelUsd("0.0219"), "$0.0219")
  assert.equal(formatPanelUsd("2500000"), "$2.5M")
  assert.equal(formatPanelUsd(null), "—")
  assert.equal(formatCompact("1760000"), "1.76M")
  assert.equal(formatCompact("176.01"), "176.01")
  assert.equal(formatCompact("-2.5"), "-2.5")
  assert.equal(formatQuoteAmount("4.4589"), "4.4589")
  assert.equal(formatQuoteAmount("0.05421"), "0.05421")
  assert.equal(formatQuoteAmount("-2.5"), "-2.5")
  assert.equal(mulDecimals("1300", "0.004"), "5.2")
  assert.equal(mulDecimals("176.01", "0.0001244"), "0.021895644")
})
