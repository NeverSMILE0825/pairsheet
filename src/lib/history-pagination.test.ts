import assert from "node:assert/strict"
import test from "node:test"
import { MAX_LOG_PAGE, ROUTESCAN_PAGE, continueAfterWindow, estimatedStartBlock, floorLooksClipped, mergeNewTrades, newestTradeBlock, nextLogPage, positiveSinceBlock } from "./history"
import { signaturesUntilBlock } from "./solana"
import type { Trade } from "./types"
import type { RawLog } from "./types"

function logsInRange(from: number, count: number): RawLog[] {
  return Array.from({ length: count }, (_, index) => ({
    data: "0x",
    topics: [],
    blockNumber: from + index,
    timestamp: 1,
    txHash: `0x${(from + index).toString(16).padStart(64, "0")}`,
    logIndex: 0,
  }))
}

test("nextLogPage moves a full page to the newest block instead of page 3", () => {
  const page = nextLogPage("routescan", 1, null, null, logsInRange(100, ROUTESCAN_PAGE))
  assert.deepEqual(page, {
    source: "routescan",
    page: 1,
    fromBlock: 100 + ROUTESCAN_PAGE - 1,
    toBlock: null,
    blockscoutParams: null,
  })
})

test("nextLogPage keeps paging when every log is still in the current block", () => {
  const logs = logsInRange(50, ROUTESCAN_PAGE).map((log) => ({ ...log, blockNumber: 50 }))
  const page = nextLogPage("routescan", 1, 50, null, logs)
  assert.equal(page?.page, 2)
  assert.equal(page?.fromBlock, 50)
})

test("nextLogPage advances fromBlock after page 10 (oldest-first APIs)", () => {
  const batch = logsInRange(26320111, ROUTESCAN_PAGE)
  const page = nextLogPage("routescan", MAX_LOG_PAGE, null, null, batch)
  assert.ok(page)
  assert.equal(page.page, 1)
  assert.equal(page.fromBlock, 26320111 + ROUTESCAN_PAGE - 1)
  assert.equal(page.toBlock, null)
})

test("nextLogPage stops on a short final page", () => {
  assert.equal(nextLogPage("routescan", 2, 100, null, logsInRange(500, 12)), null)
})

test("a short slice continues until the real tip", () => {
  const next = continueAfterWindow("routescan", 1, 100, 500, 900, logsInRange(100, 3))
  assert.equal(next?.page, 1)
  assert.equal(next?.fromBlock, 501)
  assert.equal(next?.toBlock, 900)
  assert.equal(continueAfterWindow("routescan", 1, 800, 900, 900, logsInRange(800, 3)), null)
})

test("nextLogPage advances an existing window when the page reaches a newer block", () => {
  const page = nextLogPage("blockscout", 1, 26321361, null, logsInRange(26321361, ROUTESCAN_PAGE))
  assert.deepEqual(page, {
    source: "blockscout",
    page: 1,
    fromBlock: 26321361 + ROUTESCAN_PAGE - 1,
    toBlock: null,
    blockscoutParams: null,
  })
})

test("a full chain read starts at the pool creation time and extends when logs touch that edge", () => {
  const tip = 26_400_000
  const now = Date.parse("2026-11-12T00:00:00Z")
  const created = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()
  const floor = estimatedStartBlock(created, tip, now)
  const threeDays = Math.ceil((3 * 24 * 60 * 60) / 12)
  assert.equal(floor, tip - threeDays - 30_000)
  assert.equal(estimatedStartBlock(null, tip, now), tip - 400_000)
  assert.equal(floorLooksClipped(floor + 10, floor, tip), true)
  assert.equal(floorLooksClipped(tip - 100, floor, tip), false)
})

test("live tail starts at the newest saved block and appends only new ids", () => {
  const older = { id: "0xaaa-1", blockNumber: 100 } as Trade
  const edge = { id: "0xbbb-2", blockNumber: 250 } as Trade
  const fresh = { id: "0xccc-3", blockNumber: 251 } as Trade
  assert.equal(newestTradeBlock([older, edge]), 250)
  assert.equal(positiveSinceBlock(250.9), 250)
  assert.equal(positiveSinceBlock(0), null)
  const existing = [older, edge]
  const merged = mergeNewTrades(existing, [edge, fresh])
  assert.deepEqual(merged.map((trade) => trade.id), ["0xaaa-1", "0xbbb-2", "0xccc-3"])
  assert.equal(mergeNewTrades(existing, [edge]), existing)
  assert.equal(mergeNewTrades(existing, []), existing)
})

test("solana live window stops once signatures are older than the saved slot", () => {
  const rows = [{ slot: 30 }, { slot: 20 }, { slot: 10 }]
  const cut = signaturesUntilBlock(rows, 20)
  assert.deepEqual(cut.keep, [{ slot: 30 }, { slot: 20 }])
  assert.equal(cut.reachedOlder, true)
  assert.equal(signaturesUntilBlock(rows, null).reachedOlder, false)
})
