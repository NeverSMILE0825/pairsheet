import assert from "node:assert/strict"
import test from "node:test"
import {
  averageSpeedSec,
  buildMinuteTape,
  floorToMinuteMs,
  formatMinuteLabel,
  formatSpeed,
} from "./minute-tape"
import type { Trade } from "./types"

function trade(partial: Partial<Trade> & Pick<Trade, "type" | "timestamp">): Trade {
  return {
    id: partial.id ?? partial.timestamp,
    txNo: 0,
    blockNumber: 1,
    logIndex: 0,
    priceUsd: null,
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
    ...partial,
  }
}

test("floors timestamps to the start of the minute", () => {
  assert.equal(floorToMinuteMs("2026-10-26T16:20:59.000Z"), Date.parse("2026-10-26T16:20:00.000Z"))
  assert.equal(floorToMinuteMs("2026-10-26T16:21:00.000Z"), Date.parse("2026-10-26T16:21:00.000Z"))
})

test("average speed is 60 seconds divided by the count", () => {
  assert.equal(averageSpeedSec(0), null)
  assert.equal(averageSpeedSec(1), 60)
  assert.equal(averageSpeedSec(20), 3)
  assert.equal(averageSpeedSec(15), 4)
  assert.equal(averageSpeedSec(2), 30)
  assert.equal(formatSpeed(null), "—")
  assert.equal(formatSpeed(3), "3s")
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
  assert.equal(formatSpeed(rows[0].avgBuySpeedSec), "—")
})
