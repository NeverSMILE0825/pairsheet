import assert from "node:assert/strict"
import test from "node:test"
import { deleteEtherscanKey, maskEtherscanKey, normalizeEtherscanKey, saveEtherscanKey } from "./etherscan-keys"

test("etherscan keys reject blanks and duplicates replace the same key", () => {
  assert.equal(normalizeEtherscanKey("  short  "), null)
  assert.equal(normalizeEtherscanKey("abc"), null)
  const key = "A".repeat(34)
  assert.equal(normalizeEtherscanKey(` ${key} `), key)
  const first = saveEtherscanKey([], { name: "Main", key }, "t1")
  assert.ok(first)
  assert.equal(first.length, 1)
  assert.equal(maskEtherscanKey(key), "••••AAAA")
  const again = saveEtherscanKey(first, { name: "Backup", key }, "t2")
  assert.ok(again)
  assert.equal(again.length, 1)
  assert.equal(again[0].name, "Backup")
  assert.equal(again[0].id, first[0].id)
  const other = "B".repeat(34)
  const two = saveEtherscanKey(again, { name: "", key: other }, "t3")
  assert.equal(two?.length, 2)
  assert.equal(deleteEtherscanKey(two ?? [], again[0].id).some((row) => row.key === key), false)
})
