import assert from "node:assert/strict"
import test from "node:test"
import {
  bookmarkSyncFingerprint,
  describeBookmarkSync,
  isSyncSuccessful,
  type SyncStatus,
} from "./bookmarks-sync"
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

test("bookmark sync skips identical lists and names real changes", () => {
  const a = meta({ id: "a", baseSymbol: "GINNAN", tradeCount: 10 })
  const b = meta({ id: "b", baseSymbol: "PEPE", address: "0x2" })
  assert.equal(bookmarkSyncFingerprint([a, b]), bookmarkSyncFingerprint([b, a]))
  assert.equal(describeBookmarkSync([a, b], [a, b]), null)
  assert.equal(describeBookmarkSync([a], [a, b]), "Add PEPE/ETH to shared bookmarks")
  assert.equal(describeBookmarkSync([a, b], [a]), "Remove PEPE/ETH from shared bookmarks")
  assert.equal(
    describeBookmarkSync([a], [meta({ ...a, starred: true })]),
    "Star GINNAN/ETH on shared bookmarks",
  )
  assert.equal(
    describeBookmarkSync([a], [meta({ ...a, tradeCount: 4476, savedAt: "2026-10-30T00:00:00.000Z" })]),
    "Update GINNAN/ETH (4,476 trades) on shared bookmarks",
  )
})
