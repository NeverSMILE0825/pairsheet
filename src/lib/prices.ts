import { fetchJson } from "./http"

const STABLES = new Set([
  "usdt",
  "usdc",
  "dai",
  "busd",
  "tusd",
  "usdp",
  "fdusd",
  "usde",
  "usds",
  "usd1",
  "gusd",
  "usdd",
  "frax",
  "lusd",
  "crvusd",
  "pyusd",
  "usdbc",
  "usdce",
  "usdt0",
  "usdc.e",
  "usdt.e",
  "axlusdc",
  "mim",
  "gho",
  "susd",
  "dola",
  "usdb",
  "usdm",
])

export function isStableSymbol(symbol: string): boolean {
  const normalized = symbol.toLowerCase().replace(/\s+/g, "")
  return STABLES.has(normalized) || STABLES.has(normalized.replace(".", ""))
}

type PricePoint = { timestamp: number; price: number }

export async function quotePricesAt(
  llamaChain: string,
  tokenAddress: string,
  symbol: string,
  timestamps: number[],
  wrappedNative: string | null = null,
): Promise<Map<number, number | null>> {
  const prices = new Map<number, number | null>()
  if (timestamps.length === 0) return prices
  if (isStableSymbol(symbol)) {
    for (const timestamp of timestamps) prices.set(timestamp, 1)
    return prices
  }

  const priced =
    isNativeAddress(tokenAddress) && wrappedNative ? wrappedNative : tokenAddress
  const points = await loadChart(llamaChain, priced, timestamps)
  for (const timestamp of timestamps) {
    prices.set(timestamp, nearestPrice(points, timestamp))
  }
  return prices
}

function isNativeAddress(address: string): boolean {
  return /^0x0{40}$/i.test(address)
}

async function loadChart(
  llamaChain: string,
  tokenAddress: string,
  timestamps: number[],
): Promise<PricePoint[]> {
  const min = Math.min(...timestamps)
  const max = Math.max(...timestamps)
  const hours = Math.ceil((max - min) / 3600) + 3
  const coin = `${llamaChain}:${tokenAddress.toLowerCase()}`

  if (hours <= 168) {
    return fetchChart(coin, min - 3600, hours, "1h")
  }

  const days = Math.ceil((max - min) / 86400) + 2
  if (days <= 400) {
    return fetchChart(coin, min - 86400, days, "1d")
  }

  const points: PricePoint[] = []
  const window = 400 * 86400
  for (let start = min - 86400; start <= max; start += window) {
    const span = Math.min(400, Math.ceil((max - start) / 86400) + 2)
    const chunk = await fetchChart(coin, start, span, "1d")
    points.push(...chunk)
  }
  return points
}

async function fetchChart(
  coin: string,
  start: number,
  span: number,
  period: "1h" | "1d",
): Promise<PricePoint[]> {
  const safeSpan = Math.max(2, Math.min(span, 500))
  const url = `https://coins.llama.fi/chart/${coin}?start=${Math.floor(start)}&span=${safeSpan}&period=${period}`
  try {
    const body = (await fetchJson(url)) as {
      coins?: Record<string, { prices?: PricePoint[] }>
    }
    const entry = body.coins ? Object.values(body.coins)[0] : undefined
    return (entry?.prices ?? []).filter(
      (point) => Number.isFinite(point.timestamp) && Number.isFinite(point.price),
    )
  } catch {
    return []
  }
}

function nearestPrice(points: PricePoint[], timestamp: number): number | null {
  if (points.length === 0) return null
  let best = points[0]
  let bestDistance = Math.abs(points[0].timestamp - timestamp)
  for (const point of points) {
    const distance = Math.abs(point.timestamp - timestamp)
    if (distance < bestDistance) {
      best = point
      bestDistance = distance
    }
  }
  if (bestDistance > 36 * 3600) return null
  return best.price
}
