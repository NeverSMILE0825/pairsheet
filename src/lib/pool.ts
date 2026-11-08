import type { ChainConfig } from "./chains"
import { INIT_V4_TOPIC, decodeAbiString, sameAddress } from "./decode"
import { formatUnits, marketCapFromPrice } from "./format"
import { AppError, fetchJson, rpcCall } from "./http"
import { isStableSymbol } from "./prices"
import type { PoolContext, PoolStyle, TokenInfo, Trade } from "./types"

const NATIVE = "0x0000000000000000000000000000000000000000"

const WRAPPED = new Set([
  "weth",
  "weth.e",
  "wbnb",
  "wmatic",
  "wpol",
  "wavax",
  "wftm",
  "wcro",
  "wxdai",
  "ws",
  "wbera",
  "wpulse",
  "wmetis",
  "wsonic",
  "eth",
  "bnb",
  "matic",
  "pol",
  "avax",
])

type GeckoPool = {
  base: TokenInfo
  quote: TokenInfo
  dex: string
  dexId: string
  createdAt: string | null
  priceUsd: string | null
  reserveUsd: string | null
  baseTotalSupply: string | null
}

export function isPoolId(address: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(address)
}

export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE
}

export async function resolvePool(
  chain: ChainConfig,
  address: string,
  dextoolsUrl: string,
): Promise<PoolContext> {
  let gecko = await loadGecko(chain, address)
  const v4Hint = isPoolId(address) || /uniswap-v4|v4/i.test(gecko?.dexId || gecko?.dex || "")
  if (v4Hint) return resolveV4Pool(chain, address, dextoolsUrl, gecko)

  const code = chain.rpcs.length
    ? await rpcCall(chain.rpcs, "eth_getCode", [address, "latest"]).catch(() => "0x1")
    : "0x1"

  if (code === "0x" || code === "0x0") {
    throw new AppError(`That address is not a contract on ${chain.name}.`, 404)
  }

  let token0: TokenInfo
  let token1: TokenInfo
  try {
    const [first, second] = await Promise.all([
      readToken(chain, address, "0x0dfe1681"),
      readToken(chain, address, "0xd21220a7"),
    ])
    token0 = first
    token1 = second
  } catch (error) {
    if (!gecko) gecko = await loadDexScreener(chain, address)
    if (gecko) {
      token0 = gecko.base
      token1 = gecko.quote
    } else {
      const message = error instanceof Error ? error.message : "token call failed"
      throw new AppError(
        `This contract does not look like a DEX pair on ${chain.name} (${message}).`,
        422,
      )
    }
  }

  if (gecko) {
    token0 = mergeToken(token0, [gecko.base, gecko.quote])
    token1 = mergeToken(token1, [gecko.base, gecko.quote])
  }

  const sides = pickSides(token0, token1, gecko)

  return {
    chainId: chain.id,
    chainName: chain.name,
    address,
    logAddress: address,
    topic1: null,
    style: "pair",
    dex: gecko?.dex || "DEX pair",
    dexId: gecko?.dexId || "",
    base: sides.base,
    quote: sides.quote,
    token0: token0.address,
    token1: token1.address,
    createdAt: gecko?.createdAt ?? null,
    priceUsd: gecko?.priceUsd ?? null,
    reserveUsd: gecko?.reserveUsd ?? null,
    baseTotalSupply: gecko?.baseTotalSupply ?? null,
    dextoolsUrl,
    explorerTx: `${chain.explorer}/tx`,
    explorerAddress: `${chain.explorer}/address`,
  }
}

