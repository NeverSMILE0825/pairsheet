import type { ChainConfig } from "./chains"
import { decodeAbiString, sameAddress } from "./decode"
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
  const gecko = await loadGecko(chain, address)
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

function resolveV4Pool(
  chain: ChainConfig,
  poolId: string,
  dextoolsUrl: string,
  gecko: GeckoPool | null,
): PoolContext {
  if (!chain.v4PoolManager) {
    throw new AppError(
      `Uniswap V4 pools are not supported on ${chain.name} yet (no PoolManager mapped for this chain).`,
      422,
    )
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
