import assert from "node:assert/strict"
import test from "node:test"
import { MAX_SAVED_PAIRS, pickPayloadsToPrune, type SavedAnalysisMeta } from "./saved-analyses"

function meta(partial: Partial<SavedAnalysisMeta> & Pick<SavedAnalysisMeta, "id">): SavedAnalysisMeta {
  return {
    url: "https://example.com",
    savedAt: "2026-10-28T00:00:00.000Z",
    chainId: "ether",
    chainName: "Ethereum",
    address: "0x1",
    dex: "Uniswap",
    baseSymbol: "AAA",
    quoteSymbol: "ETH",
    tradeCount: 1,
    ...partial,
  }
}

test("saved pair count has no numeric ceiling", () => {
  assert.equal(Number.isFinite(MAX_SAVED_PAIRS), false)
  assert.ok(MAX_SAVED_PAIRS > 10_000)
})

test("pickPayloadsToPrune drops unstarred oldest first and never touches preserveIds", () => {
  const rows = [
    meta({ id: "keep", savedAt: "2026-01-01T00:00:00.000Z", starred: false }),
    meta({ id: "old", savedAt: "2026-01-02T00:00:00.000Z", starred: false }),
    meta({ id: "star", savedAt: "2026-01-01T00:00:00.000Z", starred: true }),
    meta({ id: "mid", savedAt: "2026-01-03T00:00:00.000Z", starred: false }),
  ]
  assert.deepEqual(pickPayloadsToPrune(rows, new Set(["keep"]), 2), ["old", "mid"])
  assert.deepEqual(pickPayloadsToPrune(rows, new Set(["keep", "old", "mid"]), 1), ["star"])
  assert.deepEqual(pickPayloadsToPrune(rows, new Set(rows.map((row) => row.id)), 5), [])
})
