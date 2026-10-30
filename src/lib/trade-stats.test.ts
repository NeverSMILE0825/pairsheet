import assert from "node:assert/strict"
import test from "node:test"
import { summarizeTrades } from "./trade-stats"

test("Add / Remove stats count ADD only — INIT is not an add", () => {
  const stats = summarizeTrades([
    { type: "INIT", totalUsd: null },
    { type: "ADD", totalUsd: "2320.63" },
    { type: "BUY", totalUsd: "100" },
    { type: "SELL", totalUsd: "50" },
    { type: "REMOVE", totalUsd: null },
  ])
  assert.equal(stats.count, 5)
  assert.equal(stats.adds, 1)
  assert.equal(stats.removes, 1)
  assert.equal(stats.buys, 1)
  assert.equal(stats.sells, 1)
  assert.equal(stats.volume, 150)
})
