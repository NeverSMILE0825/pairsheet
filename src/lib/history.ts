import { decodeBase64Url, encodeBase64Url } from "./bytes"
import { chainCanExport, type ChainConfig } from "./chains"
import {
  amountsFromV4Receipt,
  decodeSwap,
  liquidityTopics,
  priceQuoteFromV4InitData,
  priceQuoteFromV4InitLogs,
  topicOrder,
} from "./decode"
import { amountsFromV4LiquidityMath } from "./v4-liquidity"
import {
  formatUnits,
  marketCapFromPrice,
  mulDecimals,
  priceInQuote,
  priceUsdFromTotal,
  totalUsd,
} from "./format"
import { applyGasFees, fetchEthReceipts, parseReceiptGas, type ReceiptGas } from "./gas-fees"
import { AppError, fetchJson, mapPool, rpcBatch, rpcCall, sleep } from "./http"
import { parseDextoolsUrl } from "./parse-url"
import { resolvePool } from "./pool"
import { quotePricesAt } from "./prices"
import { loadPoolSizes } from "./reserves"
import type { PoolSize } from "./reserves"
import { getSolanaSwapPage } from "./solana"
import type { PoolContext, PoolView, RawLog, ServerCursor, SwapsResponse, Trade } from "./types"

export const ROUTESCAN_PAGE = 1000
/** Etherscan-compatible getLogs only returns page*offset ≤ 10_000 rows per query window. */
export const MAX_LOG_PAGE = 10

export type SwapPageOptions = {
  /** When false, skip receipt fetches used for Gas Price / Gas Fee Total (faster loads). Default true. */
  includeGas?: boolean
  /**
   * Live tail. Only logs at or after this block are returned, and later topics
   * keep the same floor so a saved tape can catch up without rereading history.
   */
  sinceBlock?: number | null
}

export function positiveSinceBlock(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const block = Math.floor(value)
  return block > 0 ? block : null
}

/** Newest loaded block, inclusive start for a live tail (same-block rows are deduped). */
export function newestTradeBlock(trades: { blockNumber: number }[]): number | null {
  let newest = 0
  for (const trade of trades) {
    if (trade.blockNumber > newest) newest = trade.blockNumber
  }
  return newest > 0 ? newest : null
}

/** Append trades whose ids are not already on the tape. Same array when nothing is new. */
export function mergeNewTrades(existing: Trade[], incoming: Trade[]): Trade[] {
  if (incoming.length === 0) return existing
  const seen = new Set(existing.map((trade) => trade.id))
  const extra: Trade[] = []
  for (const trade of incoming) {
    if (!trade.id || seen.has(trade.id)) continue
    seen.add(trade.id)
    extra.push(trade)
  }
  if (extra.length === 0) return existing
  return [...existing, ...extra]
}

export async function getSwapPage(
  rawUrl: string,
  cursorText: string | null,
  options: SwapPageOptions = {},
): Promise<SwapsResponse> {
  const includeGas = options.includeGas !== false
  let parsed: ReturnType<typeof parseDextoolsUrl>
  try {
    parsed = parseDextoolsUrl(rawUrl)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Invalid DEXTools URL.", 400)
  }
  if (!chainCanExport(parsed.chain)) {
    throw new AppError(
      `${parsed.chain.name} does not have a public swap index this app can read yet. Full history works on Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, Blast, zkSync, Celo, Unichain, World Chain, Metis, Chiliz, and Solana.`,
      422,
    )
  }

  const cursor = cursorText ? decodeCursor(cursorText) : null
  if (cursor && cursor.pool.address !== parsed.address) {
    throw new AppError("The continuation token does not match this pair.", 400)
  }
  const sinceBlock = positiveSinceBlock(cursor?.sinceBlock ?? options.sinceBlock)

  if (parsed.chain.id === "solana") {
    return getSolanaSwapPage(parsed.chain, parsed.address, parsed.url, cursor, sinceBlock)
  }

  const pool = cursor?.pool ?? (await resolvePool(parsed.chain, parsed.address, parsed.url))
  const topics = topicOrder(pool.dexId, pool.dex, pool.style)
  const topic = cursor?.topic ?? topics[0]
  const tried = new Set(cursor?.triedTopics ?? [topic])

  const chain = parsed.chain
  const page = await readPage(parsed.chain, pool, topic, cursor, sinceBlock)
  const clipped = clipLogsToSince(page.logs, page.next, sinceBlock)
  let trades = await hydrate(parsed.chain, pool, clipped.logs, includeGas)
  let next = clipped.next
  let activeTopic = topic

  if (trades.length === 0 && !next && !cursor) {
    for (const alternate of topics) {
      if (tried.has(alternate)) continue
      tried.add(alternate)
      const retryPage = await readPage(parsed.chain, pool, alternate, null, sinceBlock)
      const retry = clipLogsToSince(retryPage.logs, retryPage.next, sinceBlock)
      if (retry.logs.length > 0 || retry.next) {
        trades = await hydrate(parsed.chain, pool, retry.logs, includeGas)
        next = retry.next
        activeTopic = alternate
        break
      }
    }
  }

  const queue = cursor ? (cursor.queue ?? []) : liquidityTopics(activeTopic)
  let following = next
  let followingTopic = activeTopic
  let remaining = queue
  if (!following && queue.length > 0) {
    followingTopic = queue[0]
    remaining = queue.slice(1)
    following = {
      source: chain.routescan ? ("routescan" as const) : ("blockscout" as const),
      page: 1,
      fromBlock: sinceBlock,
      toBlock: null,
      blockscoutParams: null,
    }
  }

  const nextCursor = following
    ? encodeCursor({
        source: following.source,
        topic: followingTopic,
        triedTopics: [...tried],
        queue: remaining,
        page: following.page,
        fromBlock: following.fromBlock ?? null,
        toBlock: following.toBlock ?? null,
        sinceBlock,
        blockscoutParams: following.blockscoutParams,
        pool,
      })
    : null

  const missingMakers = trades.some((trade) => !trade.maker)
  const missingUsd = trades.length > 0 && trades.every((trade) => !trade.totalUsd)
  const warning = missingMakers
    ? "Some wallet addresses could not be resolved."
    : missingUsd
      ? "Historical USD prices were unavailable, so price and total are blank. Token amounts are still exact."
      : null

  return {
    pool: toView(pool),
    trades,
    nextCursor,
    warning,
  }
}

