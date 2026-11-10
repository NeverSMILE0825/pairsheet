import assert from "node:assert/strict"
import test from "node:test"
import { describeMcapMultiple, latestPoolMcapAnchor, marketCapAtPooledQuote, trimDecimal } from "./mcap-pool"

test("market cap scales with the square of pooled quote and matches the current pool", () => {
  assert.equal(marketCapAtPooledQuote("4.2", "200000", "4.2"), "200000")
  assert.equal(marketCapAtPooledQuote("4.2", "200000", "8.4"), "800000")
  assert.equal(marketCapAtPooledQuote("2", "800", "1"), "200")
  assert.equal(marketCapAtPooledQuote("0.5", "100.5", "0.5"), "100.5")
  assert.equal(marketCapAtPooledQuote("10", "1000", "1,000"), "10000000")
})

test("market cap at pooled quote rejects empty or zero amounts", () => {
  assert.equal(marketCapAtPooledQuote("4", "100", ""), null)
  assert.equal(marketCapAtPooledQuote("4", "100", "0"), null)
  assert.equal(marketCapAtPooledQuote("0", "100", "4"), null)
  assert.equal(marketCapAtPooledQuote("4", "100", "abc"), null)
})

test("latest pool anchor is the newest row with both a pool balance and a market cap", () => {
  const anchor = latestPoolMcapAnchor([
    { blockNumber: 1, logIndex: 0, quoteReserve: "1", marketCapUsd: "10" },
    { blockNumber: 2, logIndex: 1, quoteReserve: "0", marketCapUsd: "20" },
    { blockNumber: 2, logIndex: 0, quoteReserve: "3", marketCapUsd: "30" },
    { blockNumber: 2, logIndex: 2, quoteReserve: "4", marketCapUsd: null },
  ])
  assert.deepEqual(anchor, { quoteReserve: "3", marketCapUsd: "30" })
  assert.equal(latestPoolMcapAnchor([]), null)
})

test("describeMcapMultiple names the square move against the latest row", () => {
  assert.equal(describeMcapMultiple("200000", "800000"), "4× higher")
  assert.equal(describeMcapMultiple("200000", "200000"), "same as the latest row")
  assert.equal(describeMcapMultiple("800", "200"), "0.25× lower")
})

test("trimDecimal drops trailing zeros without changing the value", () => {
  assert.equal(trimDecimal("12.3400"), "12.34")
  assert.equal(trimDecimal("5"), "5")
  assert.equal(trimDecimal("0.046429240000"), "0.04642924")
})
