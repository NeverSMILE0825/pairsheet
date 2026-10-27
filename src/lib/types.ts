export type MakerTag = "bot" | "team"

export type Side = "BUY" | "SELL" | "ADD" | "REMOVE"

export type TokenInfo = {
  address: string
  symbol: string
  decimals: number
}

export type PoolContext = {
  chainId: string
  chainName: string
  address: string
  dex: string
  dexId: string
  base: TokenInfo
  quote: TokenInfo
  token0: string
  token1: string
  createdAt: string | null
  priceUsd: string | null
  reserveUsd: string | null
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
  totalUsd: string | null
  priceQuote: string | null
  baseAmount: string
  quoteAmount: string
  baseReserve: string | null
  quoteReserve: string | null
  maker: string
  router: string
  makerTxCount: number
  makerTags: MakerTag[]
  txHash: string
  fundedBy: string | null
  fundedByAddress: string | null
}

export type SwapsResponse = {
  pool: PoolView
  trades: Trade[]
  nextCursor: string | null
  warning: string | null
}

export type RawLog = {
  data: string
  topics: string[]
  blockNumber: number
  timestamp: number
  txHash: string
  logIndex: number
}
