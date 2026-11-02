import { assignGasFeeTotals } from "./gas-fees"
import { normalizeAddress } from "./format"
import type { ContractInfo } from "./wallets"
import type { MakerTag, Trade } from "./types"

export type WalletFacts = {
  contracts: Record<string, ContractInfo>
  deployer: string | null
}

export type AnnotateOptions = {
  /** Uniswap V4 PoolManager (or other singleton the pair routes through). */
  poolManager?: string | null
}

export const EMPTY_FACTS: WalletFacts = { contracts: {}, deployer: null }

// Routers that carry the most trades first, so a capped lookup covers the bulk of the tape.
export function routersToCheck(trades: Trade[], poolAddress: string, limit: number): string[] {
  const pool = normalizeAddress(poolAddress)
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const router = normalizeAddress(trade.router)
    if (!router || router === pool) continue
    counts.set(router, (counts.get(router) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([router]) => router)
}

/** Top makers by tx count — used to detect contract/MEV wallets (not only routers). */
export function makersToCheck(trades: Trade[], limit: number): string[] {
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const maker = normalizeAddress(trade.maker)
    if (!maker) continue
    counts.set(maker, (counts.get(maker) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([maker]) => maker)
}

/**
 * Same-block buy+sell by one maker with another trader in between → classic sandwich.
 * Also flags same-block buy+sell even without a clear victim (arb / backrun style).
 */
export function sandwichBotTradeIds(trades: Trade[]): Set<string> {
  const byBlock = new Map<number, Trade[]>()
  for (const trade of trades) {
    if (trade.type !== "BUY" && trade.type !== "SELL") continue
    const list = byBlock.get(trade.blockNumber)
    if (list) list.push(trade)
    else byBlock.set(trade.blockNumber, [trade])
  }

  const botIds = new Set<string>()
  for (const rows of byBlock.values()) {
    if (rows.length < 2) continue
    const ordered = [...rows].sort((a, b) => a.logIndex - b.logIndex || a.id.localeCompare(b.id))
    const byMaker = new Map<string, Trade[]>()
    for (const trade of ordered) {
      const maker = normalizeAddress(trade.maker)
      if (!maker) continue
      const list = byMaker.get(maker)
      if (list) list.push(trade)
      else byMaker.set(maker, [trade])
    }
    for (const [maker, mine] of byMaker) {
      const hasBuy = mine.some((trade) => trade.type === "BUY")
      const hasSell = mine.some((trade) => trade.type === "SELL")
      if (!hasBuy || !hasSell) continue
      const first = mine[0].logIndex
      const last = mine[mine.length - 1].logIndex
      const hasVictim = ordered.some((trade) => {
        if (trade.logIndex <= first || trade.logIndex >= last) return false
        return normalizeAddress(trade.maker) !== maker
      })
      // Same-block buy+sell is enough for a bot mark; victim between makes it definitive.
      if (hasVictim || mine.length >= 2) {
        for (const trade of mine) botIds.add(trade.id)
      }
    }
  }
  return botIds
}

/**
 * Adds the per-wallet transaction count and the Bot / Team tags.
 * Bot when any of:
 *  - tx.to is the pair / V4 PoolManager (direct pool hit, no public router)
 *  - tx.to is an unverified contract (private MEV / sniper router)
 *  - maker is an unverified contract
 *  - same-block sandwich / buy+sell pattern (see sandwichBotTradeIds)
 * Team: token deployer or first liquidity adder.
 */
export function annotateTrades(
  trades: Trade[],
  poolAddress: string,
  facts: WalletFacts,
  options: AnnotateOptions = {},
): Trade[] {
  const counts = new Map<string, number>()
  let firstLiquidity: Trade | null = null
  for (const trade of trades) {
    const maker = normalizeAddress(trade.maker)
    if (maker) counts.set(maker, (counts.get(maker) ?? 0) + 1)
    if (trade.type === "ADD" && trade.maker) {
      if (
        !firstLiquidity ||
        trade.blockNumber < firstLiquidity.blockNumber ||
        (trade.blockNumber === firstLiquidity.blockNumber && trade.logIndex < firstLiquidity.logIndex)
      ) {
        firstLiquidity = trade
      }
    }
  }
  const teamWallets = new Set<string>()
  if (facts.deployer) teamWallets.add(normalizeAddress(facts.deployer))
  if (firstLiquidity) teamWallets.add(normalizeAddress(firstLiquidity.maker))

  const directTargets = new Set<string>()
  if (poolAddress) directTargets.add(normalizeAddress(poolAddress))
  if (options.poolManager) directTargets.add(normalizeAddress(options.poolManager))

  const sandwichIds = sandwichBotTradeIds(trades)

  const tagged = trades.map((trade) => {
    const maker = normalizeAddress(trade.maker)
    const router = normalizeAddress(trade.router)
    const routerInfo = router ? facts.contracts[router] : undefined
    const makerInfo = maker ? facts.contracts[maker] : undefined
    const tags: MakerTag[] = []

    const directHit = Boolean(router && directTargets.has(router))
    const shadyRouter = Boolean(routerInfo?.contract && !routerInfo.verified)
    const shadyMaker = Boolean(makerInfo?.contract && !makerInfo.verified)
    const sandwich = sandwichIds.has(trade.id)
    if (directHit || shadyRouter || shadyMaker || sandwich) tags.push("bot")
    if (maker && teamWallets.has(maker)) tags.push("team")
    return { ...trade, makerTxCount: counts.get(maker) ?? 0, makerTags: tags }
  })
  return assignGasFeeTotals(assignTxNumbers(tagged))
}

/** Oldest loaded trade is 1; same-block ties break on log index. Numbers stay with the row when sorting. */
export function assignTxNumbers(trades: Trade[]): Trade[] {
  const ranked = [...trades].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex || a.id.localeCompare(b.id),
  )
  const numbers = new Map(ranked.map((trade, index) => [trade.id, index + 1]))
  return trades.map((trade) => ({ ...trade, txNo: numbers.get(trade.id) ?? 0 }))
}
