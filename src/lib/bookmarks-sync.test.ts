import assert from "node:assert/strict"
import test from "node:test"
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