async function resolveV4Pool(
  chain: ChainConfig,
  poolId: string,
  dextoolsUrl: string,
  gecko: GeckoPool | null,
): Promise<PoolContext> {
  if (!chain.v4PoolManager) {
    throw new AppError(
      `Uniswap V4 pools are not supported on ${chain.name} yet (no PoolManager mapped for this chain).`,
      422,
    )
  }
  if (!gecko) {
    const [onchain, indexed] = await Promise.all([
      loadV4PoolFromChain(chain, poolId),
      loadDexScreener(chain, poolId),
    ])
    gecko = mergePoolMeta(onchain, indexed)
  }
  if (!gecko) {
    throw new AppError(
      "Could not resolve this Uniswap V4 pool. Check the DEXTools link, or try again in a moment.",
      404,
    )
  }

  const [token0, token1] = orderByAddress(gecko.base, gecko.quote)
  const sides = pickSides(token0, token1, gecko)

  return {
    chainId: chain.id,
    chainName: chain.name,
    address: poolId.toLowerCase(),
    logAddress: chain.v4PoolManager.toLowerCase(),
    topic1: poolId.toLowerCase(),
    style: "v4" satisfies PoolStyle,
    dex: gecko.dex || "Uniswap V4",
    dexId: gecko.dexId || "uniswap-v4",
    base: sides.base,
    quote: sides.quote,
    token0: token0.address,
    token1: token1.address,
    createdAt: gecko.createdAt,
    priceUsd: gecko.priceUsd,
    reserveUsd: gecko.reserveUsd,
    baseTotalSupply: gecko.baseTotalSupply,
    dextoolsUrl,
    explorerTx: `${chain.explorer}/tx`,
    explorerAddress: `${chain.explorer}/address`,
  }
}

function orderByAddress(a: TokenInfo, b: TokenInfo): [TokenInfo, TokenInfo] {
  return a.address.toLowerCase() < b.address.toLowerCase() ? [a, b] : [b, a]
}

function mergeToken(token: TokenInfo, known: TokenInfo[]): TokenInfo {
  const match = known.find((item) => sameAddress(item.address, token.address))
  if (!match) return token
  return {
    address: token.address,
    symbol: match.symbol || token.symbol,
    decimals: Number.isFinite(match.decimals) ? match.decimals : token.decimals,
  }
}

function pickSides(
  token0: TokenInfo,
  token1: TokenInfo,
  gecko: GeckoPool | null,
): { base: TokenInfo; quote: TokenInfo } {
  if (gecko) {
    const base = [token0, token1].find((token) => sameAddress(token.address, gecko.base.address))
    const quote = [token0, token1].find((token) => sameAddress(token.address, gecko.quote.address))
    if (base && quote && !sameAddress(base.address, quote.address)) return { base, quote }
  }
  const quote0 = isQuoteToken(token0.symbol) || isNativeToken(token0.address)
  const quote1 = isQuoteToken(token1.symbol) || isNativeToken(token1.address)
  if (quote0 && !quote1) return { base: token1, quote: token0 }
  if (quote1 && !quote0) return { base: token0, quote: token1 }
  return { base: token0, quote: token1 }
}

function isQuoteToken(symbol: string): boolean {
  return isStableSymbol(symbol) || WRAPPED.has(symbol.toLowerCase())
}

async function readToken(chain: ChainConfig, pool: string, selector: "0x0dfe1681" | "0xd21220a7"): Promise<TokenInfo> {
  if (chain.rpcs.length === 0) {
    throw new Error("no rpc")
  }
  const raw = await rpcCall(chain.rpcs, "eth_call", [{ to: pool, data: selector }, "latest"])
  if (typeof raw !== "string" || raw.length < 42) throw new Error("empty token address")
  const address = `0x${raw.slice(-40)}`.toLowerCase()
  const [symbol, decimals] = await Promise.all([
    readSymbol(chain, address),
    readDecimals(chain, address),
  ])
  return { address, symbol, decimals }
}

async function readSymbol(chain: ChainConfig, token: string): Promise<string> {
  if (isNativeToken(token)) return "ETH"
  try {
    const raw = await rpcCall(chain.rpcs, "eth_call", [{ to: token, data: "0x95d89b41" }, "latest"])
    if (typeof raw !== "string") return shortToken(token)
    const symbol = decodeAbiString(raw).trim()
    return symbol || shortToken(token)
  } catch {
    return shortToken(token)
  }
}

async function readDecimals(chain: ChainConfig, token: string): Promise<number> {
  if (isNativeToken(token)) return 18
  try {
    const raw = await rpcCall(chain.rpcs, "eth_call", [{ to: token, data: "0x313ce567" }, "latest"])
    if (typeof raw !== "string") return 18
    const decimals = Number(BigInt(raw))
    return Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18
  } catch {
    return 18
  }
}