function toView(pool: PoolContext): PoolView {
  return {
    chainId: pool.chainId,
    chainName: pool.chainName,
    address: pool.address,
    dex: pool.dex,
    baseSymbol: pool.base.symbol,
    quoteSymbol: pool.quote.symbol,
    baseAddress: pool.base.address,
    quoteAddress: pool.quote.address,
    createdAt: pool.createdAt,
    priceUsd: pool.priceUsd,
    reserveUsd: pool.reserveUsd,
    baseTotalSupply: pool.baseTotalSupply,
    dextoolsUrl: pool.dextoolsUrl,
    explorerTx: pool.explorerTx,
    explorerAddress: pool.explorerAddress,
  }
}

type PageResult = {
  logs: RawLog[]
  next: {
    source: "routescan" | "blockscout"
    page: number
    fromBlock?: number | null
    toBlock?: number | null
    blockscoutParams: Record<string, string> | null
  } | null
}

function clipLogsToSince(
  logs: RawLog[],
  next: PageResult["next"],
  sinceBlock: number | null,
): { logs: RawLog[]; next: PageResult["next"] } {
  if (!sinceBlock) return { logs, next }
  const older = logs.some((log) => log.blockNumber > 0 && log.blockNumber < sinceBlock)
  const kept = logs.filter((log) => log.blockNumber >= sinceBlock)
  // Blockscout pages are newest-first. Once a page crosses the floor, stop
  // instead of walking the rest of the pair's history.
  return { logs: kept, next: older ? null : next }
}

async function readPage(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  cursor: ServerCursor | null,
  sinceBlock: number | null = null,
): Promise<PageResult> {
  const source = cursor?.source ?? (chain.routescan ? "routescan" : "blockscout")
  const fromBlock = positiveSinceBlock(cursor?.fromBlock) ?? sinceBlock
  const toBlock = cursor?.toBlock ?? null
  // Chain nodes return the whole range in one eth_getLogs. Routescan pages of
  // 1,000 (and HTTP 429) were stopping V4 tapes short of the DEXTools count.
  if (chain.rpcs.length > 0 && !cursor?.blockscoutParams) {
    try {
      const logs = await readRpcLogs(chain, pool.logAddress, topic, pool.topic1, fromBlock, toBlock, pool.createdAt)
      return { logs, next: null }
    } catch {
      // Fall through to the explorer when every node rejects the range.
    }
  }
  if (source === "routescan") {
    return readRoutescan(chain, pool, topic, cursor?.page ?? 1, fromBlock, toBlock)
  }
  if (!chain.blockscout) {
    throw new AppError(`No swap index is configured for ${chain.name}.`, 422)
  }
  // V4 needs topic1 (pool id). Prefer the Etherscan-compatible module which supports it.
  if (pool.topic1) {
    return readEtherscanLogs(
      chain.blockscout.replace(/\/$/, ""),
      pool,
      topic,
      cursor?.page ?? 1,
      fromBlock,
      toBlock,
    )
  }
  return readBlockscout(chain.blockscout, pool.logAddress, topic, cursor?.blockscoutParams ?? null)
}

