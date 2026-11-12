import assert from "node:assert/strict"
import test from "node:test"
import { deleteTeamLabel, makerInLabel, netQuoteFlow, parseTeamAddresses, saveTeamLabel } from "./team-labels"

const A = "0x1111111111111111111111111111111111111111"
const B = "0x2222222222222222222222222222222222222222"

test("parseTeamAddresses keeps full addresses and drops junk", () => {
  const parsed = parseTeamAddresses(`eth, ${A}\n${A.toUpperCase()} ${B.slice(0, 10)} ${B}`)
  assert.deepEqual(parsed, [A, B])
})

test("saveTeamLabel adds a group and editing the same name replaces it", () => {
  const first = saveTeamLabel([], { name: "ETH", addresses: [A] }, "t1")
  assert.equal(first.length, 1)
  assert.equal(first[0].addresses.length, 1)
  const second = saveTeamLabel(first, { name: "GTA", addresses: [B] }, "t2")
  assert.deepEqual(second.map((label) => label.name), ["GTA", "ETH"])
  const edited = saveTeamLabel(second, { id: first[0].id, name: "ETH", addresses: [A, B] }, "t3")
  assert.equal(edited.find((label) => label.name === "ETH")?.addresses.length, 2)
  assert.equal(edited.filter((label) => label.name === "ETH").length, 1)
  assert.equal(deleteTeamLabel(edited, first[0].id).some((label) => label.name === "ETH"), false)
})

test("only and without match the label, and net quote adds buys and subtracts sells", () => {
  const set = new Set([A])
  assert.equal(makerInLabel(A, set, "only"), true)
  assert.equal(makerInLabel(B, set, "only"), false)
  assert.equal(makerInLabel(B, set, "without"), true)
  assert.equal(makerInLabel(A, set, "without"), false)
  assert.equal(
    netQuoteFlow([
      { type: "BUY", quoteAmount: "1.5" },
      { type: "SELL", quoteAmount: "0.25" },
      { type: "ADD", quoteAmount: "10" },
    ]),
    "1.25",
  )
})