function shortToken(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

const NATIVE_SYMBOL: Record<string, string> = {
  ether: "ETH",
  base: "ETH",
  arbitrum: "ETH",
  optimism: "ETH",
  linea: "ETH",
  scroll: "ETH",
  blast: "ETH",
  zksync: "ETH",
  unichain: "ETH",
  worldchain: "ETH",
  bnb: "BNB",
  polygon: "POL",
  avalanche: "AVAX",
  celo: "CELO",
  gnosis: "XDAI",
  mantle: "MNT",
  metis: "METIS",
  chiliz: "CHZ",
}

/** DexScreener chain slug. DefiLlama ids are not always the same. */
const DEXSCREENER_SLUG: Record<string, string> = {
  solana: "solana",
  ether: "ethereum",
  bnb: "bsc",
  polygon: "polygon",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  avalanche: "avalanche",
  linea: "linea",
  scroll: "scroll",
  blast: "blast",
  zksync: "zksync",
  celo: "celo",
  unichain: "unichain",
  worldchain: "worldchain",
  gnosis: "gnosis",
  mantle: "mantle",
  metis: "metis",
  chiliz: "chiliz",
}

const DEX_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"

/** Currency address indexed in a Uniswap V4 Initialize topic. */
export function addressFromTopic(topic: string): string | null {
  const hex = topic.toLowerCase().replace(/^0x/, "")
  if (!/^[0-9a-f]{64}$/.test(hex)) return null
  return `0x${hex.slice(24)}`
}

/** token0 and token1 from a PoolManager Initialize log. */
export function currenciesFromV4Initialize(
  topics: readonly string[] | undefined,
): { token0: string; token1: string } | null {
  if (!topics || topics.length < 4) return null
  if ((topics[0] || "").toLowerCase() !== INIT_V4_TOPIC) return null
  const token0 = addressFromTopic(topics[2] || "")
  const token1 = addressFromTopic(topics[3] || "")
  if (!token0 || !token1) return null
  return { token0, token1 }
}

function nativeSymbol(chain: ChainConfig): string {
  return NATIVE_SYMBOL[chain.id] || "ETH"
}

function normalizeTokenAddress(address: string): string {
  const value = address.trim().toLowerCase()
  if (!value || value === DEX_NATIVE || value === "native" || value === "eth") return NATIVE
  return value
}

/**
 * Keep the on-chain pair when both sources exist. Fill price and a missing
 * symbol from the indexer.
 */
function mergePoolMeta(onchain: GeckoPool | null, indexed: GeckoPool | null): GeckoPool | null {
  if (!onchain) return indexed
  if (!indexed) return onchain
  return {
    ...onchain,
    base: preferSymbol(onchain.base, indexed),
    quote: preferSymbol(onchain.quote, indexed),
    priceUsd: onchain.priceUsd ?? indexed.priceUsd,
    reserveUsd: onchain.reserveUsd ?? indexed.reserveUsd,
    createdAt: onchain.createdAt ?? indexed.createdAt,
    baseTotalSupply: onchain.baseTotalSupply ?? indexed.baseTotalSupply,
  }
}

function preferSymbol(token: TokenInfo, indexed: GeckoPool): TokenInfo {
  const known = [indexed.base, indexed.quote].find((item) => sameAddress(item.address, token.address))
  if (!known?.symbol || !token.symbol.includes("…")) return token
  return { ...token, symbol: known.symbol }
}

async function loadV4PoolFromChain(chain: ChainConfig, poolId: string): Promise<GeckoPool | null> {
  if (!chain.v4PoolManager) return null
  const topics = await findV4InitializeTopics(chain, poolId)
  const currencies = currenciesFromV4Initialize(topics)
  if (!currencies) return null
  const [token0, token1] = await Promise.all([
    describeToken(chain, currencies.token0),
    describeToken(chain, currencies.token1),
  ])
  const sides = pickSides(token0, token1, null)
  const baseTotalSupply = await resolveTokenTotalSupply(chain, sides.base.address).catch(() => null)
  return {
    base: sides.base,
    quote: sides.quote,
    dex: "Uniswap V4",
    dexId: "uniswap-v4",
    createdAt: null,
    priceUsd: null,
    reserveUsd: null,
    baseTotalSupply,
  }
}

async function findV4InitializeTopics(chain: ChainConfig, poolId: string): Promise<string[] | undefined> {
  const id = poolId.toLowerCase()
  for (const url of v4InitLogUrls(chain, id)) {
    try {
      const body = (await fetchJson(url)) as { result?: unknown }
      const topics = topicsFromExplorerLogs(body.result)
      if (topics) return topics
    } catch {
      continue
    }
  }
  if (chain.rpcs.length === 0 || !chain.v4PoolManager) return undefined
  try {
    const result = await rpcCall(chain.rpcs, "eth_getLogs", [
      {
        address: chain.v4PoolManager,
        topics: [INIT_V4_TOPIC, id],
        fromBlock: "0x0",
        toBlock: "latest",
      },
    ])
    return topicsFromExplorerLogs(result)
  } catch {
    return undefined
  }
}

function v4InitLogUrls(chain: ChainConfig, poolId: string): string[] {
  if (!chain.v4PoolManager) return []
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: chain.v4PoolManager,
    fromBlock: "0",
    toBlock: "latest",
    topic0: INIT_V4_TOPIC,
    topic1: poolId,
    topic0_1_opr: "and",
    page: "1",
    offset: "1",
  })
  const urls: string[] = []
  if (chain.routescan) {
    urls.push(`https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`)
  }
  if (chain.blockscout) {
    urls.push(`${chain.blockscout.replace(/\/$/, "")}/api?${params}`)
  }
  return urls
}

