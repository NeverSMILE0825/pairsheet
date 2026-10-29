import { encodeBase64Url } from "./bytes"
import type { ChainConfig } from "./chains"
import { formatUnits, priceInQuote, priceUsdFromTotal, totalUsd } from "./format"
import { AppError, fetchJson, mapPool, sleep } from "./http"
import { quotePricesAt } from "./prices"
import type { PoolContext, ServerCursor, SwapsResponse, Trade } from "./types"

const WSOL = "So11111111111111111111111111111111111111112"
/** Max signatures per getSignaturesForAddress call. */
const SIG_PAGE = 1000
/** Parallel getTransaction calls. Dual PublicNode hosts keep browsers past per-host limits. */
const TX_CONCURRENCY = 40
const TX_RETRY_CONCURRENCY = 10
const TX_OPTIONS = {
  encoding: "json" as const,
  maxSupportedTransactionVersion: 0,
  commitment: "confirmed" as const,
}

type TokenBalance = {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string }
}

type SolanaTx = {
  slot: number
  blockTime: number | null
  meta: {
    err: unknown
    preTokenBalances?: TokenBalance[]
    postTokenBalances?: TokenBalance[]
  } | null
  transaction: {
    message: {
      accountKeys: Array<string | { pubkey: string; signer?: boolean }>
    }
  }
}

type SigInfo = {
  signature: string
  slot: number
  err: unknown
  blockTime: number | null
}

/** Soft target: keep walking signature pages until we have enough swaps (many pool txs are not swaps). */
const TARGET_TRADES = 400
const MAX_SIG_PAGES = 4

export async function getSolanaSwapPage(
  chain: ChainConfig,
  address: string,
  dextoolsUrl: string,
  cursor: ServerCursor | null,
): Promise<SwapsResponse> {
  const pool = cursor?.pool ?? (await resolveSolanaPool(chain, address, dextoolsUrl))
  let before = cursor?.before ?? null
  const trades: Trade[] = []
  let pages = 0
  let nextBefore: string | null = null
  let pageIndex = cursor?.page ?? 0

  while (pages < MAX_SIG_PAGES && trades.length < TARGET_TRADES) {
    const signatures = await getSignatures(chain.rpcs, pool.address, before, SIG_PAGE)
    pages += 1
    pageIndex += 1
    if (signatures.length === 0) {
      nextBefore = null
      break
    }

    const success = signatures.filter((row) => row.err == null)
    const timestamps = success
      .map((row) => row.blockTime)
      .filter((value): value is number => typeof value === "number" && value > 0)

    // Overlap DefiLlama with getTransaction — pricing uses the same timestamps, no accuracy loss.
    const pricesPromise =
      timestamps.length > 0
        ? quotePricesAt(
            chain.llama,
            pool.quote.address === WSOL || pool.quote.symbol === "SOL" ? WSOL : pool.quote.address,
            pool.quote.symbol,
            timestamps,
            chain.wrappedNative,
          )
        : Promise.resolve(new Map<number, number | null>())

    const txs = await getTransactions(
      chain.rpcs,
      success.map((row) => row.signature),
    )
    const priceByTime = await pricesPromise

    for (let index = 0; index < success.length; index += 1) {
      const item = txs[index]
      if (!item) continue
      const trade = decodeSolanaSwap(pool, success[index].signature, item)
      if (!trade) continue
      trades.push(applyQuotePrice(trade, pool, priceByTime))
    }

    nextBefore = signatures.length >= SIG_PAGE ? signatures[signatures.length - 1]?.signature ?? null : null
    before = nextBefore
    if (!nextBefore) break
  }

  trades.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)

  const nextCursor = nextBefore
    ? encodeBase64Url(
        JSON.stringify({
          source: "solana",
          topic: "",
          triedTopics: [],
          queue: [],
          page: pageIndex,
          before: nextBefore,
          blockscoutParams: null,
          pool,
        } satisfies ServerCursor),
      )
    : null

  const missingUsd = trades.length > 0 && trades.every((trade) => !trade.totalUsd)
  return {
    pool: {
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
    },
    trades,
    nextCursor,
    warning: missingUsd
      ? "Historical USD prices were unavailable, so price and total are blank. Token amounts are still exact."
      : null,
  }
}

