import type { ChainConfig } from "./chains"
import { decodeWord, isV2Family, sameAddress } from "./decode"
import { formatUnits } from "./format"
import { fetchJson, mapPool, rpcBatch } from "./http"
import type { PoolContext, RawLog } from "./types"

export const SYNC_TOPIC = "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1"
const Q96 = 1n << 96n

export type PoolSize = {
  base: string
  quote: string
}

export type SyncEvent = { logIndex: number; reserve0: bigint; reserve1: bigint }

const ROUTESCAN_PAGE = 1000
const MAX_SYNC_PAGES = 12
const BALANCE_OF = "0x70a08231"

// Pool size right after each swap, keyed by "<txHash>-<logIndex>" of the swap.
// Uniswap V2 style pools emit Sync(reserve0, reserve1) immediately before every
// Swap, so those reserves are the exact pool size after that trade. Concentrated
// liquidity pools do not emit reserves, so their size is the pair of token
// balances the pool holds at the end of the swap's block.
// Uniswap V4 keeps tokens in a shared PoolManager — sqrtPrice×liquidity are
// *virtual* reserves (often ~1 ETH at init even when no ETH was added). Actual
// Pool columns are filled later by finalizeV4Tape ledger math.
export async function loadPoolSizes(
  chain: ChainConfig,
  pool: PoolContext,
  logs: RawLog[],
): Promise<Map<string, PoolSize>> {
  const sizes = new Map<string, PoolSize>()
  if (pool.style === "v4") return sizes
  const v2 = logs.filter((log) => isV2Family(log.topics[0] || ""))
  const v3 = logs.filter((log) => !isV2Family(log.topics[0] || ""))
  await Promise.all([fillFromSync(chain, pool, v2, sizes), fillFromBalances(chain, pool, v3, sizes)])
  return sizes
}

/** Virtual token0/token1 amounts from V4 Swap(sqrtPriceX96, liquidity). */
export function v4VirtualReserves(data: string): { amount0: bigint; amount1: bigint } | null {
  try {
    const sqrtPriceX96 = decodeWord(data, 2)
    const liquidity = decodeWord(data, 3)
    if (sqrtPriceX96 === 0n || liquidity === 0n) return null
    return {
      amount0: (liquidity * Q96) / sqrtPriceX96,
      amount1: (liquidity * sqrtPriceX96) / Q96,
    }
  } catch {
    return null
  }
}

async function fillFromSync(
  chain: ChainConfig,
  pool: PoolContext,
  swaps: RawLog[],
  sizes: Map<string, PoolSize>,
) {
  if (swaps.length === 0) return
  const byTx = new Map<string, SyncEvent[]>()

  if (chain.routescan) {
    const blocks = swaps.map((log) => log.blockNumber).filter((block) => block > 0)
    if (blocks.length > 0) {
      await readRoutescanSync(chain, pool.address, Math.min(...blocks), Math.max(...blocks), byTx).catch(() => undefined)
    }
  }

  assignSync(pool, swaps, byTx, sizes)

  const missing = swaps.filter((log) => !sizes.has(swapKey(log)))
  if (missing.length === 0) return
  const hashes = [...new Set(missing.map((log) => log.txHash.toLowerCase()))]
  await readReceiptSync(chain, pool.address, hashes, byTx)
  assignSync(pool, missing, byTx, sizes)

  const stillMissing = missing.filter((log) => !sizes.has(swapKey(log)))
  if (stillMissing.length === 0 || !chain.blockscout) return
  const rest = [...new Set(stillMissing.map((log) => log.txHash.toLowerCase()))]
  await readBlockscoutSync(chain.blockscout, pool.address, rest, byTx)
  assignSync(pool, stillMissing, byTx, sizes)
}

export function swapKey(log: RawLog): string {
  return `${log.txHash.toLowerCase()}-${log.logIndex}`
}

export function assignSync(
  pool: PoolContext,
  swaps: RawLog[],
  byTx: Map<string, SyncEvent[]>,
  sizes: Map<string, PoolSize>,
) {
  const baseIs0 = sameAddress(pool.token0, pool.base.address)
  for (const swap of swaps) {
    const events = byTx.get(swap.txHash.toLowerCase())
    if (!events) continue
    let match: SyncEvent | null = null
    for (const event of events) {
      if (event.logIndex < swap.logIndex && (!match || event.logIndex > match.logIndex)) match = event
    }
    if (!match) continue
    const baseRaw = baseIs0 ? match.reserve0 : match.reserve1
    const quoteRaw = baseIs0 ? match.reserve1 : match.reserve0
    sizes.set(swapKey(swap), {
      base: formatUnits(baseRaw, pool.base.decimals),
      quote: formatUnits(quoteRaw, pool.quote.decimals),
    })
  }
}

export function recordSync(byTx: Map<string, SyncEvent[]>, txHash: string, logIndex: number, data: string) {
  try {
    const event = { logIndex, reserve0: decodeWord(data, 0), reserve1: decodeWord(data, 1) }
    const key = txHash.toLowerCase()
    const list = byTx.get(key)
    if (list) list.push(event)
    else byTx.set(key, [event])
  } catch {
    return
  }
}

