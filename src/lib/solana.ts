import { encodeBase64Url } from "./bytes"
import type { ChainConfig } from "./chains"
import { formatUnits, priceInQuote, priceUsdFromTotal, totalUsd } from "./format"
import { AppError, fetchJson, mapPool } from "./http"
import { quotePricesAt } from "./prices"
import type { PoolContext, ServerCursor, SwapsResponse, Trade } from "./types"

const WSOL = "So11111111111111111111111111111111111111112"
const SIG_PAGE = 80
const TX_CONCURRENCY = 4

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

export async function getSolanaSwapPage(
  chain: ChainConfig,
  address: string,
  dextoolsUrl: string,
  cursor: ServerCursor | null,
): Promise<SwapsResponse> {
  const pool = cursor?.pool ?? (await resolveSolanaPool(chain, address, dextoolsUrl))
  const before = cursor?.before ?? null
  const signatures = await getSignatures(chain.rpcs, pool.address, before, SIG_PAGE)
  const success = signatures.filter((row) => row.err == null)
  const txs = await mapPool(success, TX_CONCURRENCY, async (row) => {
    try {
      const tx = await getTransaction(chain.rpcs, row.signature)
      return tx ? { signature: row.signature, tx } : null
    } catch {
      return null
    }
  })

  const trades: Trade[] = []
  for (const item of txs) {
    if (!item) continue
    const trade = decodeSolanaSwap(pool, item.signature, item.tx)
    if (trade) trades.push(trade)
  }

  trades.sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)

  const priced = await priceSolanaTrades(chain, pool, trades)
  const nextBefore = signatures.length >= SIG_PAGE ? signatures[signatures.length - 1]?.signature ?? null : null
  const nextCursor = nextBefore
    ? encodeBase64Url(
        JSON.stringify({
          source: "solana",
          topic: "",
          triedTopics: [],
          queue: [],
          page: (cursor?.page ?? 0) + 1,
          before: nextBefore,
          blockscoutParams: null,
          pool,
        } satisfies ServerCursor),
      )
    : null

  const missingUsd = priced.length > 0 && priced.every((trade) => !trade.totalUsd)
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
    trades: priced,
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

async function getTransaction(rpcs: string[], signature: string): Promise<SolanaTx | null> {
  const result = await solanaRpc(rpcs, "getTransaction", [
    signature,
    { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ])
  if (!result || typeof result !== "object") return null
  return result as SolanaTx
}

async function solanaRpc(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: Error | null = null
  for (const rpc of rpcs) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(rpc, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", "user-agent": "PairSheet/1.0" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        })
        if (response.status === 429 || response.status >= 500) {
          last = new Error(`Solana RPC ${response.status}`)
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
          continue
        }
        if (!response.ok) {
          last = new Error(`Solana RPC ${response.status}`)
          break
        }
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
        if (body.error?.message) {
          last = new Error(body.error.message)
          break
        }
        return body.result
      } catch (error) {
        last = error instanceof Error ? error : new Error("Solana RPC failed")
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
    }
  }
  throw new AppError(last?.message || "Solana RPC failed", 502)
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

async function priceSolanaTrades(chain: ChainConfig, pool: PoolContext, trades: Trade[]): Promise<Trade[]> {
  if (trades.length === 0) return trades
  const timestamps = trades.map((trade) => Math.floor(Date.parse(trade.timestamp) / 1000))
  const prices = await quotePricesAt(
    chain.llama,
    pool.quote.address === WSOL || pool.quote.symbol === "SOL" ? WSOL : pool.quote.address,
    pool.quote.symbol,
    timestamps,
    chain.wrappedNative,
  )
  return trades.map((trade, index) => {
    const quotePrice = prices.get(timestamps[index]) ?? null
    if (quotePrice === null) return trade
    const quoteRaw = parseUnits(trade.quoteAmount, pool.quote.decimals)
    if (quoteRaw === null) return trade
    const usd = totalUsd(quoteRaw, pool.quote.decimals, quotePrice)
    return {
      ...trade,
      totalUsd: usd,
      priceUsd: usd ? priceUsdFromTotal(usd, trade.baseAmount) : null,
    }
  })
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
