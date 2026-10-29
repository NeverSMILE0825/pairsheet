/** Live ETH/USD and Ethereum gas for the header widgets (browser-side). */

export type EthSnap = {
  priceUsd: number
  change1h: number | null
  change24h: number | null
  change7d: number | null
  /** Recent closes for a tiny sparkline (oldest → newest). */
  sparkline: number[]
  observedAt: number
  source: string
  sourceLabel: string
}

export type GasTier = {
  gwei: number
  priorityFee: number
  estimatedSeconds: number
}

export type GasSnap = {
  standard: GasTier
  fast: GasTier
  rapid: GasTier
  /** @deprecated Prefer standard.gwei — kept for older call sites. */
  standardGwei: number
  baseFee: number
  blockNumber: number | null
  observedAt: number
  source: string
  sourceLabel: string
  percentiles: readonly number[]
}

export const PRICE_REFRESH_MS = 10_000
export const GAS_REFRESH_MS = 12_000
export const GAS_PERCENTILES = [20, 40, 60] as const

const COINBASE = "https://api.exchange.coinbase.com/products/ETH-USD"
const COINGECKO =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum&price_change_percentage=1h,24h,7d"
const GAS_RPCS = [
  "https://rpc.mevblocker.io",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
] as const
const FEE_HISTORY_BLOCKS = 20
const SECONDS = { standard: 36, fast: 24, rapid: 12 } as const
const GWEI = 1e9

async function getJson(url: string, init?: RequestInit, timeoutMs = 8000): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100_000_000
}

export function percentChange(current: number, past: number | null | undefined): number | null {
  if (!validPrice(current) || past == null || !validPrice(past)) return null
  return ((current - past) / past) * 100
}

/** Coinbase candle: [startSeconds, low, high, open, close, volume]. */
type Candle = [number, number, number, number, number, number]

function parseCandles(payload: unknown): Candle[] {
  if (!Array.isArray(payload)) return []
  return payload.filter(
    (row): row is Candle =>
      Array.isArray(row) &&
      row.length >= 5 &&
      row.slice(0, 5).every((value) => typeof value === "number" && Number.isFinite(value)),
  )
}

function priceAt(candles: Candle[], atMs: number, granularitySec: number): number | null {
  const at = atMs / 1000
  for (const candle of candles) {
    const [start, , , open, close] = candle
    if (at >= start && at < start + granularitySec) {
      if (!validPrice(open) || !validPrice(close)) return null
      const fraction = (at - start) / granularitySec
      return open + (close - open) * fraction
    }
  }
  return null
}

function sparklineFromCandles(candles: Candle[], limit = 48): number[] {
  const closes = candles
    .map((row) => row[4])
    .filter((value): value is number => validPrice(value))
    .reverse()
  if (closes.length <= limit) return closes
  return closes.slice(closes.length - limit)
}

async function ethFromCoinbase(): Promise<EthSnap> {
  const [ticker, minute, quarter, hour] = await Promise.all([
    getJson(`${COINBASE}/ticker`) as Promise<{ price?: unknown; time?: unknown }>,
    getJson(`${COINBASE}/candles?granularity=60`) as Promise<unknown>,
    getJson(`${COINBASE}/candles?granularity=900`) as Promise<unknown>,
    getJson(`${COINBASE}/candles?granularity=3600`) as Promise<unknown>,
  ])
  const price = typeof ticker?.price === "string" ? Number(ticker.price) : ticker?.price
  if (!validPrice(price)) throw new Error("Coinbase returned an invalid price")
  const time = typeof ticker.time === "string" ? Date.parse(ticker.time) : NaN
  const observedAt = Number.isFinite(time) ? Math.min(time, Date.now()) : Date.now()
  const minutes = parseCandles(minute)
  const quarters = parseCandles(quarter)
  const hours = parseCandles(hour)
  return {
    priceUsd: price,
    change1h: percentChange(price, priceAt(minutes, observedAt - 60 * 60_000, 60)),
    change24h: percentChange(price, priceAt(quarters, observedAt - 24 * 60 * 60_000, 900)),
    change7d: percentChange(price, priceAt(hours, observedAt - 7 * 24 * 60 * 60_000, 3600)),
    sparkline: sparklineFromCandles(quarters),
    observedAt,
    source: "coinbase",
    sourceLabel: "Coinbase Exchange ETH-USD",
  }
}

