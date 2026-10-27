import { decodeBase64Url, encodeBase64Url } from "./bytes"
import { chainCanExport, type ChainConfig } from "./chains"
import { decodeSwap, liquidityTopics, topicOrder } from "./decode"
import { formatUnits, priceInQuote, priceUsdFromTotal, totalUsd } from "./format"
import { AppError, fetchJson, mapPool, rpcBatch } from "./http"
import { parseDextoolsUrl } from "./parse-url"
import { resolvePool } from "./pool"
import { quotePricesAt } from "./prices"
import { loadPoolSizes } from "./reserves"
import type { PoolSize } from "./reserves"
import type { PoolContext, PoolView, RawLog, SwapsResponse, Trade } from "./types"

const ROUTESCAN_PAGE = 1000

type ServerCursor = {
  source: "routescan" | "blockscout"
  topic: string
  triedTopics: string[]
  queue: string[]
  page: number
  blockscoutParams: Record<string, string> | null
  pool: PoolContext
}

export async function getSwapPage(rawUrl: string, cursorText: string | null): Promise<SwapsResponse> {
  let parsed: ReturnType<typeof parseDextoolsUrl>
  try {
    parsed = parseDextoolsUrl(rawUrl)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : "Invalid DEXTools URL.", 400)
  }
  if (!chainCanExport(parsed.chain)) {
    throw new AppError(
      `${parsed.chain.name} does not have a public swap index this app can read yet. Full history works on Ethereum, Base, Arbitrum, Polygon, Optimism, Avalanche, Blast, zkSync, Celo, Unichain, World Chain, Metis, and Chiliz.`,
      422,
    )
  }

  const cursor = cursorText ? decodeCursor(cursorText) : null
  if (cursor && cursor.pool.address !== parsed.address) {
    throw new AppError("The continuation token does not match this pair.", 400)
  }
  const pool = cursor?.pool ?? (await resolvePool(parsed.chain, parsed.address, parsed.url))
  const topics = topicOrder(pool.dexId, pool.dex)
  const topic = cursor?.topic ?? topics[0]
  const tried = new Set(cursor?.triedTopics ?? [topic])

  const chain = parsed.chain
  const page = await readPage(parsed.chain, pool.address, topic, cursor)
  let trades = await hydrate(parsed.chain, pool, page.logs)
  let next = page.next
  let activeTopic = topic

  if (trades.length === 0 && !next && !cursor) {
    for (const alternate of topics) {
      if (tried.has(alternate)) continue
      tried.add(alternate)
      const retry = await readPage(parsed.chain, pool.address, alternate, null)
      if (retry.logs.length > 0 || retry.next) {
        trades = await hydrate(parsed.chain, pool, retry.logs)
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
      source: chain.routescan ? "routescan" : "blockscout",
      page: 1,
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
    dextoolsUrl: pool.dextoolsUrl,
    explorerTx: pool.explorerTx,
    explorerAddress: pool.explorerAddress,
  }
}

type PageResult = {
  logs: RawLog[]
  next: { source: "routescan" | "blockscout"; page: number; blockscoutParams: Record<string, string> | null } | null
}

async function readPage(
  chain: ChainConfig,
  address: string,
  topic: string,
  cursor: ServerCursor | null,
): Promise<PageResult> {
  const source = cursor?.source ?? (chain.routescan ? "routescan" : "blockscout")
  if (source === "routescan") {
    return readRoutescan(chain, address, topic, cursor?.page ?? 1)
  }
  if (!chain.blockscout) {
    throw new AppError(`No swap index is configured for ${chain.name}.`, 422)
  }
  return readBlockscout(chain.blockscout, address, topic, cursor?.blockscoutParams ?? null)
}

async function readRoutescan(
  chain: ChainConfig,
  address: string,
  topic: string,
  page: number,
): Promise<PageResult> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address,
    fromBlock: "0",
    toBlock: "latest",
    topic0: topic,
    page: String(page),
    offset: String(ROUTESCAN_PAGE),
  })
  const url = `https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`
  const body = (await fetchJson(url)) as { status?: string; message?: string; result?: unknown }
  if (!Array.isArray(body.result)) {
    const message = String(body.result || body.message || "no records")
    if (/no records|no logs|chain not supported/i.test(message)) {
      if (/chain not supported/i.test(message) && chain.blockscout) {
        return readBlockscout(chain.blockscout, address, topic, null)
      }
      return { logs: [], next: null }
    }
    throw new AppError(`The chain explorer could not return logs (${message}).`, 502)
  }
  const logs = body.result.map(routescanLog).filter((log): log is RawLog => log !== null)
  const next =
    logs.length >= ROUTESCAN_PAGE
      ? { source: "routescan" as const, page: page + 1, blockscoutParams: null }
      : null
  return { logs, next }
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

async function hydrate(chain: ChainConfig, pool: PoolContext, logs: RawLog[]): Promise<Trade[]> {
  const decoded = logs.flatMap((log) => {
    const swap = decodeSwap(log, pool)
    if (!swap) return []
    return [{ log, swap }]
  })
  if (decoded.length === 0) return []

  const [makers, prices, sizes] = await Promise.all([
    resolveMakers(
      chain,
      decoded.map((row) => row.log.txHash),
    ),
    quotePricesAt(
      chain.llama,
      pool.quote.address,
      pool.quote.symbol,
      decoded.map((row) => row.log.timestamp),
    ),
    loadPoolSizes(
      chain,
      pool,
      decoded.map((row) => row.log),
    ).catch(() => new Map<string, PoolSize>()),
  ])

  const trades = decoded.map(({ log, swap }) => {
    const quotePrice = prices.get(log.timestamp) ?? null
    const size = sizes.get(`${log.txHash.toLowerCase()}-${log.logIndex}`)
    const baseAmount = formatUnits(swap.baseRaw, pool.base.decimals)
    const quoteAmount = formatUnits(swap.quoteRaw, pool.quote.decimals)
    const priceQuote = priceInQuote(
      swap.quoteRaw,
      pool.quote.decimals,
      swap.baseRaw,
      pool.base.decimals,
    )
    const oneSided = swap.baseRaw === 0n || swap.quoteRaw === 0n
    const usd = quotePrice === null ? null : totalUsd(swap.quoteRaw, pool.quote.decimals, quotePrice)
    const trade: Trade = {
      id: `${log.txHash}-${log.logIndex}`,
      txNo: 0,
      timestamp: new Date(log.timestamp * 1000).toISOString(),
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      type: swap.type,
      priceQuote: oneSided ? null : priceQuote,
      baseAmount,
      quoteAmount,
      baseReserve: size?.base ?? null,
      quoteReserve: size?.quote ?? null,
      totalUsd: usd,
      priceUsd: usd && !oneSided ? priceUsdFromTotal(usd, baseAmount) : null,
      maker: makers.get(log.txHash.toLowerCase())?.from ?? "",
      router: makers.get(log.txHash.toLowerCase())?.to ?? "",
      makerTxCount: 0,
      makerTags: [],
      txHash: log.txHash,
      fundedBy: null,
      fundedByAddress: null,
    }
    return trade
  })

  trades.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber
    return b.logIndex - a.logIndex
  })
  return trades
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
  const size = 25
  const batches: string[][] = []
  for (let index = 0; index < hashes.length; index += size) {
    batches.push(hashes.slice(index, index + size))
  }
  await mapPool(batches, 3, async (batch) => {
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
    if (!parsed?.pool?.address || !parsed.topic || !parsed.source) {
      throw new Error("incomplete")
    }
    return parsed
  } catch {
    throw new AppError("That export session expired. Load the pair again.", 400)
  }
}