function topicsFromExplorerLogs(result: unknown): string[] | undefined {
  const rows = Array.isArray(result) ? result : []
  for (const row of rows) {
    if (!row || typeof row !== "object") continue
    const topics = (row as { topics?: unknown }).topics
    if (!Array.isArray(topics) || !topics.every((topic) => typeof topic === "string")) continue
    if (currenciesFromV4Initialize(topics)) return topics
  }
  return undefined
}

async function loadDexScreener(chain: ChainConfig, address: string): Promise<GeckoPool | null> {
  const slug = DEXSCREENER_SLUG[chain.id]
  if (!slug) return null
  try {
    const body = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/${slug}/${address}`)
    const pair = firstDexPair(body)
    if (!pair) return null
    const baseRaw = dexToken(pair.baseToken)
    const quoteRaw = dexToken(pair.quoteToken)
    if (!baseRaw || !quoteRaw) return null
    const [base, quote] = await Promise.all([
      describeToken(chain, baseRaw.address, baseRaw.symbol),
      describeToken(chain, quoteRaw.address, quoteRaw.symbol),
    ])
    const attributes = {
      base_token_price_usd: pair.priceUsd,
      fdv_usd: pair.fdv,
    }
    const fromToken = await resolveTokenTotalSupply(chain, base.address).catch(() => null)
    const created = Number(pair.pairCreatedAt)
    const liquidity = pair.liquidity && typeof pair.liquidity === "object" ? (pair.liquidity as { usd?: unknown }).usd : null
    const dexId = String(pair.dexId || "")
    return {
      base,
      quote,
      dex: dexLabel(dexId),
      dexId,
      createdAt: Number.isFinite(created) && created > 0 ? new Date(created).toISOString() : null,
      priceUsd: pair.priceUsd != null && String(pair.priceUsd) !== "" ? String(pair.priceUsd) : null,
      reserveUsd: liquidity != null && String(liquidity) !== "" ? String(liquidity) : null,
      baseTotalSupply: pickBaseTotalSupply(fromToken, supplyFromFdv(attributes)),
    }
  } catch {
    return null
  }
}

function dexLabel(dexId: string): string {
  if (/uniswap/i.test(dexId) && /v4/i.test(dexId)) return "Uniswap V4"
  if (/uniswap/i.test(dexId)) return "Uniswap"
  return dexId || "DEX"
}

function firstDexPair(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null
  const record = body as { pairs?: unknown; pair?: unknown }
  if (Array.isArray(record.pairs) && record.pairs[0] && typeof record.pairs[0] === "object") {
    return record.pairs[0] as Record<string, unknown>
  }
  if (record.pair && typeof record.pair === "object") return record.pair as Record<string, unknown>
  return null
}

function dexToken(value: unknown): { address: string; symbol: string } | null {
  if (!value || typeof value !== "object") return null
  const row = value as { address?: unknown; symbol?: unknown }
  const address = String(row.address || "").trim()
  if (!address) return null
  return { address, symbol: String(row.symbol || "").trim() }
}

async function describeToken(chain: ChainConfig, address: string, symbolHint?: string): Promise<TokenInfo> {
  const normalized = normalizeTokenAddress(address)
  if (isNativeToken(normalized)) {
    const hinted = symbolHint && !/^0x/i.test(symbolHint) ? symbolHint : ""
    return { address: NATIVE, symbol: hinted || nativeSymbol(chain), decimals: 18 }
  }
  const [symbol, decimals] = await Promise.all([
    symbolHint ? Promise.resolve(symbolHint) : readSymbol(chain, normalized),
    readDecimals(chain, normalized),
  ])
  return { address: normalized, symbol: symbol || shortToken(normalized), decimals }
}

async function loadGecko(chain: ChainConfig, address: string): Promise<GeckoPool | null> {
  const url = `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/pools/${address}?include=base_token,quote_token,dex`
  try {
    const body = (await fetchJson(url, { headers: { accept: "application/json;version=20230302" } })) as {
      data?: { attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: string } }> }
      included?: { id: string; type: string; attributes?: Record<string, unknown> }[]
    }
    const included = body.included ?? []
    const baseId = body.data?.relationships?.base_token?.data?.id
    const quoteId = body.data?.relationships?.quote_token?.data?.id
    const dexRel = body.data?.relationships?.dex?.data?.id
    const base = included.find((item) => item.id === baseId)
    const quote = included.find((item) => item.id === quoteId)
    const dex = included.find((item) => item.type === "dex" && (!dexRel || item.id === dexRel))
    if (!base?.attributes || !quote?.attributes) return null
    const attributes = body.data?.attributes ?? {}
    const baseToken = tokenFromGecko(base.attributes)
    // Prefer real token supply. Pool fdv_usd ÷ price is often wrong on Gecko (esp. V4),
    // e.g. GROKLET ~25× inflated → chart Max ~$12M instead of ~$508K.
    const fromIncluded = supplyFromNormalizedTotal(base.attributes)
    const fromTokenApi =
      fromIncluded ?? (await loadGeckoTokenSupply(chain, baseToken.address).catch(() => null))
    const fromChain =
      fromTokenApi ??
      (await loadOnChainTotalSupply(chain, baseToken.address, baseToken.decimals).catch(() => null))
    const baseTotalSupply = pickBaseTotalSupply(fromChain, supplyFromFdv(attributes))
    return {
      base: baseToken,
      quote: tokenFromGecko(quote.attributes),
      dex: String(dex?.attributes?.name || dex?.id || "DEX"),
      dexId: String(dex?.id || ""),
      createdAt: typeof attributes.pool_created_at === "string" ? attributes.pool_created_at : null,
      priceUsd:
        attributes.base_token_price_usd != null ? String(attributes.base_token_price_usd) : null,
      reserveUsd: attributes.reserve_in_usd != null ? String(attributes.reserve_in_usd) : null,
      baseTotalSupply,
    }
  } catch {
    return null
  }
}

/** Token `normalized_total_supply` from a Gecko token (or included base_token) payload. */
export function supplyFromNormalizedTotal(attributes: Record<string, unknown>): string | null {
  if (attributes.normalized_total_supply == null) return null
  const value = Number(attributes.normalized_total_supply)
  if (!Number.isFinite(value) || value <= 0) return null
  return String(value)
}

/**
 * Pool fdv_usd ÷ base_token_price_usd — last-resort supply estimate only.
 * Gecko’s pool FDV is frequently inconsistent with token FDV / total supply.
 */
export function supplyFromFdv(attributes: Record<string, unknown>): string | null {
  const price = Number(attributes.base_token_price_usd)
  const fdv = Number(attributes.fdv_usd)
  if (!(price > 0) || !Number.isFinite(fdv) || fdv <= 0) return null
  const supply = fdv / price
  if (!Number.isFinite(supply) || supply <= 0) return null
  return String(supply)
}

/** Prefer on-chain / normalized token supply; use FDV-derived only when that is missing. */
export function pickBaseTotalSupply(
  tokenSupply: string | null,
  fdvSupply: string | null,
): string | null {
  return tokenSupply ?? fdvSupply
}

/** True when two supplies disagree by more than 0.5% (or one side is missing). */
export function suppliesDiffer(stored: string | null, fresh: string | null): boolean {
  if (!fresh) return false
  const next = Number(fresh)
  if (!(next > 0) || !Number.isFinite(next)) return false
  if (stored == null || stored === "") return true
  const prev = Number(stored)
  if (!(prev > 0) || !Number.isFinite(prev)) return true
  const ratio = prev / next
  return ratio < 0.995 || ratio > 1.005
}

/**
 * Saved tapes store marketCapUsd. True when any priced row’s implied supply
 * (mcap ÷ price) disagrees with the token’s real total supply.
 * Later rows must be checked: V4 polish rewrites INIT before buys are fixed.
 */
export function marketCapsDrift(
  trades: Pick<Trade, "priceUsd" | "marketCapUsd">[],
  supply: string,
): boolean {
  const fresh = Number(supply)
  if (!(fresh > 0) || !Number.isFinite(fresh)) return false
  for (const trade of trades) {
    const price = Number(trade.priceUsd)
    const cap = Number(trade.marketCapUsd)
    if (!(price > 0) || !(cap > 0)) continue
    const ratio = cap / price / fresh
    if (ratio < 0.995 || ratio > 1.005) return true
  }
  return false
}

/** Rewrite market caps from each row’s unit price × supply. Rows without a price stay as stored. */
export function repriceMarketCaps(trades: Trade[], supply: string): { trades: Trade[]; changed: boolean } {
  let changed = false
  const next = trades.map((trade) => {
    if (!trade.priceUsd) return trade
    const marketCapUsd = marketCapFromPrice(trade.priceUsd, supply)
    if (marketCapUsd == null || marketCapUsd === trade.marketCapUsd) return trade
    changed = true
    return { ...trade, marketCapUsd }
  })
  return { trades: changed ? next : trades, changed }
}

export async function loadGeckoTokenSupply(
  chain: ChainConfig,
  tokenAddress: string,
): Promise<string | null> {
  const resolved = await resolveTokenTotalSupply(chain, tokenAddress)
  return resolved
}

/** Gecko normalized supply, then on-chain totalSupply. Used to repair saved tapes. */
export async function resolveTokenTotalSupply(
  chain: ChainConfig,
  tokenAddress: string,
): Promise<string | null> {
  if (!tokenAddress || isNativeToken(tokenAddress)) return null
  const url = `https://api.geckoterminal.com/api/v2/networks/${chain.gecko}/tokens/${tokenAddress}`
  try {
    const body = (await fetchJson(url, { headers: { accept: "application/json;version=20230302" } })) as {
      data?: { attributes?: Record<string, unknown> }
    }
    const attributes = body.data?.attributes ?? {}
    const normalized = supplyFromNormalizedTotal(attributes)
    if (normalized) return normalized
    const decimals = Number(attributes.decimals)
    const places = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18
    return await loadOnChainTotalSupply(chain, tokenAddress, places)
  } catch {
    return loadOnChainTotalSupply(chain, tokenAddress, 18).catch(() => null)
  }
}

async function loadOnChainTotalSupply(
  chain: ChainConfig,
  tokenAddress: string,
  decimals: number,
): Promise<string | null> {
  if (!tokenAddress || isNativeToken(tokenAddress) || !chain.rpcs.length) return null
  const raw = await rpcCall(chain.rpcs, "eth_call", [
    { to: tokenAddress, data: "0x18160ddd" },
    "latest",
  ])
  if (typeof raw !== "string" || !raw.startsWith("0x")) return null
  const amount = BigInt(raw)
  if (amount <= 0n) return null
  return formatUnits(amount, decimals)
}

function tokenFromGecko(attributes: Record<string, unknown>): TokenInfo {
  const decimals = Number(attributes.decimals)
  const address = String(attributes.address || "").toLowerCase()
  return {
    address: address || NATIVE,
    symbol: String(attributes.symbol || (isNativeToken(address) ? "ETH" : "TOKEN")),
    decimals: Number.isInteger(decimals) ? decimals : 18,
  }
}
