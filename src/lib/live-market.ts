/** Live ETH/USD and Ethereum standard gas for the header widgets (browser-side). */

export type EthSnap = {
  priceUsd: number
  change24h: number | null
  observedAt: number
  source: string
}

export type GasSnap = {
  /** Standard total gas price in gwei (base + tip). */
  standardGwei: number
  baseFee: number
  observedAt: number
  source: string
}

export const PRICE_REFRESH_MS = 10_000
export const GAS_REFRESH_MS = 12_000

const COINBASE = "https://api.exchange.coinbase.com/products/ETH-USD"
const COINGECKO =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=ethereum&price_change_percentage=24h"
const GAS_RPCS = [
  "https://rpc.mevblocker.io",
  "https://eth.drpc.org",
  "https://ethereum-rpc.publicnode.com",
] as const
const FEE_HISTORY_BLOCKS = 20
const GAS_PERCENTILES = [20, 40, 60] as const
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

async function ethFromCoinbase(): Promise<EthSnap> {
  const [ticker, candles] = await Promise.all([
    getJson(`${COINBASE}/ticker`) as Promise<{ price?: unknown; time?: unknown }>,
    getJson(`${COINBASE}/candles?granularity=900`) as Promise<unknown>,
  ])
  const price = typeof ticker?.price === "string" ? Number(ticker.price) : ticker?.price
  if (!validPrice(price)) throw new Error("Coinbase returned an invalid price")
  const time = typeof ticker.time === "string" ? Date.parse(ticker.time) : NaN
  const observedAt = Number.isFinite(time) ? Math.min(time, Date.now()) : Date.now()
  const past = priceAt(parseCandles(candles), observedAt - 24 * 60 * 60_000, 900)
  return {
    priceUsd: price,
    change24h: percentChange(price, past),
    observedAt,
    source: "coinbase",
  }
}

async function ethFromCoinGecko(): Promise<EthSnap> {
  const payload = await getJson(COINGECKO)
  const row = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : undefined
  if (!row || !validPrice(row.current_price)) throw new Error("CoinGecko returned an invalid price")
  const updated = typeof row.last_updated === "string" ? Date.parse(row.last_updated) : NaN
  const change =
    typeof row.price_change_percentage_24h_in_currency === "number"
      ? row.price_change_percentage_24h_in_currency
      : typeof row.price_change_percentage_24h === "number"
        ? row.price_change_percentage_24h
        : null
  return {
    priceUsd: row.current_price,
    change24h: change != null && Number.isFinite(change) ? change : null,
    observedAt: Number.isFinite(updated) ? Math.min(updated, Date.now()) : Date.now(),
    source: "coingecko",
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

function standardFromFeeHistory(history: FeeHistory, source: string): GasSnap {
  if (!Array.isArray(history.baseFeePerGas) || history.baseFeePerGas.length === 0 || !Array.isArray(history.reward)) {
    throw new Error("Fee history is missing base fees or rewards")
  }
  const baseFee = hexGwei(history.baseFeePerGas[history.baseFeePerGas.length - 1])
  if (baseFee == null) throw new Error("Fee history base fee is malformed")
  const tips: number[] = []
  history.reward.forEach((row, index) => {
    if (!Array.isArray(row) || row.length < 1) return
    if (Array.isArray(history.gasUsedRatio) && history.gasUsedRatio[index] === 0) return
    const tip = hexGwei(row[0])
    if (tip != null) tips.push(tip)
  })
  if (tips.length === 0) throw new Error("Fee history has no usable blocks")
  return {
    standardGwei: baseFee + median(tips),
    baseFee,
    observedAt: Date.now(),
    source,
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
  return standardFromFeeHistory(body.result, host)
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
