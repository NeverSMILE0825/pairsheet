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
import {
  formatUnits,
  marketCapFromPrice,
  mulDecimals,
  priceInQuote,
  priceUsdFromTotal,
  totalUsd,
} from "./format"
import { applyGasFees, fetchEthReceipts, parseReceiptGas, type ReceiptGas } from "./gas-fees"
import { AppError, fetchJson, mapPool, rpcBatch } from "./http"
import { parseDextoolsUrl } from "./parse-url"
import { resolvePool } from "./pool"
import { quotePricesAt } from "./prices"
import { loadPoolSizes } from "./reserves"
import type { PoolSize } from "./reserves"
import { getSolanaSwapPage } from "./solana"
import type { PoolContext, PoolView, RawLog, ServerCursor, SwapsResponse, Trade } from "./types"

const ROUTESCAN_PAGE = 1000
/** Etherscan-compatible getLogs only returns page*offset ≤ 10_000 rows per query window. */
const MAX_LOG_PAGE = 10

export type SwapPageOptions = {
  /** When false, skip receipt fetches used for Gas Price / Gas Fee Total (faster loads). Default true. */
  includeGas?: boolean
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

  if (parsed.chain.id === "solana") {
    return getSolanaSwapPage(parsed.chain, parsed.address, parsed.url, cursor)
  }

  const pool = cursor?.pool ?? (await resolvePool(parsed.chain, parsed.address, parsed.url))
  const topics = topicOrder(pool.dexId, pool.dex, pool.style)
  const topic = cursor?.topic ?? topics[0]
  const tried = new Set(cursor?.triedTopics ?? [topic])

  const chain = parsed.chain
  const page = await readPage(parsed.chain, pool, topic, cursor)
  let trades = await hydrate(parsed.chain, pool, page.logs, includeGas)
  let next = page.next
  let activeTopic = topic

  if (trades.length === 0 && !next && !cursor) {
    for (const alternate of topics) {
      if (tried.has(alternate)) continue
      tried.add(alternate)
      const retry = await readPage(parsed.chain, pool, alternate, null)
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
        toBlock: following.toBlock ?? null,
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
    toBlock?: number | null
    blockscoutParams: Record<string, string> | null
  } | null
}

async function readPage(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  cursor: ServerCursor | null,
): Promise<PageResult> {
  const source = cursor?.source ?? (chain.routescan ? "routescan" : "blockscout")
  const toBlock = cursor?.toBlock ?? null
  if (source === "routescan") {
    return readRoutescan(chain, pool, topic, cursor?.page ?? 1, toBlock)
  }
  if (!chain.blockscout) {
    throw new AppError(`No swap index is configured for ${chain.name}.`, 422)
  }
  // V4 needs topic1 (pool id). Prefer the Etherscan-compatible module which supports it.
  if (pool.topic1) {
    return readEtherscanLogs(chain.blockscout.replace(/\/$/, ""), pool, topic, cursor?.page ?? 1, toBlock)
  }
  return readBlockscout(chain.blockscout, pool.logAddress, topic, cursor?.blockscoutParams ?? null)
}

async function readRoutescan(
  chain: ChainConfig,
  pool: PoolContext,
  topic: string,
  page: number,
  toBlock: number | null = null,
): Promise<PageResult> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: pool.logAddress,
    fromBlock: "0",
    toBlock: toBlock && toBlock > 0 ? String(toBlock) : "latest",
    topic0: topic,
    page: String(page),
    offset: String(ROUTESCAN_PAGE),
  })
  if (pool.topic1) {
    params.set("topic1", pool.topic1)
    params.set("topic0_1_opr", "and")
  }
  const url = `https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`
  const body = (await fetchJson(url)) as { status?: string; message?: string; result?: unknown }
  if (!Array.isArray(body.result)) {
    const message = String(body.result || body.message || "no records")
    if (/no records|no logs|chain not supported|invalid/i.test(message)) {
      if (/chain not supported/i.test(message) && chain.blockscout) {
        if (pool.topic1) {
          return readEtherscanLogs(chain.blockscout.replace(/\/$/, ""), pool, topic, 1, toBlock)
        }
        return readBlockscout(chain.blockscout, pool.logAddress, topic, null)
      }
      return { logs: [], next: null }
    }
    throw new AppError(`The chain explorer could not return logs (${message}).`, 502)
  }
  const logs = body.result.map(routescanLog).filter((log): log is RawLog => log !== null)
  return { logs, next: nextLogPage("routescan", page, toBlock, logs) }
}

async function readEtherscanLogs(
  apiBase: string,
  pool: PoolContext,
  topic: string,
  page: number,
  toBlock: number | null = null,
): Promise<PageResult> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: pool.logAddress,
    fromBlock: "0",
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
    if (/no records|no logs|not found|invalid/i.test(message)) return { logs: [], next: null }
    throw new AppError(`The chain explorer could not return logs (${message}).`, 502)
  }
  const logs = body.result.map(routescanLog).filter((log): log is RawLog => log !== null)
  return { logs, next: nextLogPage("blockscout", page, toBlock, logs) }
}

function nextLogPage(
  source: "routescan" | "blockscout",
  page: number,
  toBlock: number | null,
  logs: RawLog[],
): PageResult["next"] {
  if (logs.length === 0) return null
  if (logs.length < ROUTESCAN_PAGE) return null
  // Hit the 10k result ceiling for this from/to window — slide toBlock down and restart pages.
  if (page >= MAX_LOG_PAGE) {
    const oldest = Math.min(...logs.map((log) => log.blockNumber).filter((block) => block > 0))
    if (!Number.isFinite(oldest) || oldest <= 1) return null
    return { source, page: 1, toBlock: oldest - 1, blockscoutParams: null }
  }
  return { source, page: page + 1, toBlock: toBlock ?? null, blockscoutParams: null }
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
        ? { ...swap, ...amountsFromV4Receipt(pool, swap.type, receipt.logs) }
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
  logs: { address?: string; topics?: string[]; data?: string }[]
}

async function loadReceipts(chain: ChainConfig, hashes: string[]): Promise<Map<string, LoadedReceipt>> {
  const receipts = new Map<string, LoadedReceipt>()
  if (hashes.length === 0 || chain.rpcs.length === 0) return receipts
  const raw = await fetchEthReceipts(chain.rpcs, hashes)
  for (const [hash, receipt] of raw) {
    if (!receipt || typeof receipt !== "object") continue
    const logs = (receipt as { logs?: { address?: string; topics?: string[]; data?: string }[] }).logs
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
