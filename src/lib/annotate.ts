import { normalizeAddress } from "./format"
import type { ContractInfo } from "./wallets"
import type { MakerTag, Trade } from "./types"

export type WalletFacts = {
  contracts: Record<string, ContractInfo>
  deployer: string | null
}

export const EMPTY_FACTS: WalletFacts = { contracts: {}, deployer: null }

// Routers that carry the most trades first, so a capped lookup covers the bulk of the tape.
export function routersToCheck(trades: Trade[], poolAddress: string, limit: number): string[] {
  const counts = new Map<string, number>()
  for (const trade of trades) {
    const router = normalizeAddress(trade.router)
    if (!router || router === normalizeAddress(poolAddress)) continue
    counts.set(router, (counts.get(router) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([router]) => router)
}

// Adds the per-wallet transaction count and the Bot / Team tags.
//  - bot: the transaction went straight to the pool, or through a contract whose
//    source is not published (public routers are verified, private bots are not).
//  - team: the wallet deployed the token, or added the pool's first liquidity.
export function annotateTrades(trades: Trade[], poolAddress: string, facts: WalletFacts): Trade[] {
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

  const tagged = trades.map((trade) => {
    const maker = normalizeAddress(trade.maker)
    const router = normalizeAddress(trade.router)
    const info = router ? facts.contracts[router] : undefined
    const tags: MakerTag[] = []
    if (router && (router === normalizeAddress(poolAddress) || (info?.contract && !info.verified))) tags.push("bot")
    if (maker && teamWallets.has(maker)) tags.push("team")
    return { ...trade, makerTxCount: counts.get(maker) ?? 0, makerTags: tags }
  })
  return assignTxNumbers(tagged)
}

/** Oldest loaded trade is 1; same-block ties break on log index. Numbers stay with the row when sorting. */
export function assignTxNumbers(trades: Trade[]): Trade[] {
  const ranked = [...trades].sort(
    (a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex || a.id.localeCompare(b.id),
  )
  const numbers = new Map(ranked.map((trade, index) => [trade.id, index + 1]))
  return trades.map((trade) => ({ ...trade, txNo: numbers.get(trade.id) ?? 0 }))
}
