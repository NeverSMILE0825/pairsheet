import assert from "node:assert/strict"
import test from "node:test"
import {
  FUNDER_REVISION,
  applyFunderResults,
  earliestIncoming,
  fundingRowFromExplorer,
  makersToRefresh,
  type FundingRow,
} from "./funded"

const maker = "0x591f85c11cafea17f7cc926f13e2ed7c794f2522"

function row(partial: Partial<FundingRow> & Pick<FundingRow, "from" | "blockNumber">): FundingRow {
  return {
    to: maker,
    value: "1",
    timestamp: partial.blockNumber,
    ...partial,
  }
}

test("funded by is the earlier internal credit, not a later normal top-up", () => {
  const first = earliestIncoming(maker, [
    row({ from: "0x00000000000000000000000000000000000000aa", blockNumber: 500, timestamp: 500 }),
    row({
      from: "0x00000000000000000000000000000000000000bb",
      blockNumber: 100,
      timestamp: 100,
      traceType: "call",
    }),
  ])
  assert.equal(first?.from, "0x00000000000000000000000000000000000000bb")
})

test("funded by keeps ETH sent when the contract was created", () => {
  const parsed = fundingRowFromExplorer({
    from: "0x00000000000000000000000000000000000000cc",
    to: "",
    contractAddress: maker,
    value: "1000",
    blockNumber: "10",
    timeStamp: "10",
    transactionIndex: "2",
    traceId: "0",
    type: "create",
    isError: "0",
  })
  assert.ok(parsed)
  const first = earliestIncoming(maker, [
    parsed,
    row({ from: "0x00000000000000000000000000000000000000dd", blockNumber: 11 }),
  ])
  assert.equal(first?.from, "0x00000000000000000000000000000000000000cc")
})

test("opening a saved tape refreshes every maker until the current rule is stored", () => {
  const trades = [
    { maker: "0xAAAA", fundedByAddress: "0x1111" },
    { maker: "0xBBBB", fundedByAddress: null },
  ]
  assert.deepEqual(makersToRefresh("ether", trades, undefined, undefined, false), ["0xaaaa", "0xbbbb"])
  assert.deepEqual(makersToRefresh("ether", trades, FUNDER_REVISION, ["0xaaaa", "0xbbbb"], false), [])
  assert.deepEqual(makersToRefresh("ether", trades, FUNDER_REVISION, ["0xaaaa"], false), ["0xbbbb"])
  assert.deepEqual(
    makersToRefresh("ether", [{ maker: "0xAAAA", fundedByAddress: null }], undefined, undefined, false),
    [],
  )
  assert.deepEqual(
    makersToRefresh("ether", [{ maker: "0xAAAA", fundedByAddress: null }], undefined, undefined, true),
    ["0xaaaa"],
  )
})

test("applying a funder replaces a saved address", () => {
  const applied = applyFunderResults(
    "ether",
    [{ maker: "0xAAAA", fundedBy: "0x1111…1111", fundedByAddress: "0x1111111111111111111111111111111111111111" }],
    new Map([["0xaaaa", { address: "0x2222222222222222222222222222222222222222", label: "0x2222…2222" }]]),
  )
  assert.equal(applied.changed, true)
  assert.equal(applied.trades[0].fundedByAddress, "0x2222222222222222222222222222222222222222")
})

test("funded by ignores failed traces, self transfers, delegatecalls, and zero-value creates", () => {
  const first = earliestIncoming(maker, [
    row({ from: "0x0000000000000000000000000000000000000011", blockNumber: 1, failed: true }),
    row({ from: maker, blockNumber: 2 }),
    row({ from: "0x0000000000000000000000000000000000000022", blockNumber: 3, traceType: "delegatecall" }),
    row({
      from: "0x0000000000000000000000000000000000000033",
      to: "",
      contractAddress: maker,
      blockNumber: 4,
      value: "0",
      traceType: "create",
    }),
    row({ from: "0x0000000000000000000000000000000000000044", blockNumber: 5, txIndex: 9 }),
    row({ from: "0x0000000000000000000000000000000000000055", blockNumber: 5, txIndex: 2 }),
  ])
  assert.equal(first?.from, "0x0000000000000000000000000000000000000055")
})
