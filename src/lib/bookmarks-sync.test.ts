import assert from "node:assert/strict"
import test from "node:test"
import { isSyncSuccessful, type SyncStatus } from "./bookmarks-sync"
import { mergeSavedMeta, type SavedAnalysisMeta } from "./saved-analyses"

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

test("mergeSavedMeta keeps stars and prefers newer saves", () => {
  const local = [meta({ id: "a", savedAt: "2026-10-29T00:00:00.000Z", tradeCount: 10, starred: true })]
  const remote = [
    meta({ id: "a", savedAt: "2026-10-28T00:00:00.000Z", tradeCount: 3 }),
    meta({ id: "b", baseSymbol: "BBB", tradeCount: 2 }),
  ]
  const merged = mergeSavedMeta(local, remote)
  assert.equal(merged.length, 2)
  assert.equal(merged[0].id, "a")
  assert.equal(merged[0].starred, true)
  assert.equal(merged[0].tradeCount, 10)
  assert.equal(merged[1].id, "b")
})

test("isSyncSuccessful requires a non-empty successful publish, not lastAction alone", () => {
  const base: SyncStatus = {
    enabled: true,
    lastOkAt: "2026-10-29T15:00:00.000Z",
    lastError: null,
    lastCount: 3,
    lastAction: "publish",
  }
  assert.equal(isSyncSuccessful(base), true)
  // Opening the dialog used to flip lastAction to pull and break the badge.
  assert.equal(isSyncSuccessful({ ...base, lastAction: "pull" }), true)
  assert.equal(isSyncSuccessful({ ...base, lastCount: 0 }), false)
  assert.equal(isSyncSuccessful({ ...base, lastError: "boom" }), false)
  assert.equal(isSyncSuccessful({ ...base, enabled: false }), false)
  assert.equal(isSyncSuccessful({ ...base, lastOkAt: null }), false)
})
