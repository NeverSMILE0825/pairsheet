import assert from "node:assert/strict"
import test from "node:test"
import {
  averageSpeedSec,
  buildIntervalTape,
  buildMinuteTape,
  estimateBucketCount,
  floorToIntervalMs,
  floorToMinuteMs,
  formatBucketLabel,
  formatIntervalMs,
  formatMinuteLabel,
  formatSpeed,
  intervalToMs,
} from "./minute-tape"
import type { Trade } from "./types"

function trade(partial: Partial<Trade> & Pick<Trade, "type" | "timestamp">): Trade {
  return {
    id: partial.id ?? partial.timestamp,
    txNo: 0,
    blockNumber: 1,
    logIndex: 0,
    priceUsd: null,
    marketCapUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "1",
    quoteAmount: "1",
    baseReserve: null,
    quoteReserve: null,
    holders: null,
    maker: "0x1",
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

test("floors timestamps to the start of the minute", () => {
  assert.equal(floorToMinuteMs("2026-10-26T16:20:59.000Z"), Date.parse("2026-10-26T16:20:00.000Z"))
  assert.equal(floorToMinuteMs("2026-10-26T16:21:00.000Z"), Date.parse("2026-10-26T16:21:00.000Z"))
  assert.equal(floorToIntervalMs("2026-10-26T16:20:17.000Z", 12_000), Date.parse("2026-10-26T16:20:12.000Z"))
})

test("average speed is interval seconds divided by the count", () => {
  assert.equal(averageSpeedSec(0), null)
  assert.equal(averageSpeedSec(1), 60)
  assert.equal(averageSpeedSec(7), 60 / 7)
  assert.equal(averageSpeedSec(9), 60 / 9)
  assert.equal(averageSpeedSec(2, 12_000), 6)
  assert.equal(formatSpeed(null), "—")
  assert.equal(formatSpeed(8.571428, 7), "8.57 (7 count)")
  assert.equal(formatSpeed(6.666666, 9), "6.67 (9 count)")
})

test("converts custom interval units to milliseconds", () => {
  assert.equal(intervalToMs(12, "sec"), 12_000)
  assert.equal(intervalToMs(5, "min"), 300_000)
  assert.equal(intervalToMs(1, "hour"), 3_600_000)
  assert.equal(intervalToMs(1, "d"), 86_400_000)
  assert.equal(intervalToMs(0, "sec"), null)
  assert.equal(formatIntervalMs(60_000), "1min")
})

test("builds inclusive empty minutes from launch through the last trade", () => {
  const rows = buildMinuteTape(
    [
      trade({ type: "INIT", timestamp: "2026-10-26T16:20:59.000Z", id: "i" }),
      trade({ type: "BUY", timestamp: "2026-10-26T16:25:35.000Z", id: "b1" }),
      trade({ type: "BUY", timestamp: "2026-10-26T16:26:01.000Z", id: "b2" }),
      trade({ type: "BUY", timestamp: "2026-10-26T16:26:04.000Z", id: "b3" }),
      trade({ type: "SELL", timestamp: "2026-10-26T16:29:40.000Z", id: "s1" }),
      trade({ type: "SELL", timestamp: "2026-10-26T16:29:50.000Z", id: "s2" }),
    ],
    "UTC",
  )
  assert.equal(rows.length, 10) // 16:20 .. 16:29 inclusive
  assert.equal(rows[0].buyCount, 0)
  assert.equal(rows[0].sellCount, 0)
  assert.equal(formatMinuteLabel(rows[0].start), "Oct 26 26 16:20")
  assert.equal(formatMinuteLabel(rows[0].end), "Oct 26 26 16:21")
  assert.equal(rows[5].buyCount, 1) // 16:25
  assert.equal(rows[5].avgBuySpeedSec, 60)
  assert.equal(rows[6].buyCount, 2) // 16:26
  assert.equal(rows[6].avgBuySpeedSec, 30)
  assert.equal(rows[9].sellCount, 2)
  assert.equal(rows[9].avgSellSpeedSec, 30)
  assert.equal(formatSpeed(rows[0].avgBuySpeedSec, rows[0].buyCount), "—")
  assert.equal(formatSpeed(rows[6].avgBuySpeedSec, rows[6].buyCount), "30.00 (2 count)")
})

test("builds 12-second buckets when requested", () => {
  const rows = buildIntervalTape(
    [
      trade({ type: "BUY", timestamp: "2026-10-26T16:20:01.000Z", id: "b1" }),
      trade({ type: "BUY", timestamp: "2026-10-26T16:20:05.000Z", id: "b2" }),
      trade({ type: "SELL", timestamp: "2026-10-26T16:20:25.000Z", id: "s1" }),
    ],
    "UTC",
    12_000,
  )
  assert.equal(rows.length, 3) // 16:20:00, :12, :24
  assert.equal(rows[0].buyCount, 2)
  assert.equal(rows[0].avgBuySpeedSec, 6)
  assert.equal(formatBucketLabel(rows[0].start, 12_000), "Oct 26 26 16:20:00")
  assert.equal(estimateBucketCount(
    [
      trade({ type: "BUY", timestamp: "2026-10-26T16:20:01.000Z", id: "b1" }),
      trade({ type: "SELL", timestamp: "2026-10-26T16:20:25.000Z", id: "s1" }),
    ],
    12_000,
  ), 3)
})

test("carries start/end pool quote, mcap, and price across minutes", () => {
  const rows = buildMinuteTape(
    [
      trade({
        type: "ADD",
        timestamp: "2026-10-26T16:20:10.000Z",
        id: "add",
        blockNumber: 1,
        logIndex: 1,
        quoteReserve: "1.5",
      }),
      trade({
        type: "BUY",
        timestamp: "2026-10-26T16:20:40.000Z",
        id: "b1",
        blockNumber: 2,
        logIndex: 1,
        quoteReserve: "2.0",
        priceUsd: "0.000002",
        marketCapUsd: "2000",
      }),
      trade({
        type: "SELL",
        timestamp: "2026-10-26T16:22:10.000Z",
        id: "s1",
        blockNumber: 3,
        logIndex: 1,
        quoteReserve: "1.8",
        priceUsd: "0.0000018",
        marketCapUsd: "1800",
      }),
    ],
    "UTC",
  )
  assert.equal(rows.length, 3)
  assert.equal(rows[0].startQuoteReserve, null)
  assert.equal(rows[0].endQuoteReserve, "2.0")
  assert.equal(rows[0].startPriceUsd, null)
  assert.equal(rows[0].endPriceUsd, "0.000002")
  assert.equal(rows[0].endMarketCapUsd, "2000")
  assert.equal(rows[1].startQuoteReserve, "2.0")
  assert.equal(rows[1].endQuoteReserve, "2.0")
  assert.equal(rows[1].startPriceUsd, "0.000002")
  assert.equal(rows[1].endPriceUsd, "0.000002")
  assert.equal(rows[2].startQuoteReserve, "2.0")
  assert.equal(rows[2].endQuoteReserve, "1.8")
  assert.equal(rows[2].endPriceUsd, "0.0000018")
  assert.equal(rows[2].endMarketCapUsd, "1800")
})

test("carries start/end holder counts across minutes", () => {
  const rows = buildMinuteTape(
    [
      trade({
        type: "BUY",
        timestamp: "2026-10-26T16:20:10.000Z",
        id: "b1",
        blockNumber: 1,
        holders: 12,
      }),
      trade({
        type: "BUY",
        timestamp: "2026-10-26T16:20:40.000Z",
        id: "b2",
        blockNumber: 2,
        holders: 15,
      }),
      trade({
        type: "SELL",
        timestamp: "2026-10-26T16:22:10.000Z",
        id: "s1",
        blockNumber: 3,
        holders: 14,
      }),
    ],
    "UTC",
  )
  assert.equal(rows[0].startHolders, null)
  assert.equal(rows[0].endHolders, 15)
  assert.equal(rows[1].startHolders, 15)
  assert.equal(rows[1].endHolders, 15)
  assert.equal(rows[2].startHolders, 15)
  assert.equal(rows[2].endHolders, 14)
})
