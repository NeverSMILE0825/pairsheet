import { assignGasFeeTotals } from "./gas-fees"
import { normalizeAddress } from "./format"
import type { ContractInfo } from "./wallets"
import type { MakerTag, Trade } from "./types"

export type WalletFacts = {
  contracts: Record<string, ContractInfo>
  deployer: string | null
}

export type AnnotateOptions = {
  /** Uniswap V4 PoolManager (or other singleton the pair routes through). */
  poolManager?: string | null
}

export const EMPTY_FACTS: WalletFacts = { contracts: {}, deployer: null }

/** DEXTools `isFrontRunning` window: opposite buy/sell with same token amount within this many seconds. */
export const FRONT_RUNNING_WINDOW_SEC = 30
// Routers that carry the most trades first, so a capped lookup covers the bulk of the tape.
export function routersToCheck(trades: Trade[], poolAddress: string, limit: number): string[] {
  const pool = normalizeAddress(poolAddress)
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const router = normalizeAddress(trade.router)
    if (!router || router === pool) continue
    counts.set(router, (counts.get(router) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([router]) => router)
}

/** Top makers by tx count — used when looking up contract / deployer facts. */
export function makersToCheck(trades: Trade[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const maker = normalizeAddress(trade.maker)
    if (!maker) continue
    counts.set(maker, (counts.get(maker) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([maker]) => maker)
}

function unixSeconds(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0
}

function sameTokenAmount(left: Trade, right: Trade): boolean {
  const a = left.baseAmount.trim()
  const b = right.baseAmount.trim()
  if (!a || !b) return false
  if (a === b) return true
  const na = Number(a)
  const nb = Number(b)
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb
}

function quoteEth(trade: Trade): number {
  const n = Number(trade.quoteAmount)
  return Number.isFinite(n) ? Math.abs(n) : 0
}

type FrontRow = {
  trade: Trade
  maker: string
  ts: number
  frontRunning: number | undefined
}

/**
 * DEXTools pair-explorer front-running / sandwich mark
 * (`isFrontRunning` + `fillTransactionsWithFrontRunning`).
 * Opposite buy+sell, different id, same maker, and (same second OR same token
 * amount within 30s). Drain = |quote ETH difference| between the two legs.
 */
export function frontRunningById(trades: Trade[]): Map<string, number> {
  const swaps = trades.filter((trade) => trade.type === "BUY" || trade.type === "SELL")

  function isFrontRunning(existing: FrontRow, current: FrontRow): boolean {
    if (existing.frontRunning !== undefined) return false
    if (existing.trade.id === current.trade.id) return false
    if (existing.trade.type === current.trade.type) return false
    if (!(existing.maker && existing.maker === current.maker)) return false
    const sameTs = existing.ts === current.ts
    const sameAmount = sameTokenAmount(existing.trade, current.trade)
    const within = Math.abs(existing.ts - current.ts) < FRONT_RUNNING_WINDOW_SEC
    return sameTs || (sameAmount && within)
  }

  // Newest-first, matching only against already-seen (newer) legs — same as
  // DEXTools when filling a batch against an empty "existing" list.
  const newestFirst = [...swaps].sort(
    (a, b) =>
      unixSeconds(b.timestamp) - unixSeconds(a.timestamp) ||
      b.blockNumber - a.blockNumber ||
      b.logIndex - a.logIndex ||
      b.id.localeCompare(a.id),
  )
  const processed: FrontRow[] = []

  for (const trade of newestFirst) {
    const current: FrontRow = {
      trade,
      maker: normalizeAddress(trade.maker),
      ts: unixSeconds(trade.timestamp),
      frontRunning: undefined,
    }
    let matched: number | undefined
    // DEXTools also scans ±5 neighbors of existing history; for a full local
    // tape the accumulating newest-first list covers same-second sandwiches.
    for (const other of processed) {
      if (!isFrontRunning(other, current)) continue
      const drain = Math.abs(quoteEth(current.trade) - quoteEth(other.trade))
      other.frontRunning = drain
      matched = drain
      break
    }
    current.frontRunning = matched
    processed.push(current)
  }

  const out = new Map<string, number>()
  for (const row of processed) {
    if (row.frontRunning !== undefined) out.set(row.trade.id, row.frontRunning)
  }
  return out
}

/** @deprecated Prefer frontRunningById — kept for older tests / call sites. */
export function sandwichBotTradeIds(trades: Trade[]): Set<string> {
  return new Set(frontRunningById(trades).keys())
}

/**
 * Adds the per-wallet transaction count and the Bot / Team tags.
 * Bot (DEXTools front-running): same-maker opposite buy+sell in the same second,
 * or same token amount within 30s — see frontRunningById.
 * Team: token deployer or first liquidity adder.
 */
export function annotateTrades(
  trades: Trade[],
  _poolAddress: string,
  facts: WalletFacts,
  _options: AnnotateOptions = {},
): Trade[] {
  const counts = new Map<string, number>()
  let firstLiquidity: Trade | null = null
  for (const trade of trades) {
    const maker = normalizeAddress(trade.maker)
    if (maker) counts.set(maker, (counts.get(maker) ?? 0) + 1)
    if (trade.type === "ADD" && trade.maker) {
      if (
        !firstLiquidity ||
        trade.blockNumber < firstLiquidity.blockNumber ||
        (trade.blockNumber === firstLiquidity.blockNumber && trade.logIndex < firstLiquidity.logIndex)
      ) {
        firstLiquidity = trade
      }
    }
  }
  const teamWallets = new Set<string>()
  if (facts.deployer) teamWallets.add(normalizeAddress(facts.deployer))
  if (firstLiquidity) teamWallets.add(normalizeAddress(firstLiquidity.maker))

  const frontRunning = frontRunningById(trades)

  const tagged = trades.map((trade) => {
    const maker = normalizeAddress(trade.maker)
    const tags: MakerTag[] = []
    if (frontRunning.has(trade.id)) tags.push("bot")
    if (maker && teamWallets.has(maker)) tags.push("team")
    return { ...trade, makerTxCount: counts.get(maker) ?? 0, makerTags: tags }
  })
  return assignGasFeeTotals(assignTxNumbers(tagged))
}

/** Oldest loaded trade is 1; same-block ties break on log index. Numbers stay with the row when sorting. */
export function assignTxNumbers(trades: Trade[]): Trade[] {
  const ranked = [...trades].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex || a.id.localeCompare(b.id),
  )
  const numbers = new Map(ranked.map((trade, index) => [trade.id, index + 1]))
  return trades.map((trade) => ({ ...trade, txNo: numbers.get(trade.id) ?? 0 }))
}
