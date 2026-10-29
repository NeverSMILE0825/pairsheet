import assert from "node:assert/strict"
import test from "node:test"
import {
  latestQuoteUsdPrice,
  quoteAbsDelta,
  quoteAmountToUsd,
  quoteUsdPriceFromTrade,
  tradeSizeFromUsd,
} from "./trade-size"

test("maps USD totals onto DEXTools-style size tiers", () => {
  assert.equal(tradeSizeFromUsd(0.01)?.tier, "flea")
  assert.equal(tradeSizeFromUsd(0.99)?.tier, "flea")
  assert.equal(tradeSizeFromUsd(0.01)?.color, "#bf8c00")
  assert.equal(tradeSizeFromUsd(1)?.tier, "shrimp")
  assert.equal(tradeSizeFromUsd(797)?.tier, "shrimp")
  assert.equal(tradeSizeFromUsd(797)?.color, "#fa8e42")
  assert.equal(tradeSizeFromUsd(1000)?.tier, "fish")
  assert.equal(tradeSizeFromUsd(9999)?.tier, "fish")
  assert.equal(tradeSizeFromUsd(10_000)?.tier, "dolphin")
  assert.equal(tradeSizeFromUsd(99_999)?.tier, "dolphin")
  assert.equal(tradeSizeFromUsd(100_000)?.tier, "whale")
  assert.equal(tradeSizeFromUsd(null), null)
  assert.equal(tradeSizeFromUsd("not-a-number"), null)
})

test("derives quote USD price and pool USD from trades", () => {
  assert.equal(quoteUsdPriceFromTrade("2500", "1"), 2500)
  assert.equal(quoteUsdPriceFromTrade(null, "1"), null)
  const price = latestQuoteUsdPrice([
    { totalUsd: "100", quoteAmount: "0.05", timestamp: "2026-01-01T00:00:00.000Z", logIndex: 1 },
    { totalUsd: "2500", quoteAmount: "1", timestamp: "2026-01-01T00:01:00.000Z", logIndex: 1 },
  ])
  assert.equal(price, 2500)
  assert.equal(quoteAmountToUsd("0.02", 2500), 50)
  assert.equal(quoteAmountToUsd(null, 2500), null)
  assert.equal(quoteAbsDelta("1.0", "2.5"), "1.5")
  assert.equal(quoteAbsDelta("5.1317", "2.1652"), String(Math.abs(2.1652 - 5.1317)))
  assert.equal(quoteAbsDelta(null, "1"), "1")
  assert.equal(quoteAbsDelta("1", null), null)
})
