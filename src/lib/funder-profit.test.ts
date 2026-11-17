import assert from "node:assert/strict"
import test from "node:test"
import { UNKNOWN_FUNDER_KEY, funderProfitKey, sourceClickSelection, summarizeFunderProfit, type FunderProfitTrade } from "./funder-profit"

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

function row(partial: Partial<FunderProfitTrade> & Pick<FunderProfitTrade, "type" | "quoteAmount">): FunderProfitTrade {
  return {
    fundedBy: null,
    fundedByAddress: null,
    ...partial,
  }
}

test("funded by profit adds buys, subtracts sells, and splits selected from the rest", () => {
  const trades = [
    row({ type: "BUY", quoteAmount: "1.5", fundedBy: "Alpha", fundedByAddress: A }),
    row({ type: "SELL", quoteAmount: "0.25", fundedBy: "Alpha", fundedByAddress: A.toUpperCase() }),
    row({ type: "ADD", quoteAmount: "9", fundedBy: "Alpha", fundedByAddress: A }),
    row({ type: "BUY", quoteAmount: "0.4", fundedBy: "Beta", fundedByAddress: B }),
    row({ type: "SELL", quoteAmount: "0.1", fundedBy: null, fundedByAddress: null }),
  ]
  assert.equal(funderProfitKey(trades[1]), A)
  assert.equal(funderProfitKey(trades[4]), UNKNOWN_FUNDER_KEY)
  const summary = summarizeFunderProfit(trades, new Set([A]))
  const alpha = summary.rows.find((item) => item.key === A)
  const beta = summary.rows.find((item) => item.key === B)
  const unknown = summary.rows.find((item) => item.key === UNKNOWN_FUNDER_KEY)
  assert.equal(alpha?.profit, "1.25")
  assert.equal(alpha?.count, 3)
  assert.equal(alpha?.buys, 1)
  assert.equal(alpha?.sells, 1)
  assert.equal(beta?.profit, "0.4")
  assert.equal(unknown?.label, "Unknown")
  assert.equal(unknown?.profit, "-0.1")
  assert.equal(summary.selectedProfit, "1.25")
  assert.equal(summary.selectedSwaps, 2)
  assert.equal(summary.excludedProfit, "0.3")
  assert.equal(summary.excludedSwaps, 2)
  assert.deepEqual(
    summary.rows.map((item) => item.key),
    [A, B, UNKNOWN_FUNDER_KEY],
  )
})

test("shift-click checks every funded-by source between the first and last click", () => {
  const keys = ["a", "b", "c", "d", "e"]
  const first = sourceClickSelection(keys, null, 1, false)
  assert.deepEqual(first, { mode: "toggle", keys: ["b"], anchor: 1 })
  const range = sourceClickSelection(keys, first?.anchor ?? null, 4, true)
  assert.deepEqual(range, { mode: "add", keys: ["b", "c", "d", "e"], anchor: 4 })
  const upward = sourceClickSelection(keys, 4, 0, true)
  assert.deepEqual(upward, { mode: "add", keys: ["a", "b", "c", "d", "e"], anchor: 0 })
  assert.equal(sourceClickSelection(keys, 0, 2, false)?.mode, "toggle")
  assert.equal(sourceClickSelection(keys, null, 9, true), null)
})

test("an empty selection puts every source in the excluded total", () => {
  const summary = summarizeFunderProfit(
    [row({ type: "BUY", quoteAmount: "2", fundedBy: "Alpha", fundedByAddress: A })],
    new Set(),
  )
  assert.equal(summary.selectedProfit, "0")
  assert.equal(summary.selectedSwaps, 0)
  assert.equal(summary.excludedProfit, "2")
  assert.equal(summary.excludedSwaps, 1)
})
