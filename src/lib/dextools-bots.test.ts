import assert from "node:assert/strict"
import test from "node:test"
import {
  applyDextoolsBots,
  botEventKey,
  dextoolsEventsUrl,
  readBotEvents,
  summarizeDextoolsBotProfit,
} from "./dextools-bots"

test("DEXTools bot pages key each swap and keep the next cursor", () => {
  const hash = "0xABC"
  const parsed = readBotEvents({
    data: {
      events: [
        { id: hash, logIndex: 4, blockNumber: 10, others: { bot: true, botAddress: "0x1" } },
        { id: hash, logIndex: 9, blockNumber: 10, others: {} },
        { id: "0xdef", logIndex: 1, blockNumber: 9 },
      ],
      next: { blockNumber: 8, logIndex: 2, date: "2026-01-01T00:00:00.000Z" },
    },
  })
  assert.equal(parsed.events.length, 3)
  assert.equal(parsed.events[0].bot, true)
  assert.equal(parsed.events[1].bot, false)
  assert.deepEqual(parsed.next, { blockNumber: 8, logIndex: 2 })
  assert.equal(botEventKey(hash, 4), "0xabc:4")
  assert.match(dextoolsEventsUrl("bnb", "0xABCDEF", parsed.next), /\/bsc\/0xabcdef\/newest\?blockNumber=8&logIndex=2&limit=100$/)
})

test("bot profit adds buys and subtracts sells, and leaves unmarked swaps out", () => {
  const summary = summarizeDextoolsBotProfit([
    { type: "BUY", quoteAmount: "1.5", dextoolsBot: true },
    { type: "SELL", quoteAmount: "0.25", dextoolsBot: true },
    { type: "ADD", quoteAmount: "9", dextoolsBot: true },
    { type: "BUY", quoteAmount: "0.4", dextoolsBot: false },
    { type: "SELL", quoteAmount: "0.1", dextoolsBot: false },
    { type: "BUY", quoteAmount: "8", dextoolsBot: null },
  ])
  assert.equal(summary.withProfit, "1.25")
  assert.equal(summary.withBuys, 1)
  assert.equal(summary.withSells, 1)
  assert.equal(summary.withoutProfit, "0.3")
  assert.equal(summary.withoutBuys, 1)
  assert.equal(summary.withoutSells, 1)
  assert.equal(summary.unknown, 1)
  const trades = [
    { txHash: "0xabc", logIndex: 4, dextoolsBot: null as boolean | null },
    { txHash: "0xabc", logIndex: 9, dextoolsBot: null as boolean | null },
  ]
  const flags = new Map([
    ["0xabc:4", true],
    ["0xabc:9", false],
  ])
  const applied = applyDextoolsBots(trades, flags)
  assert.deepEqual(
    applied.map((trade) => trade.dextoolsBot),
    [true, false],
  )
})