/** Exact page sizes nodes use when they silently truncate eth_getLogs. */
const RPC_LOG_CAPS = new Set([1000, 2000, 5000, 10000])

function looksCapped(count: number): boolean {
  return RPC_LOG_CAPS.has(count)
}

/** Blocks of padding before a pool's indexed creation time (~12s blocks). */
const CREATION_PAD_BLOCKS = 30_000

/**
 * Block to start a full read when the caller has no fromBlock.
 * Uses the pool's creation time so we do not scan back to genesis.
 * Unknown age starts about 55 days back; the caller extends if logs touch that edge.
 */
export function estimatedStartBlock(createdAt: string | null, tip: number, now = Date.now()): number {
  if (tip <= 0) return 0
  const fallback = Math.max(0, tip - 400_000)
  if (!createdAt) return fallback
  const createdMs = Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) return fallback
  const seconds = Math.max(0, Math.floor((now - createdMs) / 1000))
  return Math.max(0, tip - Math.ceil(seconds / 12) - CREATION_PAD_BLOCKS)
}

/** True when the oldest log sits on the start of the window, so older history may exist. */
export function floorLooksClipped(minBlock: number, floor: number, tip: number): boolean {
  if (floor <= 0 || minBlock <= 0 || minBlock > tip) return false
  const span = Math.max(1, tip - floor)
  return minBlock <= floor + Math.max(64, Math.floor(span * 0.02))
}

export async function readRpcLogs(
  chain: ChainConfig,
  address: string,
  topic0: string,
  topic1: string | null,
  fromBlock: number | null,
  toBlock: number | null,
  createdAt: string | null = null,
): Promise<RawLog[]> {
  if (chain.rpcs.length === 0) throw new AppError("No chain RPC is configured.", 422)
  const tip = toBlock && toBlock > 0 ? toBlock : await tipBlock(chain)
  if (tip <= 0) throw new AppError("The chain did not report a block height.", 502)
  let floor = fromBlock && fromBlock > 0 ? fromBlock : estimatedStartBlock(createdAt, tip)
  if (floor > tip) floor = tip
  const lockedFloor = fromBlock != null && fromBlock > 0
  const preferred = { rpc: null as string | null }

  let logs = await logsInRange(chain, address, topic0, topic1, floor, tip, 0, preferred)
  if (!lockedFloor) {
    for (let extend = 0; extend < 8 && floor > 0; extend += 1) {
      const minBlock = logs.reduce((min, log) => (log.blockNumber > 0 && log.blockNumber < min ? log.blockNumber : min), Number.POSITIVE_INFINITY)
      if (!floorLooksClipped(minBlock, floor, tip)) break
      const span = Math.max(CREATION_PAD_BLOCKS, tip - floor)
      const nextFloor = Math.max(0, floor - span)
      if (nextFloor >= floor) break
      const older = await logsInRange(chain, address, topic0, topic1, nextFloor, floor - 1, 0, preferred)
      logs = dedupeLogs([...older, ...logs])
      floor = nextFloor
    }
  }
  // An empty full-history read is not proof the pair has no swaps (the start
  // block can sit after the pool). Let the explorer walk from block 0.
  if (!lockedFloor && logs.length === 0) {
    throw new AppError("Chain node returned no logs for this range.", 502)
  }
  return fillTimestamps(chain, logs)
}

async function logsInRange(
  chain: ChainConfig,
  address: string,
  topic0: string,
  topic1: string | null,
  fromBlock: number,
  toBlock: number,
  depth: number,
  preferred: { rpc: string | null },
): Promise<RawLog[]> {
  if (fromBlock > toBlock) return []
  try {
    const batch = await ethGetLogs(chain, address, topic0, topic1, fromBlock, toBlock, preferred)
    if (looksCapped(batch.length) && toBlock > fromBlock && depth < 24) {
      const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2)
      try {
        const left = await logsInRange(chain, address, topic0, topic1, fromBlock, mid, depth + 1, preferred)
        const right = await logsInRange(chain, address, topic0, topic1, mid + 1, toBlock, depth + 1, preferred)
        return dedupeLogs([...left, ...right])
      } catch (error) {
        // A page larger than the known caps is already complete. An exact cap is not.
        if (batch.length > 1000) return batch
        throw error
      }
    }
    return batch
  } catch (error) {
    if (toBlock > fromBlock && depth < 24 && isSplitError(error)) {
      const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2)
      const left = await logsInRange(chain, address, topic0, topic1, fromBlock, mid, depth + 1, preferred)
      const right = await logsInRange(chain, address, topic0, topic1, mid + 1, toBlock, depth + 1, preferred)
      return dedupeLogs([...left, ...right])
    }
    throw error
  }
}

