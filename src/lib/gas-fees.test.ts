import assert from "node:assert/strict"
import test from "node:test"
import {
  applyGasFees,
  assignGasFeeTotals,
  formatEth4,
  formatGasPriceGwei,
  normalizeGasPriceString,
  normalizeTradeGasFormats,
  parseReceiptGas,
  tradesNeedGasRepair,
} from "./gas-fees"
import type { Trade } from "./types"

function trade(partial: Partial<Trade> & Pick<Trade, "id" | "txHash" | "blockNumber" | "logIndex">): Trade {
  return {
    txNo: 0,
    timestamp: "2024-01-01T00:00:00.000Z",
    type: "BUY",
    priceUsd: null,
    marketCapUsd: null,
    totalUsd: null,
    priceQuote: null,
    baseAmount: "1",
    quoteAmount: "1",
    baseReserve: null,
    quoteReserve: null,
    holders: null,
    maker: "0x1",
    router: "",
    makerTxCount: 0,
    makerTags: [],
    fundedBy: null,
    fundedByAddress: null,
    gasPriceGwei: null,
    gasFeeWei: null,
    gasFeeTotalEth: null,
    ...partial,
  }
}

test("formats gwei and eth with fixed decimals", () => {
  assert.equal(formatGasPriceGwei(12_500_000_000n), "12.500")
  assert.equal(formatGasPriceGwei(276_000_000n), "0.276")
  assert.equal(formatGasPriceGwei(413_400_000n), "0.413")
  assert.equal(formatEth4(250_000_000_000_000n), "0.0003")
  assert.equal(formatEth4(1_000_000_000_000_000n), "0.0010")
})

test("parses receipt gas fields", () => {
  const gas = parseReceiptGas({
    gasUsed: "0x5208",
    effectiveGasPrice: "0x2e90edd000",
  })
  assert.ok(gas)
  assert.equal(gas.gasUsed, 21000n)
  assert.equal(gas.effectiveGasPrice, 200_000_000_000n)
})

test("cumulative gas totals count each tx hash once", () => {
  const gasByTx = new Map([
    ["0xaa", { gasUsed: 100_000n, effectiveGasPrice: 10_000_000_000n }], // 0.001 eth
    ["0xbb", { gasUsed: 100_000n, effectiveGasPrice: 20_000_000_000n }], // 0.002 eth
  ])
  const rows = applyGasFees(
    [
      trade({ id: "2", txHash: "0xbb", blockNumber: 2, logIndex: 0 }),
      trade({ id: "1a", txHash: "0xaa", blockNumber: 1, logIndex: 1 }),
      trade({ id: "1b", txHash: "0xaa", blockNumber: 1, logIndex: 2 }),
    ],
    gasByTx,
  )
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  assert.equal(byId["1a"].gasPriceGwei, "10.000")
  assert.equal(byId["1b"].gasPriceGwei, "10.000")
  assert.equal(byId["1a"].gasFeeTotalEth, "0.0010")
  assert.equal(byId["1b"].gasFeeTotalEth, "0.0010")
  assert.equal(byId["2"].gasFeeTotalEth, "0.0030")
})

test("assignGasFeeTotals keeps running sum across the full tape", () => {
  const numbered = assignGasFeeTotals([
    trade({ id: "new", txHash: "0x2", blockNumber: 20, logIndex: 0, gasFeeWei: "1000000000000000" }),
    trade({ id: "old", txHash: "0x1", blockNumber: 10, logIndex: 0, gasFeeWei: "1000000000000000" }),
  ])
  const byId = Object.fromEntries(numbered.map((row) => [row.id, row.gasFeeTotalEth]))
  assert.equal(byId.old, "0.0010")
  assert.equal(byId.new, "0.0020")
})

test("normalizes legacy gas price strings to 3 decimals", () => {
  assert.equal(normalizeGasPriceString("0.05605884"), "0.056")
  assert.equal(normalizeGasPriceString("12.5"), "12.500")
  const legacy = [
    trade({
      id: "a",
      txHash: "0xaa",
      blockNumber: 1,
      logIndex: 0,
      gasPriceGwei: "0.05605884",
      gasFeeWei: "1000",
      gasFeeTotalEth: "0.0001",
    }),
  ]
  assert.equal(tradesNeedGasRepair(legacy), true)
  const fixed = normalizeTradeGasFormats(legacy)
  assert.equal(fixed.changed, true)
  assert.equal(fixed.trades[0].gasPriceGwei, "0.056")
})
