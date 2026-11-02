import assert from "node:assert/strict"
import test from "node:test"
import { MAX_LOG_PAGE, ROUTESCAN_PAGE, nextLogPage } from "./history"
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

test("nextLogPage keeps paging until the 10k explorer ceiling", () => {
  const page = nextLogPage("routescan", 3, null, null, logsInRange(100, ROUTESCAN_PAGE))
  assert.deepEqual(page, {
    source: "routescan",
    page: 4,
    fromBlock: null,
    toBlock: null,
    blockscoutParams: null,
  })
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

test("nextLogPage preserves an existing fromBlock while paging inside a window", () => {
  const page = nextLogPage("blockscout", 1, 26321361, null, logsInRange(26321361, ROUTESCAN_PAGE))
  assert.deepEqual(page, {
    source: "blockscout",
    page: 2,
    fromBlock: 26321361,
    toBlock: null,
    blockscoutParams: null,
  })
})