async function readRoutescanSync(
  chain: ChainConfig,
  address: string,
  fromBlock: number,
  toBlock: number,
  byTx: Map<string, SyncEvent[]>,
) {
  for (let page = 1; page <= MAX_SYNC_PAGES; page += 1) {
    const params = new URLSearchParams({
      module: "logs",
      action: "getLogs",
      address,
      fromBlock: String(fromBlock),
      toBlock: String(toBlock),
      topic0: SYNC_TOPIC,
      page: String(page),
      offset: String(ROUTESCAN_PAGE),
    })
    const url = `https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`
    const body = (await fetchJson(url)) as { result?: unknown }
    if (!Array.isArray(body.result)) return
    for (const row of body.result) {
      const log = row as Record<string, unknown>
      if (typeof log.data !== "string" || typeof log.transactionHash !== "string") continue
      recordSync(byTx, log.transactionHash, hexNumber(log.logIndex), log.data)
    }
    if (body.result.length < ROUTESCAN_PAGE) return
  }
}

async function readReceiptSync(
  chain: ChainConfig,
  address: string,
  hashes: string[],
  byTx: Map<string, SyncEvent[]>,
) {
  if (chain.rpcs.length === 0) return
  const batches: string[][] = []
  for (let index = 0; index < hashes.length; index += 20) batches.push(hashes.slice(index, index + 20))
  await mapPool(batches, 3, async (batch) => {
    for (const rpc of chain.rpcs) {
      try {
        const results = await rpcBatch(
          rpc,
          batch.map((hash) => ({ method: "eth_getTransactionReceipt", params: [hash] })),
        )
        let complete = true
        results.forEach((receipt, id) => {
          const hash = batch[id]
          const logs = (receipt as { logs?: Record<string, unknown>[] } | undefined)?.logs
          if (!hash || !Array.isArray(logs)) return
          for (const log of logs) {
            const topics = Array.isArray(log.topics) ? (log.topics as string[]) : []
            if (typeof log.address !== "string" || !sameAddress(log.address, address)) continue
            if ((topics[0] || "").toLowerCase() !== SYNC_TOPIC || typeof log.data !== "string") continue
            recordSync(byTx, hash, hexNumber(log.logIndex), log.data)
          }
        })
        for (const hash of batch) if (!byTx.has(hash)) complete = false
        if (complete) return
      } catch {
        continue
      }
    }
  })
}

async function readBlockscoutSync(host: string, address: string, hashes: string[], byTx: Map<string, SyncEvent[]>) {
  await mapPool(hashes.slice(0, 200), 4, async (hash) => {
    try {
      const body = (await fetchJson(`${host}/api/v2/transactions/${hash}/logs`, undefined, 10000, 1)) as {
        items?: Record<string, unknown>[]
      }
      for (const item of body.items ?? []) {
        const emitter = item.address as { hash?: string } | string | undefined
        const from = typeof emitter === "string" ? emitter : emitter?.hash
        const topics = Array.isArray(item.topics) ? (item.topics as (string | null)[]) : []
        if (!from || !sameAddress(from, address) || typeof item.data !== "string") continue
        if ((topics[0] || "").toLowerCase() !== SYNC_TOPIC) continue
        recordSync(byTx, hash, Number(item.index) || 0, item.data)
      }
    } catch {
      return
    }
  })
}

async function fillFromBalances(
  chain: ChainConfig,
  pool: PoolContext,
  swaps: RawLog[],
  sizes: Map<string, PoolSize>,
) {
  if (swaps.length === 0 || chain.rpcs.length === 0) return
  const blocks = [...new Set(swaps.map((log) => log.blockNumber).filter((block) => block > 0))]
  const padded = `000000000000000000000000${pool.address.slice(2).toLowerCase()}`
  const balances = new Map<number, { base: bigint; quote: bigint }>()

  await mapPool(chunk(blocks, 10), 2, async (group) => {
    const calls = group.flatMap((block) => [
      { method: "eth_call", params: [{ to: pool.base.address, data: BALANCE_OF + padded }, `0x${block.toString(16)}`] },
      { method: "eth_call", params: [{ to: pool.quote.address, data: BALANCE_OF + padded }, `0x${block.toString(16)}`] },
    ])
    for (const rpc of chain.rpcs) {
      try {
        const results = await rpcBatch(rpc, calls)
        let complete = true
        group.forEach((block, index) => {
          const base = results.get(index * 2)
          const quote = results.get(index * 2 + 1)
          if (typeof base === "string" && typeof quote === "string" && base.length > 2 && quote.length > 2) {
            balances.set(block, { base: BigInt(base), quote: BigInt(quote) })
          } else {
            complete = false
          }
        })
        if (complete) return
      } catch {
        continue
      }
    }
  })

  for (const swap of swaps) {
    const found = balances.get(swap.blockNumber)
    if (!found) continue
    sizes.set(swapKey(swap), {
      base: formatUnits(found.base, pool.base.decimals),
      quote: formatUnits(found.quote, pool.quote.decimals),
    })
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

function hexNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value !== "string") return 0
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10) || 0
}
