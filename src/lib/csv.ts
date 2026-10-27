import { formatZoned } from "./timezone"
import type { PoolView, Trade } from "./types"

const HEADERS = [
  "tx_no",
  "date_utc",
  "date_local",
  "timezone",
  "type",
  "price_usd",
  "total_usd",
  "price_in_quote",
  "base_symbol",
  "base_amount",
  "quote_symbol",
  "quote_amount",
  "pool_base_after",
  "pool_quote_after",
  "maker",
  "maker_tx_count",
  "maker_tags",
  "tx_to",
  "funded_by",
  "funded_by_address",
  "tx_hash",
  "block_number",
  "log_index",
  "chain",
  "pool_address",
]

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function tradesToCsv(pool: PoolView, trades: Trade[], timeZone = "UTC"): string {
  const lines = [HEADERS.join(",")]
  for (const trade of trades) {
    lines.push(
      [
        trade.txNo,
        trade.timestamp,
        formatZoned(trade.timestamp, timeZone),
        timeZone,
        trade.type,
        trade.priceUsd,
        trade.totalUsd,
        trade.priceQuote,
        pool.baseSymbol,
        trade.baseAmount,
        pool.quoteSymbol,
        trade.quoteAmount,
        trade.baseReserve,
        trade.quoteReserve,
        trade.maker,
        trade.makerTxCount,
        trade.makerTags.join(";"),
        trade.router,
        trade.fundedBy,
        trade.fundedByAddress,
        trade.txHash,
        trade.blockNumber,
        trade.logIndex,
        pool.chainId,
        pool.address,
      ]
        .map(escapeCell)
        .join(","),
    )
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`
}

export function csvFilename(pool: Pick<PoolView, "baseSymbol" | "quoteSymbol" | "chainId">): string {
  const slug = `${pool.baseSymbol}-${pool.quoteSymbol}-${pool.chainId}-swaps`
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-+/g, "-")
  return `${slug}.csv`
}
