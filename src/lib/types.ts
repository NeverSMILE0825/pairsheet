export type MakerTag = "bot" | "team"

export type Side = "BUY" | "SELL" | "ADD" | "REMOVE" | "INIT"

export type TokenInfo = {
  address: string
  symbol: string
  decimals: number
}

export type PoolStyle = "pair" | "v4"

export type PoolContext = {
  chainId: string
  chainName: string
  /** Pair contract (v2/v3) or Uniswap V4 pool id (bytes32). */
  address: string
  /** Contract that emits the swap logs (pair itself, or V4 PoolManager). */
  logAddress: string
  /** Extra topic1 filter for V4 (pool id); null for pair-style pools. */
  topic1: string | null
  style: PoolStyle
  dex: string
  dexId: string
  base: TokenInfo
  quote: TokenInfo
  token0: string
  token1: string
  createdAt: string | null
  priceUsd: string | null
  reserveUsd: string | null
  /** Normalized whole-token base supply (for FDV / market cap). */
  baseTotalSupply: string | null
  dextoolsUrl: string
  explorerTx: string
  explorerAddress: string
}

export type PoolView = {
  chainId: string
  chainName: string
  address: string
  dex: string
  baseSymbol: string
  quoteSymbol: string
  baseAddress: string
  quoteAddress: string
  createdAt: string | null
  priceUsd: string | null
  reserveUsd: string | null
  baseTotalSupply: string | null
  dextoolsUrl: string
  explorerTx: string
  explorerAddress: string
}

export type Trade = {
  id: string
  /** Chronological index among loaded trades; oldest is 1. Stable across sorts/filters. */
  txNo: number
  timestamp: string
  blockNumber: number
  logIndex: number
  type: Side
  priceUsd: string | null
  /** Fully diluted market cap at this trade's unit price (priceUsd × supply). */
  marketCapUsd: string | null
  totalUsd: string | null
  priceQuote: string | null
  baseAmount: string
  quoteAmount: string
  baseReserve: string | null
  quoteReserve: string | null
  /** Unique non-zero base-token holders right after this trade (excludes pool + burn sinks). */
  holders: number | null
  maker: string
  router: string
  makerTxCount: number
  makerTags: MakerTag[]
  txHash: string
  fundedBy: string | null
  fundedByAddress: string | null
  /** Effective gas price for this tx (gwei). Null on Solana / when receipt missing. */
  gasPriceGwei: string | null
  /** Exact fee for this tx in wei (string). Shared across rows with the same txHash. */
  gasFeeWei: string | null
  /** Running sum of unique tx fees from the oldest loaded trade through this row (ETH, 4 dp). */
  gasFeeTotalEth: string | null
}

export type SwapsResponse = {
  pool: PoolView
  trades: Trade[]
  nextCursor: string | null
  warning: string | null
}

export type ServerCursor = {
  source: "routescan" | "blockscout" | "solana"
  topic: string
  triedTopics: string[]
  queue: string[]
  page: number
  toBlock?: number | null
  before?: string | null
  blockscoutParams: Record<string, string> | null
  pool: PoolContext
}

export type RawLog = {
  data: string
  topics: string[]
  blockNumber: number
  timestamp: number
  txHash: string
  logIndex: number
}
