import assert from "node:assert/strict"
import test from "node:test"
import type { Trade } from "./types"
import { applyLedgerPoolReserves, finalizeV4Tape } from "./v4-tape"

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "type">): Trade {
  return {
    txNo: 0,
    timestamp: "2026-10-26T16:20:59.000Z",
    blockNumber: 1,
    logIndex: 0,
    priceUsd: null,
    marketCapUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "0",
    quoteAmount: "0",
    baseReserve: null,
    quoteReserve: null,
    holders: null,
    maker: "0xabc",
    router: "",
    makerTxCount: 0,
    makerTags: [],
    txHash: "0x1",
    fundedBy: null,
    fundedByAddress: null,
    gasPriceGwei: null,
    gasFeeWei: null,
    gasFeeTotalEth: null,
    ...partial,
  }
}

test("V4 ledger pool sizes follow actual ADD then BUY — no phantom ETH", () => {
  const rows = applyLedgerPoolReserves([
    trade({ id: "init", type: "INIT", logIndex: 0 }),
    trade({
      id: "add",
      type: "ADD",
      logIndex: 1,
      baseAmount: "1000000000",
      quoteAmount: "0",
      totalUsd: "0",
    }),
    trade({
      id: "buy",
      type: "BUY",
      blockNumber: 2,
      logIndex: 0,
      baseAmount: "44356409.389851241404368592",
      quoteAmount: "0.04642924",
      totalUsd: "107.83",
      priceUsd: "0.000002431",
    }),
  ])
  const add = rows.find((row) => row.id === "add")
  const buy = rows.find((row) => row.id === "buy")
  assert.ok(add && buy)
  assert.equal(add.baseReserve, "1000000000")
  assert.equal(add.quoteReserve, "0")
  assert.equal(buy.quoteReserve, "0.04642924")
  assert.match(buy.baseReserve ?? "", /^955643590\./)
})

test("finalizeV4Tape fills INIT price and one-sided ADD total from quote USD", () => {
  const rows = finalizeV4Tape(
    [
      trade({
        id: "init",
        type: "INIT",
        logIndex: 0,
        priceQuote: "0.000000001",
      }),
      trade({
        id: "add",
        type: "ADD",
        logIndex: 1,
        baseAmount: "1000000000",
        quoteAmount: "0",
        totalUsd: "0",
      }),
      trade({
        id: "buy",
        type: "BUY",
        blockNumber: 2,
        baseAmount: "44356409",
        quoteAmount: "0.04642924",
        totalUsd: "107.83",
        priceUsd: "0.000002431",
      }),
    ],
    "1000000000",
  )
  const init = rows.find((row) => row.id === "init")
  const add = rows.find((row) => row.id === "add")
  const buy = rows.find((row) => row.id === "buy")
  assert.ok(init && add && buy)
  assert.ok(init.priceUsd)
  assert.ok(Number(init.priceUsd) > 0)
  assert.ok(add.totalUsd)
  assert.ok(Number(add.totalUsd) > 2000)
  assert.equal(buy.quoteReserve, "0.04642924")
  assert.notEqual(buy.quoteReserve, "1.0467")
})
