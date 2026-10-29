import assert from "node:assert/strict"
import test from "node:test"
import { changeTone, formatChange, formatEthPrice, formatGwei, percentChange } from "./live-market"

test("percent change and formatting match header display", () => {
  assert.equal(percentChange(110, 100), 10)
  assert.equal(percentChange(100, 0), null)
  assert.equal(formatEthPrice(2339.15), "$2,339.15")
  assert.equal(formatEthPrice(null), "—")
  assert.equal(formatChange(0.53), "+0.53%")
  assert.equal(formatChange(-1.2), "−1.20%")
  assert.equal(formatChange(0), "0.00%")
  assert.equal(changeTone(0.53), "up")
  assert.equal(changeTone(-0.53), "down")
  assert.equal(changeTone(0.01), "flat")
  assert.equal(formatGwei(0.201), "0.201")
  assert.equal(formatGwei(12.4), "12.4")
})
