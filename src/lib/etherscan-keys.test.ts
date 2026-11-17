import assert from "node:assert/strict"
import test from "node:test"
import {
  deleteEtherscanKey,
  maskEtherscanKey,
  normalizeEtherscanKey,
  parseEtherscanKeyPaste,
  saveEtherscanKey,
  saveEtherscanKeys,
} from "./etherscan-keys"

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

test("a paste saves every key at once and keeps keys already stored", () => {
  const first = "A".repeat(34)
  const second = "B".repeat(34)
  const third = "C".repeat(34)
  const parsed = parseEtherscanKeyPaste(`${first}\nBackup ${second}\nZZZZ-not-a-real-key-value`)
  assert.deepEqual(
    parsed.entries.map((entry) => entry.key),
    [first, second],
  )
  assert.equal(parsed.entries[1].name, "Backup")
  assert.equal(parsed.invalid, 1)
  const existing = saveEtherscanKey([], { name: "Old", key: third }, "t0")
  const saved = saveEtherscanKeys(existing ?? [], { name: "Batch", text: `${first}\n${second}` }, "t1")
  assert.ok(saved)
  assert.equal(saved.added, 2)
  assert.equal(saved.keys.length, 3)
  assert.deepEqual(
    saved.keys.map((row) => row.key),
    [first, second, third],
  )
  assert.equal(saved.keys[0].name, "")
  const named = saveEtherscanKeys([], { name: "Main", text: first }, "t3")
  assert.equal(named?.keys[0].name, "Main")
  const again = saveEtherscanKeys(saved.keys, { text: second }, "t2")
  assert.equal(again?.added, 0)
  assert.equal(again?.updated, 1)
  assert.equal(again?.keys.length, 3)
})

test("a key file with a header and a BOM still loads every key", () => {
  const first = "F".repeat(34)
  const second = "G".repeat(34)
  const parsed = parseEtherscanKeyPaste(`\uFEFF# etherscan keys\r\n${first}\r\n${second}\r\n`)
  assert.deepEqual(
    parsed.entries.map((entry) => entry.key),
    [first, second],
  )
  assert.equal(parsed.invalid, 1)
  const saved = saveEtherscanKeys([], { text: `\uFEFF${first}\r\n${second}` }, "t4")
  assert.equal(saved?.added, 2)
  assert.equal(saved?.keys.length, 2)
})

test("a paste still finds keys wrapped in quotes or apikey=", () => {
  const first = "D".repeat(34)
  const second = "E".repeat(34)
  const parsed = parseEtherscanKeyPaste(`"${first}"\napikey=${second}\n${first} ${second}`)
  assert.deepEqual(
    parsed.entries.map((entry) => entry.key),
    [first, second],
  )
})