/** Range is too wide or too old for this node. Rate limits are retried, not split. */
function isSplitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/429|rate limit|too many requests|timeout|timed out|502|503|504|upstream responded/i.test(message)) return false
  return /range|too many|more than|exceed|query returned|block range|response size|archive/i.test(message)
}

async function ethGetLogs(
  chain: ChainConfig,
  address: string,
  topic0: string,
  topic1: string | null,
  fromBlock: number,
  toBlock: number,
  preferred: { rpc: string | null },
): Promise<RawLog[]> {
  const filter = {
    address,
    topics: topic1 ? [topic0, topic1] : [topic0],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: `0x${toBlock.toString(16)}`,
  }
  let last: Error | null = null
  const rpcs = preferred.rpc
    ? [preferred.rpc, ...chain.rpcs.filter((rpc) => rpc !== preferred.rpc)]
    : chain.rpcs
  for (let round = 0; round < 3; round += 1) {
    let split: Error | null = null
    let retry = false
    for (const rpc of rpcs) {
      try {
        const response = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [filter] }),
          signal: AbortSignal.timeout(30000),
          cache: "no-store",
        })
        if (response.status === 429 || response.status >= 500) {
          last = new Error(`Upstream responded ${response.status}`)
          retry = true
          continue
        }
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
        if (body.error) {
          const reason = new Error(body.error.message || "eth_getLogs failed")
          if (isSplitError(reason)) split = reason
          else {
            last = reason
            retry = true
          }
          continue
        }
        if (!Array.isArray(body.result)) throw new Error("eth_getLogs returned no logs")
        preferred.rpc = rpc
        return body.result.map(routescanLog).filter((log): log is RawLog => log !== null)
      } catch (error) {
        last = error instanceof Error ? error : new Error("eth_getLogs failed")
        if (isSplitError(last)) split = last
        else retry = true
      }
    }
    // Every node rejected the range itself. Splitting can help; retrying will not.
    if (split && !retry) throw split
    last = last ?? split
    await sleep(800 * (round + 1))
  }
  throw new AppError(last?.message || "The chain node could not return logs.", 502)
}

