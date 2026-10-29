/** Column visibility for Transactions and Deep Analysis tables. */

export const TX_COLUMNS_KEY = "pairsheet.txColumns.v1"
export const DA_COLUMNS_KEY = "pairsheet.daColumns.v1"

export type TxColumnId =
  | "txNo"
  | "timestamp"
  | "type"
  | "priceUsd"
  | "marketCapUsd"
  | "totalUsd"
  | "priceQuote"
  | "baseAmount"
  | "quoteAmount"
  | "baseReserve"
  | "quoteReserve"
  | "holders"
  | "gasPriceGwei"
  | "gasFeeTotalEth"
  | "maker"
  | "fundedBy"
  | "others"

export type DaColumnId =
  | "no"
  | "startMs"
  | "endMs"
  | "buyCount"
  | "sellCount"
  | "avgBuySpeedSec"
  | "avgSellSpeedSec"
  | "startQuoteReserve"
  | "endQuoteReserve"
  | "startMarketCapUsd"
  | "endMarketCapUsd"
  | "startPriceUsd"
  | "endPriceUsd"
  | "startHolders"
  | "endHolders"
  | "endGasPriceGwei"
  | "endGasFeeTotalEth"

export type ColumnDef<Id extends string> = {
  id: Id
  /** Static label when not pool-dependent. */
  label: string
}

export const TX_COLUMN_DEFS: ColumnDef<TxColumnId>[] = [
  { id: "txNo", label: "No" },
  { id: "timestamp", label: "Date" },
  { id: "type", label: "Type" },
  { id: "priceUsd", label: "Price (USD)" },
  { id: "marketCapUsd", label: "M. Cap" },
  { id: "totalUsd", label: "Total" },
  { id: "priceQuote", label: "Price (quote)" },
  { id: "baseAmount", label: "Base amount" },
  { id: "quoteAmount", label: "Quote amount" },
  { id: "baseReserve", label: "Pool base" },
  { id: "quoteReserve", label: "Pool quote" },
  { id: "holders", label: "Holders" },
  { id: "gasPriceGwei", label: "Gas Fee" },
  { id: "gasFeeTotalEth", label: "Gas Fee Total" },
  { id: "maker", label: "Maker / Txns" },
  { id: "fundedBy", label: "Funded by" },
  { id: "others", label: "Others" },
]

export const DA_COLUMN_DEFS: ColumnDef<DaColumnId>[] = [
  { id: "no", label: "No" },
  { id: "startMs", label: "Start Time" },
  { id: "endMs", label: "End Time" },
  { id: "buyCount", label: "Buy Count" },
  { id: "sellCount", label: "Sell Count" },
  { id: "avgBuySpeedSec", label: "Average Buy Speed" },
  { id: "avgSellSpeedSec", label: "Average Sell Speed" },
  { id: "startQuoteReserve", label: "Start Pool quote" },
  { id: "endQuoteReserve", label: "End Pool quote" },
  { id: "startMarketCapUsd", label: "Start M. Cap" },
  { id: "endMarketCapUsd", label: "End M. Cap" },
  { id: "startPriceUsd", label: "Start Price" },
  { id: "endPriceUsd", label: "End Price" },
  { id: "startHolders", label: "Start Holders" },
  { id: "endHolders", label: "End Holders" },
  { id: "endGasPriceGwei", label: "Gas Fee" },
  { id: "endGasFeeTotalEth", label: "Gas Fee Total" },
]

export function defaultTxVisibility(): Record<TxColumnId, boolean> {
  return Object.fromEntries(TX_COLUMN_DEFS.map((col) => [col.id, true])) as Record<TxColumnId, boolean>
}

export function defaultDaVisibility(): Record<DaColumnId, boolean> {
  return Object.fromEntries(DA_COLUMN_DEFS.map((col) => [col.id, true])) as Record<DaColumnId, boolean>
}

function readVisibility<Id extends string>(
  key: string,
  defs: ColumnDef<Id>[],
  fallback: Record<Id, boolean>,
): Record<Id, boolean> {
  if (typeof window === "undefined") return fallback
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<Record<Id, boolean>>
    const next = { ...fallback }
    for (const col of defs) {
      if (typeof parsed[col.id] === "boolean") next[col.id] = parsed[col.id] as boolean
    }
    if (!defs.some((col) => next[col.id])) return fallback
    return next
  } catch {
    return fallback
  }
}

export function loadTxVisibility(): Record<TxColumnId, boolean> {
  return readVisibility(TX_COLUMNS_KEY, TX_COLUMN_DEFS, defaultTxVisibility())
}

export function loadDaVisibility(): Record<DaColumnId, boolean> {
  return readVisibility(DA_COLUMNS_KEY, DA_COLUMN_DEFS, defaultDaVisibility())
}

export function saveTxVisibility(value: Record<TxColumnId, boolean>): void {
  try {
    window.localStorage.setItem(TX_COLUMNS_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function saveDaVisibility(value: Record<DaColumnId, boolean>): void {
  try {
    window.localStorage.setItem(DA_COLUMNS_KEY, JSON.stringify(value))
  } catch {
    // ignore
  }
}

export function countVisible(map: Record<string, boolean>): number {
  return Object.values(map).filter(Boolean).length
}

/** Approximate min table width so fewer columns don't force a huge scroll. */
export function tableMinWidth(visibleCount: number, base = 520, perCol = 108): number {
  return Math.max(base, visibleCount * perCol)
}

/** Show gwei with 3 decimals even if an older snapshot stored more precision. */
export function displayGwei(raw: string | null | undefined): string | null {
  if (raw == null || raw === "") return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return raw
  return value.toFixed(3)
}