async function ethFromCoinGecko(): Promise<EthSnap> {
  const payload = await getJson(COINGECKO)
  const row = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined
  if (!row || !validPrice(row.current_price)) throw new Error("CoinGecko returned an invalid price")
  const updated = typeof row.last_updated === "string" ? Date.parse(row.last_updated) : NaN
  const pick = (key: string) => (typeof row[key] === "number" && Number.isFinite(row[key]) ? (row[key] as number) : null)
  return {
    priceUsd: row.current_price,
    change1h: pick("price_change_percentage_1h_in_currency"),
    change24h: pick("price_change_percentage_24h_in_currency") ?? pick("price_change_percentage_24h"),
    change7d: pick("price_change_percentage_7d_in_currency"),
    sparkline: [],
    observedAt: Number.isFinite(updated) ? Math.min(updated, Date.now()) : Date.now(),
    source: "coingecko",
    sourceLabel: "CoinGecko",
  }
}

export async function fetchEthSnap(): Promise<EthSnap> {
  try {
    return await ethFromCoinbase()
  } catch {
    return ethFromCoinGecko()
  }
}

function hexGwei(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null
  const parsed = Number(BigInt(value)) / GWEI
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

type FeeHistory = {
  oldestBlock: string
  baseFeePerGas: string[]
  gasUsedRatio: number[]
  reward?: string[][]
}

function estimateFromFeeHistory(history: FeeHistory, source: string, sourceLabel: string): GasSnap {
  if (!Array.isArray(history.baseFeePerGas) || history.baseFeePerGas.length === 0 || !Array.isArray(history.reward)) {
    throw new Error("Fee history is missing base fees or rewards")
  }
  const baseFee = hexGwei(history.baseFeePerGas[history.baseFeePerGas.length - 1])
  if (baseFee == null) throw new Error("Fee history base fee is malformed")
  const tips: number[][] = [[], [], []]
  history.reward.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 3) return
    if (Array.isArray(history.gasUsedRatio) && history.gasUsedRatio[index] === 0) return
    const parsed = row.slice(0, 3).map(hexGwei)
    if (parsed.some((item) => item == null)) return
    parsed.forEach((item, slot) => tips[slot].push(item as number))
  })
  if (tips[0].length === 0) throw new Error("Fee history has no usable blocks")
  const standardTip = median(tips[0])
  const fastTip = Math.max(standardTip, median(tips[1]))
  const rapidTip = Math.max(fastTip, median(tips[2]))
  const tier = (tip: number, seconds: number): GasTier => ({
    gwei: baseFee + tip,
    priorityFee: tip,
    estimatedSeconds: seconds,
  })
  const oldest = typeof history.oldestBlock === "string" ? Number.parseInt(history.oldestBlock, 16) : NaN
  const standard = tier(standardTip, SECONDS.standard)
  return {
    standard,
    fast: tier(fastTip, SECONDS.fast),
    rapid: tier(rapidTip, SECONDS.rapid),
    standardGwei: standard.gwei,
    baseFee,
    blockNumber: Number.isFinite(oldest) ? oldest + history.reward.length - 1 : null,
    observedAt: Date.now(),
    source,
    sourceLabel,
    percentiles: GAS_PERCENTILES,
  }
}

async function gasFromRpc(url: string): Promise<GasSnap> {
  const host = new URL(url).host
  const response = await fetch(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_feeHistory",
      params: [`0x${FEE_HISTORY_BLOCKS.toString(16)}`, "latest", [...GAS_PERCENTILES]],
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as { result?: FeeHistory; error?: { message?: string } }
  if (body.error || !body.result) throw new Error(body.error?.message || "RPC fee history failed")
  return estimateFromFeeHistory(body.result, host, `Ethereum fee history (${host})`)
}

export async function fetchGasSnap(): Promise<GasSnap> {
  let last: Error | null = null
  for (const url of GAS_RPCS) {
    try {
      return await gasFromRpc(url)
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw last ?? new Error("All gas RPCs failed")
}

export function formatEthPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatChange(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  const rounded = Math.round(value * 100) / 100
  if (rounded === 0) return "0.00%"
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded).toFixed(2)}%`
}

export function changeTone(value: number | null | undefined): "up" | "down" | "flat" {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) return "flat"
  return value > 0 ? "up" : "down"
}

/** Under 1 gwei: three decimals; 1+: one decimal. */
export function formatGwei(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—"
  if (value === 0) return "0"
  if (value >= 100) return Math.round(value).toLocaleString("en-US")
  if (value >= 1) return value.toFixed(1)
  if (value >= 0.001) return value.toFixed(3)
  return Number(value.toPrecision(2)).toString()
}

export function formatAge(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—"
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatAgo(ms: number | null | undefined): string {
  const age = formatAge(ms)
  return age === "—" ? age : `${age} ago`
}

export function sparklinePath(values: number[], width: number, height: number): string {
  if (values.length < 2) return ""
  let min = values[0]
  let max = values[0]
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - ((value - min) / span) * height
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
}