function dedupeLogs(logs: RawLog[]): RawLog[] {
  const seen = new Set<string>()
  const out: RawLog[] = []
  for (const log of logs) {
    const id = `${log.txHash}-${log.logIndex}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(log)
  }
  return out
}

async function fillTimestamps(chain: ChainConfig, logs: RawLog[]): Promise<RawLog[]> {
  const missing = [...new Set(logs.filter((log) => !log.timestamp && log.blockNumber > 0).map((log) => log.blockNumber))]
  if (missing.length === 0 || chain.rpcs.length === 0) return logs
  const stamps = new Map<number, number>()
  for (let index = 0; index < missing.length; index += 20) {
    const batch = missing.slice(index, index + 20)
    for (const rpc of chain.rpcs) {
      try {
        const results = await rpcBatch(
          rpc,
          batch.map((block) => ({ method: "eth_getBlockByNumber", params: [`0x${block.toString(16)}`, false] })),
        )
        results.forEach((result, id) => {
          const stamp = (result as { timestamp?: string } | null)?.timestamp
          const block = batch[id]
          if (typeof stamp !== "string" || block == null) return
          const seconds = Number.parseInt(stamp, 16)
          if (seconds > 0) stamps.set(block, seconds)
        })
        if (batch.every((block) => stamps.has(block))) break
      } catch {
        continue
      }
    }
  }
  if (stamps.size === 0) return logs
  return logs.map((log) => (log.timestamp ? log : { ...log, timestamp: stamps.get(log.blockNumber) ?? 0 }))
}

async function tipBlock(chain: ChainConfig): Promise<number> {
  if (chain.rpcs.length === 0) return 0
  try {
    const raw = await rpcCall(chain.rpcs, "eth_blockNumber", [])
    if (typeof raw !== "string") return 0
    const block = Number.parseInt(raw, 16)
    return Number.isFinite(block) && block > 0 ? block : 0
  } catch {
    return 0
  }
}

type LogAttempt = { kind: "logs" | "empty"; logs: RawLog[] } | { kind: "error"; message: string }

async function attemptRoutescan(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  page: number,
  fromBlock: number | null,
  toBlock: string,
): Promise<LogAttempt> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: pool.logAddress,
    fromBlock: fromBlock && fromBlock > 0 ? String(fromBlock) : "0",
    toBlock,
    topic0: topic,
    page: String(page),
    offset: String(ROUTESCAN_PAGE),
  })
  if (pool.topic1) {
    params.set("topic1", pool.topic1)
    params.set("topic0_1_opr", "and")
  }
  const url = `https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`
  try {
    const body = (await fetchJson(url)) as { status?: string; message?: string; result?: unknown }
    if (Array.isArray(body.result)) {
      return { kind: "logs", logs: body.result.map(routescanLog).filter((log): log is RawLog => log !== null) }
    }
    const message = String(body.result || body.message || "no records")
    if (/no records|no logs|invalid|result window is too large/i.test(message)) {
      return { kind: "empty", logs: [] }
    }
    return { kind: "error", message }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : "request failed" }
  }
}

/**
 * Routescan often answers "An error occurred" for a wide window (and always
 * on page 3 of a 1,000-row offset). Retry the tip as "latest", then cut the
 * block span in half until a query succeeds. `walkTo` is the real tip so a
 * short slice is followed by the next slice instead of ending the tape.
 */
async function readRoutescan(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  page: number,
  fromBlock: number | null = null,
  toBlock: number | null = null,
): Promise<PageResult> {
  const walkTo = toBlock && toBlock > 0 ? toBlock : await tipBlock(chain)
  return readRoutescanSpan(chain, pool, topic, page, fromBlock, walkTo, walkTo, 0)
}

async function readRoutescanSpan(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  page: number,
  fromBlock: number | null,
  queryTo: number,
  walkTo: number,
  depth: number,
): Promise<PageResult> {
  const floor = fromBlock && fromBlock > 0 ? fromBlock : 0
  const capped = queryTo > 0 ? queryTo : walkTo
  if (capped > 0 && floor > capped) {
    return {
      logs: [],
      next: continueAfterWindow("routescan", page, fromBlock, capped, walkTo > 0 ? walkTo : null, []),
    }
  }

  const targets = capped > 0 ? [String(capped)] : ["latest"]
  if (depth === 0 && capped > 0 && capped === walkTo) targets.push("latest")

  let failure = "An error occurred"
  for (const target of targets) {
    let attempt = await attemptRoutescan(chain, pool, topic, page, fromBlock, target)
    if (attempt.kind === "error") attempt = await attemptRoutescan(chain, pool, topic, page, fromBlock, target)
    if (attempt.kind === "error") {
      failure = attempt.message
      continue
    }
    return {
      logs: attempt.logs,
      next: continueAfterWindow(
        "routescan",
        page,
        fromBlock,
        capped > 0 ? capped : null,
        walkTo > 0 ? walkTo : null,
        attempt.logs,
      ),
    }
  }

  const span = capped - floor
  if (span > 128 && depth < 24 && capped > floor) {
    const mid = floor + Math.max(1, Math.floor(span / 2))
    if (mid < capped) {
      return readRoutescanSpan(chain, pool, topic, 1, floor > 0 ? floor : null, mid, walkTo, depth + 1)
    }
  }

  if (depth === 0 && chain.blockscout) {
    try {
      const alt = await readEtherscanLogs(chain.blockscout.replace(/\/$/, ""), pool, topic, page, fromBlock, capped > 0 ? capped : null)
      return {
        logs: alt.logs,
        next: continueAfterWindow("blockscout", page, fromBlock, capped > 0 ? capped : null, walkTo > 0 ? walkTo : null, alt.logs),
      }
    } catch {
      // Fall through to the same error the first explorer reported.
    }
  }

  throw new AppError(`The chain explorer could not return logs (${failure}).`, 502)
}

async function readEtherscanLogs(
  apiBase: string,
  pool: PoolContext,
  topic: string,
  page: number,
  fromBlock: number | null = null,
  toBlock: number | null = null,
): Promise<PageResult> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: pool.logAddress,
    fromBlock: fromBlock && fromBlock > 0 ? String(fromBlock) : "0",
    toBlock: toBlock && toBlock > 0 ? String(toBlock) : "latest",
    topic0: topic,
    page: String(page),
    offset: String(ROUTESCAN_PAGE),
  })
  if (pool.topic1) {
    params.set("topic1", pool.topic1)
    params.set("topic0_1_opr", "and")
  }
  const url = `${apiBase}/api?${params}`
  const body = (await fetchJson(url)) as { status?: string; message?: string; result?: unknown }
  if (!Array.isArray(body.result)) {
    const message = String(body.result || body.message || "no records")
    if (/no records|no logs|not found|invalid|result window is too large/i.test(message)) {
      return { logs: [], next: null }
    }
    throw new AppError(`The chain explorer could not return logs (${message}).`, 502)
  }
  const logs = body.result.map(routescanLog).filter((log): log is RawLog => log !== null)
  return { logs, next: nextLogPage("blockscout", page, fromBlock, toBlock, logs) }
}

/**
 * Advance pagination for Etherscan-compatible getLogs.
 * Those APIs are oldest-first. Routescan answers "An error occurred" once a
 * 1,000-row window reaches page 3 (about 2,000 logs), so a full page moves
 * fromBlock to the newest block and starts again at page 1. Same-block
 * leftovers are included again; callers dedupe by log id. A page that never
 * leaves its current block keeps paging until the 10k ceiling.
 */
export function nextLogPage(
  source: "routescan" | "blockscout",
  page: number,
  fromBlock: number | null,
  toBlock: number | null,
  logs: RawLog[],
): PageResult["next"] {
  if (logs.length === 0) return null
  if (logs.length < ROUTESCAN_PAGE) return null
  const newest = Math.max(...logs.map((log) => log.blockNumber).filter((block) => block > 0))
  const floor = fromBlock ?? 0
  if (Number.isFinite(newest) && newest > floor) {
    return {
      source,
      page: 1,
      fromBlock: newest,
      toBlock: toBlock ?? null,
      blockscoutParams: null,
    }
  }
  if (page < MAX_LOG_PAGE) {
    return {
      source,
      page: page + 1,
      fromBlock: fromBlock ?? null,
      toBlock: toBlock ?? null,
      blockscoutParams: null,
    }
  }
  return null
}

/**
 * After a bounded slice, keep reading until `walkTo`. A short or empty slice
 * that ends before the tip continues at the next block instead of stopping.
 */
export function continueAfterWindow(
  source: "routescan" | "blockscout",
  page: number,
  fromBlock: number | null,
  queryTo: number | null,
  walkTo: number | null,
  logs: RawLog[],
): PageResult["next"] {
  const next = nextLogPage(source, page, fromBlock, queryTo, logs)
  if (next) return next
  if (queryTo != null && walkTo != null && queryTo < walkTo) {
    return {
      source,
      page: 1,
      fromBlock: queryTo + 1,
      toBlock: walkTo,
      blockscoutParams: null,
    }
  }
  return null
}

function routescanLog(row: unknown): RawLog | null {
  if (!row || typeof row !== "object") return null
  const log = row as Record<string, unknown>
  if (typeof log.data !== "string" || typeof log.transactionHash !== "string") return null
  const topics = Array.isArray(log.topics) ? log.topics.filter((topic): topic is string => typeof topic === "string") : []
  return {
    data: log.data,
    topics,
    blockNumber: hexNumber(log.blockNumber),
    timestamp: hexNumber(log.timeStamp),
    txHash: log.transactionHash.toLowerCase(),
    logIndex: hexNumber(log.logIndex),
  }
}

function hexNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value !== "string") return 0
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10)
}

async function readBlockscout(
  host: string,
  address: string,
  topic: string,
  params: Record<string, string> | null,
): Promise<PageResult> {
  const query = new URLSearchParams(params ?? { topic })
  const url = `${host}/api/v2/addresses/${address}/logs?${query}`
  const body = (await fetchJson(url)) as {
    items?: Record<string, unknown>[]
    next_page_params?: Record<string, string | number | null> | null
  }
  const logs = (body.items ?? [])
    .map((item) => blockscoutLog(item, topic))
    .filter((log): log is RawLog => log !== null)
  const nextParams = body.next_page_params
  const next = nextParams
    ? {
        source: "blockscout" as const,
        page: 0,
        blockscoutParams: Object.fromEntries(
          Object.entries(nextParams)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => [key, String(value)]),
        ),
      }
    : null
  return { logs, next }
}

function blockscoutLog(item: Record<string, unknown>, topic: string): RawLog | null {
  const topics = Array.isArray(item.topics)
    ? item.topics.filter((value): value is string => typeof value === "string")
    : []
  if (topics[0] && topics[0].toLowerCase() !== topic.toLowerCase()) return null
  if (typeof item.data !== "string" || typeof item.transaction_hash !== "string") return null
  const timestamp = typeof item.block_timestamp === "string" ? Date.parse(item.block_timestamp) : 0
  return {
    data: item.data,
    topics,
    blockNumber: Number(item.block_number) || 0,
    timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0,
    txHash: item.transaction_hash.toLowerCase(),
    logIndex: Number(item.index) || 0,
  }
}

type DecodedAmounts = { type: Trade["type"]; baseRaw: bigint; quoteRaw: bigint }

/**
 * Price / total for INIT and ADD/REMOVE.
 * DEXTools: INIT shows unit price from sqrtPrice (Total —); one-sided V4 ADD
 * (native ETH has no ERC-20 Transfer) values Total as base × that init price.
 */
function valueLiquidityTrade(
  pool: PoolContext,
  filled: DecodedAmounts,
  log: RawLog,
  receiptLogs: { topics?: string[]; data?: string }[] | null,
  baseAmount: string,
  quotePrice: number | null,
): { priceQuote: string | null; priceUsd: string | null; totalUsd: string | null } {
  if (filled.type === "INIT") {
    const priceQuote = priceQuoteFromV4InitData(log.data, pool)
    const priceUsd =
      priceQuote && quotePrice != null ? mulDecimals(priceQuote, quotePriceToString(quotePrice)) : null
    return { priceQuote, priceUsd, totalUsd: null }
  }

  if (filled.type === "ADD" || filled.type === "REMOVE") {
    const bothSides = filled.baseRaw > 0n && filled.quoteRaw > 0n
    const initPriceQuote =
      !bothSides && receiptLogs ? priceQuoteFromV4InitLogs(pool, receiptLogs) : null
    let total: string | null = null
    if (quotePrice != null) {
      if (filled.quoteRaw > 0n) {
        total = totalUsd(filled.quoteRaw, pool.quote.decimals, quotePrice)
      } else if (filled.baseRaw > 0n && initPriceQuote) {
        const unitUsd = mulDecimals(initPriceQuote, quotePriceToString(quotePrice))
        total = unitUsd ? mulDecimals(baseAmount, unitUsd) : null
      }
    }
    if (total === "0" && filled.baseRaw === 0n && filled.quoteRaw === 0n) total = null
    return {
      priceQuote: bothSides
        ? priceInQuote(filled.quoteRaw, pool.quote.decimals, filled.baseRaw, pool.base.decimals)
        : null,
      priceUsd: bothSides && total ? priceUsdFromTotal(total, baseAmount) : null,
      totalUsd: total,
    }
  }

  const priceQuote = priceInQuote(
    filled.quoteRaw,
    pool.quote.decimals,
    filled.baseRaw,
    pool.base.decimals,
  )
  const oneSided = filled.baseRaw === 0n || filled.quoteRaw === 0n
  const total =
    quotePrice === null ? null : totalUsd(filled.quoteRaw, pool.quote.decimals, quotePrice)
  const priceUsd = total && !oneSided ? priceUsdFromTotal(total, baseAmount) : null
  return {
    priceQuote: oneSided ? null : priceQuote,
    priceUsd,
    totalUsd: total,
  }
}

function quotePriceToString(price: number): string {
  if (!Number.isFinite(price) || price < 0) return "0"
  return price.toFixed(18).replace(/\.?0+$/, "") || "0"
}

async function hydrate(
  chain: ChainConfig,
  pool: PoolContext,
  logs: RawLog[],
  includeGas = true,
): Promise<Trade[]> {
  const decoded = logs.flatMap((log) => {
    const swap = decodeSwap(log, pool)
    if (!swap) return []
    return [{ log, swap }]
  })
  if (decoded.length === 0) return []

  // Receipts feed gas columns and V4 ADD/REMOVE token amounts.
  const receiptHashes = includeGas
    ? [...new Set(decoded.map((row) => row.log.txHash.toLowerCase()))]
    : [
        ...new Set(
          decoded
            .filter((row) => row.swap.type === "ADD" || row.swap.type === "REMOVE")
            .map((row) => row.log.txHash.toLowerCase()),
        ),
      ]

  const [makers, prices, sizes, receipts] = await Promise.all([
    resolveMakers(
      chain,
      decoded.map((row) => row.log.txHash),
    ),
    quotePricesAt(
      chain.llama,
      pool.quote.address,
      pool.quote.symbol,
      decoded.map((row) => row.log.timestamp),
      chain.wrappedNative,
    ),
    loadPoolSizes(
      chain,
      pool,
      decoded.map((row) => row.log),
    ).catch(() => new Map<string, PoolSize>()),
    receiptHashes.length > 0
      ? loadReceipts(chain, receiptHashes)
      : Promise.resolve(new Map<string, LoadedReceipt>()),
  ])

  const gasByTx = new Map<string, ReceiptGas>()
  if (includeGas) {
    for (const [hash, receipt] of receipts) {
      const gas = parseReceiptGas(receipt.raw)
      if (gas) gasByTx.set(hash, gas)
    }
  }

  const trades = decoded.map(({ log, swap }) => {
    const receipt = receipts.get(log.txHash.toLowerCase())
    const filled =
      pool.style === "v4" && (swap.type === "ADD" || swap.type === "REMOVE") && receipt?.logs
        ? {
            ...swap,
            ...(amountsFromV4LiquidityMath(pool, log.data, log.logIndex, receipt.logs) ??
              amountsFromV4Receipt(pool, swap.type, receipt.logs)),
          }
        : swap
    const quotePrice = prices.get(log.timestamp) ?? null
    const size = sizes.get(`${log.txHash.toLowerCase()}-${log.logIndex}`)
    const baseAmount = formatUnits(filled.baseRaw, pool.base.decimals)
    const quoteAmount = formatUnits(filled.quoteRaw, pool.quote.decimals)
    const valued = valueLiquidityTrade(pool, filled, log, receipt?.logs ?? null, baseAmount, quotePrice)
    const trade: Trade = {
      id: `${log.txHash}-${log.logIndex}`,
      txNo: 0,
      timestamp: new Date(log.timestamp * 1000).toISOString(),
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      type: filled.type,
      priceQuote: valued.priceQuote,
      baseAmount,
      quoteAmount,
      baseReserve: size?.base ?? null,
      quoteReserve: size?.quote ?? null,
      holders: null,
      totalUsd: valued.totalUsd,
      priceUsd: valued.priceUsd,
      marketCapUsd: marketCapFromPrice(valued.priceUsd, pool.baseTotalSupply),
      maker: makers.get(log.txHash.toLowerCase())?.from ?? "",
      router: makers.get(log.txHash.toLowerCase())?.to ?? "",
      makerTxCount: 0,
      makerTags: [],
      txHash: log.txHash,
      fundedBy: null,
      fundedByAddress: null,
      gasPriceGwei: null,
      gasFeeWei: null,
      gasFeeTotalEth: null,
    }
    return trade
  })

  trades.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber
    return b.logIndex - a.logIndex
  })
  return applyGasFees(trades, gasByTx)
}

type LoadedReceipt = {
  raw: unknown
  logs: { address?: string; topics?: string[]; data?: string; logIndex?: number | string }[]
}

async function loadReceipts(chain: ChainConfig, hashes: string[]): Promise<Map<string, LoadedReceipt>> {
  const receipts = new Map<string, LoadedReceipt>()
  if (hashes.length === 0 || chain.rpcs.length === 0) return receipts
  const raw = await fetchEthReceipts(chain.rpcs, hashes)
  for (const [hash, receipt] of raw) {
    if (!receipt || typeof receipt !== "object") continue
    const logs = (
      receipt as { logs?: { address?: string; topics?: string[]; data?: string; logIndex?: number | string }[] }
    ).logs
    receipts.set(hash, { raw: receipt, logs: Array.isArray(logs) ? logs : [] })
  }
  return receipts
}

type TxParties = { from: string; to: string }

async function resolveMakers(chain: ChainConfig, hashes: string[]): Promise<Map<string, TxParties>> {
  const unique = [...new Set(hashes.map((hash) => hash.toLowerCase()))]
  const makers = new Map<string, TxParties>()
  if (chain.rpcs.length > 0) {
    await fillFromRpc(chain.rpcs, unique, makers)
  }
  const missing = unique.filter((hash) => !makers.has(hash))
  if (missing.length > 0 && chain.blockscout) {
    await fillFromBlockscout(chain.blockscout, missing, makers)
  }
  return makers
}

async function fillFromRpc(rpcs: string[], hashes: string[], makers: Map<string, TxParties>) {
  const size = 40
  const batches: string[][] = []
  for (let index = 0; index < hashes.length; index += size) {
    batches.push(hashes.slice(index, index + size))
  }
  await mapPool(batches, 6, async (batch) => {
    for (const rpc of rpcs) {
      try {
        const results = await rpcBatch(
          rpc,
          batch.map((hash) => ({ method: "eth_getTransactionByHash", params: [hash] })),
        )
        results.forEach((result, id) => {
          const tx = result as { from?: string; to?: string | null } | undefined
          if (tx?.from && batch[id]) makers.set(batch[id], { from: tx.from.toLowerCase(), to: (tx.to ?? "").toLowerCase() })
        })
        if (batch.every((hash) => makers.has(hash))) return
      } catch {
        continue
      }
    }
  })
}

async function fillFromBlockscout(host: string, hashes: string[], makers: Map<string, TxParties>) {
  await mapPool(hashes, 6, async (hash) => {
    try {
      const body = (await fetchJson(`${host}/api/v2/transactions/${hash}`)) as {
        from?: { hash?: string } | string
        to?: { hash?: string } | string | null
      }
      const from = typeof body.from === "string" ? body.from : body.from?.hash
      const to = typeof body.to === "string" ? body.to : body.to?.hash
      if (from) makers.set(hash, { from: from.toLowerCase(), to: (to ?? "").toLowerCase() })
    } catch {
      return
    }
  })
}

function encodeCursor(cursor: ServerCursor): string {
  return encodeBase64Url(JSON.stringify(cursor))
}

function decodeCursor(value: string): ServerCursor {
  try {
    const parsed = JSON.parse(decodeBase64Url(value)) as ServerCursor
    if (!parsed?.pool?.address || !parsed.source) {
      throw new Error("incomplete")
    }
    if (parsed.source !== "solana" && !parsed.topic) {
      throw new Error("incomplete")
    }
    return parsed
  } catch {
    throw new AppError("That export session expired. Load the pair again.", 400)
  }
}