async function resolveSolanaPool(chain: ChainConfig, address: string, dextoolsUrl: string): Promise<PoolContext> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/pools/${address}?include=base_token,quote_token,dex`
  const body = (await fetchJson(url, { headers: { accept: "application/json;version=20230302" } })) as {
    data?: { attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: string } }> }
    included?: { id: string; type: string; attributes?: Record<string, unknown> }[]
  }
  const included = body.included ?? []
  const baseId = body.data?.relationships?.base_token?.data?.id
  const quoteId = body.data?.relationships?.quote_token?.data?.id
  const dexRel = body.data?.relationships?.dex?.data?.id
  const baseRow = included.find((item) => item.id === baseId)
  const quoteRow = included.find((item) => item.id === quoteId)
  const dex = included.find((item) => item.type === "dex" && (!dexRel || item.id === dexRel))
  if (!baseRow?.attributes || !quoteRow?.attributes) {
    throw new AppError("Could not resolve this Solana pool. Check the DEXTools link.", 404)
  }
  const attributes = body.data?.attributes ?? {}
  const base = tokenFromGecko(baseRow.attributes)
  const quote = tokenFromGecko(quoteRow.attributes)
  return {
    chainId: chain.id,
    chainName: chain.name,
    address,
    logAddress: address,
    topic1: null,
    style: "pair",
    dex: String(dex?.attributes?.name || dex?.id || "Solana DEX"),
    dexId: String(dex?.id || "solana"),
    base,
    quote,
    token0: base.address,
    token1: quote.address,
    createdAt: typeof attributes.pool_created_at === "string" ? attributes.pool_created_at : null,
    priceUsd: attributes.base_token_price_usd != null ? String(attributes.base_token_price_usd) : null,
    reserveUsd: attributes.reserve_in_usd != null ? String(attributes.reserve_in_usd) : null,
    dextoolsUrl,
    explorerTx: `${chain.explorer}/tx`,
    explorerAddress: `${chain.explorer}/account`,
  }
}

function tokenFromGecko(attributes: Record<string, unknown>) {
  const decimals = Number(attributes.decimals)
  const address = String(attributes.address || "")
  let symbol = String(attributes.symbol || "TOKEN")
  if (address === WSOL || symbol.toUpperCase() === "WSOL") symbol = "SOL"
  return {
    address,
    symbol,
    decimals: Number.isInteger(decimals) ? decimals : 9,
  }
}

async function getSignatures(
  rpcs: string[],
  address: string,
  before: string | null,
  limit: number,
): Promise<SigInfo[]> {
  const options: Record<string, unknown> = { limit }
  if (before) options.before = before
  const result = await solanaRpc(rpcs, "getSignaturesForAddress", [address, options])
  if (!Array.isArray(result)) return []
  return result.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const info = row as Record<string, unknown>
    if (typeof info.signature !== "string") return []
    return [
      {
        signature: info.signature,
        slot: Number(info.slot) || 0,
        err: info.err ?? null,
        blockTime: typeof info.blockTime === "number" ? info.blockTime : null,
      },
    ]
  })
}

/**
 * Fetch transactions at high concurrency across RPC hosts.
 * Soft-failed rows get a slower second pass so rate limits do not drop real swaps.
 */
async function getTransactions(rpcs: string[], signatures: string[]): Promise<(SolanaTx | null)[]> {
  if (signatures.length === 0) return []
  const hosts = primaryRpcs(rpcs)
  let cursor = 0
  const results = await mapPool(signatures, TX_CONCURRENCY, async (signature) => {
    const start = cursor
    cursor += 1
    return getTransactionRotate(hosts, signature, start)
  })

  const missing = results
    .map((tx, index) => (tx ? -1 : index))
    .filter((index) => index >= 0)
  if (missing.length === 0) return results

  await sleep(200)
  const recovered = await mapPool(missing, TX_RETRY_CONCURRENCY, async (index) => {
    const tx = await getTransactionRotate(hosts, signatures[index], index + 1)
    return { index, tx }
  })
  for (const row of recovered) {
    if (row.tx) results[row.index] = row.tx
  }
  return results
}

function primaryRpcs(rpcs: string[]): string[] {
  const preferred = rpcs.filter((rpc) => !/mainnet-beta\.solana\.com/i.test(rpc))
  return preferred.length > 0 ? preferred : rpcs
}

async function getTransactionRotate(
  rpcs: string[],
  signature: string,
  start: number,
): Promise<SolanaTx | null> {
  if (rpcs.length === 0) return null
  const offset = ((start % rpcs.length) + rpcs.length) % rpcs.length
  for (let attempt = 0; attempt < rpcs.length; attempt += 1) {
    const rpc = rpcs[(offset + attempt) % rpcs.length]
    try {
      return await getTransactionOne(rpc, signature)
    } catch {
      continue
    }
  }
  return null
}

async function getTransactionOne(rpc: string, signature: string): Promise<SolanaTx | null> {
  const result = await solanaRpcOnce(rpc, "getTransaction", [signature, TX_OPTIONS])
  if (!result || typeof result !== "object") return null
  return result as SolanaTx
}

async function solanaRpc(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: Error | null = null
  for (const rpc of rpcs) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await solanaRpcOnce(rpc, method, params)
      } catch (error) {
        last = error instanceof Error ? error : new Error("Solana RPC failed")
        await sleep(150 * (attempt + 1))
      }
    }
  }
  throw new AppError(last?.message || "Solana RPC failed", 502)
}

async function solanaRpcOnce(rpc: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "PairSheet/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(18000),
    cache: "no-store",
  })
  if (response.status === 429 || response.status >= 500) {
    throw new Error(`Solana RPC ${response.status}`)
  }
  if (!response.ok) {
    throw new Error(`Solana RPC ${response.status}`)
  }
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
  if (body.error?.message) {
    throw new Error(body.error.message)
  }
  return body.result
}

export function decodeSolanaSwap(pool: PoolContext, signature: string, tx: SolanaTx): Trade | null {
  if (!tx.meta || tx.meta.err) return null
  const baseDelta = poolOwnerDelta(tx.meta.preTokenBalances, tx.meta.postTokenBalances, pool.address, pool.base.address)
  const quoteDelta = poolOwnerDelta(tx.meta.preTokenBalances, tx.meta.postTokenBalances, pool.address, pool.quote.address)
  const baseIn = baseDelta > 0n ? baseDelta : 0n
  const baseOut = baseDelta < 0n ? -baseDelta : 0n
  const quoteIn = quoteDelta > 0n ? quoteDelta : 0n
  const quoteOut = quoteDelta < 0n ? -quoteDelta : 0n
  if ((baseIn === 0n && baseOut === 0n) || (quoteIn === 0n && quoteOut === 0n)) return null

  // BUY = pool sent base out (trader bought base). SELL = pool received base.
  const type = baseOut > 0n ? "BUY" : "SELL"
  const baseRaw = baseOut > 0n ? baseOut : baseIn
  const quoteRaw = quoteOut > 0n ? quoteOut : quoteIn
  if (baseRaw === 0n || quoteRaw === 0n) return null

  const maker = feePayer(tx)
  const baseAmount = formatUnits(baseRaw, pool.base.decimals)
  const quoteAmount = formatUnits(quoteRaw, pool.quote.decimals)
  const priceQuote = priceInQuote(quoteRaw, pool.quote.decimals, baseRaw, pool.base.decimals)
  const postBase = poolOwnerAmount(tx.meta.postTokenBalances, pool.address, pool.base.address)
  const postQuote = poolOwnerAmount(tx.meta.postTokenBalances, pool.address, pool.quote.address)

  return {
    id: signature,
    txNo: 0,
    timestamp: new Date((tx.blockTime ?? 0) * 1000).toISOString(),
    blockNumber: tx.slot,
    logIndex: 0,
    type,
    priceUsd: null,
    totalUsd: null,
    priceQuote,
    baseAmount,
    quoteAmount,
    baseReserve: postBase !== null ? formatUnits(postBase, pool.base.decimals) : null,
    quoteReserve: postQuote !== null ? formatUnits(postQuote, pool.quote.decimals) : null,
    holders: null,
    maker,
    router: "",
    makerTxCount: 0,
    makerTags: [],
    txHash: signature,
    fundedBy: null,
    fundedByAddress: null,
  }
}

function feePayer(tx: SolanaTx): string {
  const first = tx.transaction.message.accountKeys[0]
  if (!first) return ""
  return typeof first === "string" ? first : first.pubkey || ""
}

function poolOwnerDelta(
  pre: TokenBalance[] | undefined,
  post: TokenBalance[] | undefined,
  pool: string,
  mint: string,
): bigint {
  const before = poolOwnerAmount(pre, pool, mint) ?? 0n
  const after = poolOwnerAmount(post, pool, mint) ?? 0n
  return after - before
}

function poolOwnerAmount(balances: TokenBalance[] | undefined, pool: string, mint: string): bigint | null {
  if (!balances) return null
  let total: bigint | null = null
  for (const row of balances) {
    if (row.mint !== mint) continue
    if ((row.owner || "") !== pool) continue
    const raw = row.uiTokenAmount?.amount
    if (typeof raw !== "string") continue
    const value = BigInt(raw)
    total = (total ?? 0n) + value
  }
  return total
}

function applyQuotePrice(
  trade: Trade,
  pool: PoolContext,
  prices: Map<number, number | null>,
): Trade {
  const timestamp = Math.floor(Date.parse(trade.timestamp) / 1000)
  const quotePrice = prices.get(timestamp) ?? nearestCachedPrice(prices, timestamp)
  if (quotePrice === null || quotePrice === undefined) return trade
  const quoteRaw = parseUnits(trade.quoteAmount, pool.quote.decimals)
  if (quoteRaw === null) return trade
  const usd = totalUsd(quoteRaw, pool.quote.decimals, quotePrice)
  return {
    ...trade,
    totalUsd: usd,
    priceUsd: usd ? priceUsdFromTotal(usd, trade.baseAmount) : null,
  }
}

/** Signature blockTime and tx.blockTime match; if a key is missing, use nearest same-second chart hit. */
function nearestCachedPrice(prices: Map<number, number | null>, timestamp: number): number | null {
  if (prices.has(timestamp)) return prices.get(timestamp) ?? null
  let best: number | null = null
  let bestDistance = Infinity
  for (const [time, price] of prices) {
    if (price === null) continue
    const distance = Math.abs(time - timestamp)
    if (distance < bestDistance && distance <= 120) {
      best = price
      bestDistance = distance
    }
  }
  return best
}

function parseUnits(value: string, decimals: number): bigint | null {
  const [whole, frac = ""] = value.split(".")
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return null
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals)
  try {
    return BigInt(whole + padded)
  } catch {
    return null
  }
}
