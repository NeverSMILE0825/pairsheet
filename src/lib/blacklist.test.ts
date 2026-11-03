import assert from "node:assert/strict"
import test from "node:test"
import { addBlacklistIds, removeBlacklistIds } from "./blacklist"

test("blacklist add keeps existing ids and appends new ones once", () => {
  const current = ["a", "b"]
  const next = addBlacklistIds(current, ["b", "c", "a", ""])
  assert.deepEqual(next, ["a", "b", "c"])
  assert.equal(addBlacklistIds(current, ["a"]), current)
  assert.equal(addBlacklistIds(current, []), current)
})

test("blacklist remove drops only the requested ids", () => {
  const current = ["a", "b", "c"]
  assert.equal(removeBlacklistIds(current, new Set()), current)
  assert.equal(removeBlacklistIds(current, new Set(["z"])), current)
  assert.deepEqual(removeBlacklistIds(current, new Set(["b", "c"])), ["a"])
})
