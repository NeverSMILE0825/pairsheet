import { fetchJson } from "./http"
import { netQuoteFlow } from "./team-labels"

const CORE = "https://www.dextools.io/api/core"
const PAGE_LIMIT = 100

export type BotCursor = { blockNumber: number; logIndex: number }

export type BotEvent = {
  id: string
  logIndex: number
  blockNumber: number
  bot: boolean
}

/** DEXTools `others.bot` key: transaction hash plus the swap log index. */
export function botEventKey(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`
}

/** DEXTools still requests BNB Chain as `bsc`. Every other id matches ours. */
export function dextoolsChain(chainId: string): string {
  return chainId === "bnb" ? "bsc" : chainId
}

export function dextoolsEventsUrl(chainId: string, pool: string, cursor: BotCursor | null): string {
  const chain = dextoolsChain(chainId)
  const address = /^0x/i.test(pool) ? pool.toLowerCase() : pool
  const cursorQuery = cursor ? `blockNumber=${cursor.blockNumber}&logIndex=${cursor.logIndex}&` : ""
  return `${CORE}/pool/events/${encodeURIComponent(chain)}/${encodeURIComponent(address)}/newest?${cursorQuery}limit=${PAGE_LIMIT}`
}

export function readBotEvents(body: unknown): { events: BotEvent[]; next: BotCursor | null } {
  const data = body && typeof body === "object" && "data" in body ? (body as { data?: unknown }).data : body
  const record = data && typeof data === "object" ? (data as { events?: unknown; next?: unknown }) : {}
  const rawEvents = Array.isArray(record.events) ? record.events : []
  const events: BotEvent[] = []
  for (const item of rawEvents) {
    if (!item || typeof item !== "object") continue
    const row = item as { id?: unknown; logIndex?: unknown; blockNumber?: unknown; others?: { bot?: unknown } }
    if (typeof row.id !== "string" || typeof row.logIndex !== "number") continue
    events.push({
      id: row.id,
      logIndex: row.logIndex,
      blockNumber: typeof row.blockNumber === "number" ? row.blockNumber : 0,
      bot: row.others?.bot === true,
    })
  }
  const nextRaw = record.next
  const next =
    nextRaw &&
    typeof nextRaw === "object" &&
    typeof (nextRaw as { blockNumber?: unknown }).blockNumber === "number" &&
    typeof (nextRaw as { logIndex?: unknown }).logIndex === "number"
      ? {
          blockNumber: (nextRaw as { blockNumber: number }).blockNumber,
          logIndex: (nextRaw as { logIndex: number }).logIndex,
        }
      : null
  return { events, next }
}

/**
 * Walk DEXTools' own swap tape and keep each row's Bot / Smart contract flag.
 * `stopBeforeBlock` ends the walk once events are older than that block, for an update.
 */
export async function fetchDextoolsBotFlags(
  chainId: string,
  pool: string,
  options: { stopBeforeBlock?: number; onProgress?: (matched: number) => void } = {},
): Promise<Map<string, boolean>> {
  const flags = new Map<string, boolean>()
  const seen = new Set<string>()
  let cursor: BotCursor | null = null
  for (let page = 0; page < 5000; page += 1) {
    const body = await fetchJson(dextoolsEventsUrl(chainId, pool, cursor), {
      headers: { "X-API-Version": "2", "user-agent": "Mozilla/5.0" },
    })
    const parsed = readBotEvents(body)
    let stop = false
    for (const event of parsed.events) {
      if (options.stopBeforeBlock != null && event.blockNumber < options.stopBeforeBlock) {
        stop = true
        break
      }
      flags.set(botEventKey(event.id, event.logIndex), event.bot)
    }
    options.onProgress?.(flags.size)
    if (stop || !parsed.next) break
    const mark = `${parsed.next.blockNumber}:${parsed.next.logIndex}`
    if (seen.has(mark)) break
    seen.add(mark)
    cursor = parsed.next
  }
  return flags
}

export function applyDextoolsBots<T extends { txHash: string; logIndex: number; dextoolsBot?: boolean | null }>(
  trades: T[],
  flags: Map<string, boolean>,
): T[] {
  let changed = false
  const next = trades.map((trade) => {
    const value = flags.get(botEventKey(trade.txHash, trade.logIndex))
    if (value === undefined || trade.dextoolsBot === value) return trade
    changed = true
    return { ...trade, dextoolsBot: value }
  })
  return changed ? next : trades
}

export type DextoolsBotProfit = {
  withProfit: string
  withoutProfit: string
  withBuys: number
  withSells: number
  withoutBuys: number
  withoutSells: number
  unknown: number
}

/** Buys add the quote amount. Sells subtract it. Rows DEXTools did not return stay out of both totals. */
export function summarizeDextoolsBotProfit(
  trades: Array<{ type: string; quoteAmount: string; dextoolsBot?: boolean | null }>,
): DextoolsBotProfit {
  const withIcon: Array<{ type: string; quoteAmount: string }> = []
  const without: Array<{ type: string; quoteAmount: string }> = []
  let unknown = 0
  let withBuys = 0
  let withSells = 0
  let withoutBuys = 0
  let withoutSells = 0
  for (const trade of trades) {
    if (trade.type !== "BUY" && trade.type !== "SELL") continue
    if (trade.dextoolsBot === true) {
      withIcon.push(trade)
      if (trade.type === "BUY") withBuys += 1
      else withSells += 1
    } else if (trade.dextoolsBot === false) {
      without.push(trade)
      if (trade.type === "BUY") withoutBuys += 1
      else withoutSells += 1
    } else unknown += 1
  }
  return {
    withProfit: netQuoteFlow(withIcon),
    withoutProfit: netQuoteFlow(without),
    withBuys,
    withSells,
    withoutBuys,
    withoutSells,
    unknown,
  }
}
