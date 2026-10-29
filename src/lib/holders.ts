import type { ChainConfig } from "./chains"
import { sameAddress } from "./decode"
import { fetchJson, mapPool } from "./http"
import type { PoolView, Trade } from "./types"

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
const ZERO = "0x0000000000000000000000000000000000000000"
/** Common burn / null sinks — never counted as holders. */
const DEAD = "0x000000000000000000000000000000000000dead"
const ROUTESCAN_PAGE = 1000
const MAX_LOG_PAGE = 10
const MAX_TRANSFER_LOGS = 120_000
const SOLANA_SIG_PAGE = 1000
const SOLANA_MAX_SIGS = 40_000
const SOLANA_TX_CONCURRENCY = 40
const SOLANA_LOOKBACK_PAD_SEC = 3600
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

export type HolderLookupResult = {
  counts: Map<string, number>
  truncated: boolean
}

export type TransferEvent = {
  blockNumber: number
  logIndex: number
  from: string
  to: string
  amount: bigint
}

type SolanaBalanceRow = {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount?: { amount?: string }
}

type SolanaTx = {
  slot: number
  blockTime: number | null
  meta: {
    err: unknown
    preTokenBalances?: SolanaBalanceRow[]
    postTokenBalances?: SolanaBalanceRow[]
    loadedAddresses?: { writable?: string[]; readonly?: string[] }
  } | null
  transaction: { message: { accountKeys: Array<string | { pubkey: string }> } }
}

type SolAccountState = Map<string, { owner: string; amount: bigint }>

/**
 * Exact base-token holder counts at each trade, rebuilt from on-chain transfers.
 * EVM: every ERC-20 Transfer for the base token, replayed from genesis.
 * Solana: current token accounts + mint-linked txs reversed through the trade window.
 */
/** Addresses that hold tokens but are not counted as “holders” (pool LP, burns). */
export function holderExcludeSet(...addresses: Array<string | null | undefined>): Set<string> {
  const set = new Set<string>([ZERO, DEAD])
  for (const address of addresses) {
    if (address) set.add(address.toLowerCase())
  }
  return set
}

export async function resolveHolderCounts(
  chain: ChainConfig,
  pool: PoolView,
  trades: Trade[],
): Promise<HolderLookupResult> {
  if (trades.length === 0) return { counts: new Map(), truncated: false }
  if (chain.id === "solana") return resolveSolanaHolders(chain, pool.baseAddress, pool.address, trades)
  return resolveEvmHolders(chain, pool.baseAddress, pool.address, trades)
}

async function resolveEvmHolders(
  chain: ChainConfig,
  token: string,
  poolAddress: string,
  trades: Trade[],
): Promise<HolderLookupResult> {
  // Routescan/Etherscan getLogs often returns an incomplete set when toBlock is a
  // concrete number; always read through "latest" and slice by each trade's index.
  const { events, truncated } = await loadEvmTransfers(chain, token, null)
  const timeline = replayEvmTransfers(events, holderExcludeSet(poolAddress))
  const counts = new Map<string, number>()
  for (const trade of trades) {
    counts.set(trade.id, holdersAt(timeline, trade.blockNumber, trade.logIndex))
  }
  return { counts, truncated }
}

/** Pure ERC-20 balance replay — exported for tests. */
export function replayEvmTransfers(
  events: TransferEvent[],
  excluded: Set<string> = holderExcludeSet(),
): { blockNumber: number; logIndex: number; holders: number }[] {
  const balances = new Map<string, bigint>()
  let holders = 0
  const timeline: { blockNumber: number; logIndex: number; holders: number }[] = []

  for (const event of events) {
    holders = applyDelta(balances, holders, event.from, -event.amount, excluded)
    holders = applyDelta(balances, holders, event.to, event.amount, excluded)
    timeline.push({ blockNumber: event.blockNumber, logIndex: event.logIndex, holders })
  }
  return timeline
}

export function holdersAt(
  timeline: { blockNumber: number; logIndex: number; holders: number }[],
  blockNumber: number,
  logIndex: number,
): number {
  if (timeline.length === 0) return 0
  let lo = 0
  let hi = timeline.length - 1
  let best = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const row = timeline[mid]
    if (row.blockNumber < blockNumber || (row.blockNumber === blockNumber && row.logIndex <= logIndex)) {
      best = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best >= 0 ? timeline[best].holders : 0
}

function applyDelta(
  balances: Map<string, bigint>,
  holders: number,
  address: string,
  delta: bigint,
  excluded: Set<string>,
): number {
  if (!address || delta === 0n) return holders
  const key = address.toLowerCase()
  // Still track excluded balances so later transfers stay consistent; never count them.
  const countsTowardHolders = !excluded.has(key)
  const old = balances.get(key) ?? 0n
  let next = old + delta
  if (next < 0n) next = 0n
  if (old === 0n && next > 0n) {
    balances.set(key, next)
    return countsTowardHolders ? holders + 1 : holders
  }
  if (old > 0n && next === 0n) {
    balances.delete(key)
    return countsTowardHolders ? holders - 1 : holders
  }
  if (next === 0n) balances.delete(key)
  else balances.set(key, next)
  return holders
}

async function loadEvmTransfers(
  chain: ChainConfig,
  token: string,
  toBlock: number | null,
): Promise<{ events: TransferEvent[]; truncated: boolean }> {
  const events: TransferEvent[] = []
  const seen = new Set<string>()
  let windowTo = toBlock
  let truncated = false

  for (let windows = 0; windows < 80; windows += 1) {
    let page = 1
    let windowCount = 0
    let oldest = Number.POSITIVE_INFINITY
    while (page <= MAX_LOG_PAGE) {
      const rows = await fetchTransferPage(chain, token, page, windowTo)
      if (rows.length === 0) break
      for (const row of rows) {
        const id = `${row.blockNumber}-${row.logIndex}-${row.from}-${row.to}`
        if (seen.has(id)) continue
        seen.add(id)
        events.push(row)
        windowCount += 1
        if (row.blockNumber > 0 && row.blockNumber < oldest) oldest = row.blockNumber
      }
      if (events.length >= MAX_TRANSFER_LOGS) {
        truncated = true
        break
      }
      if (rows.length < ROUTESCAN_PAGE) break
      page += 1
    }
    if (truncated) break
    if (windowCount === 0) break
    if (page <= MAX_LOG_PAGE && windowCount < ROUTESCAN_PAGE * MAX_LOG_PAGE) break
    if (!Number.isFinite(oldest) || oldest <= 1) break
    windowTo = oldest - 1
  }

  events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)
  return { events, truncated }
}

async function fetchTransferPage(
  chain: ChainConfig,
  token: string,
  page: number,
  toBlock: number | null,
): Promise<TransferEvent[]> {
  const params = new URLSearchParams({
    module: "logs",
    action: "getLogs",
    address: token,
    fromBlock: "0",
    toBlock: toBlock && toBlock > 0 ? String(toBlock) : "latest",
    topic0: TRANSFER_TOPIC,
    page: String(page),
    offset: String(ROUTESCAN_PAGE),
  })

  const urls: string[] = []
  if (chain.routescan) {
    urls.push(`https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?${params}`)
  }
  if (chain.blockscout) {
    urls.push(`${chain.blockscout.replace(/\/$/, "")}/api?${params}`)
  }
  if (urls.length === 0) return []

  let lastError: Error | null = null
  for (const url of urls) {
    try {
      const body = (await fetchJson(url)) as { result?: unknown; message?: string }
      if (!Array.isArray(body.result)) {
        const message = String(body.result || body.message || "")
        if (/no records|no logs|not found|invalid/i.test(message)) return []
        lastError = new Error(message || "transfer logs failed")
        continue
      }
      return body.result.flatMap((row) => {
        const parsed = parseTransferLog(row)
        return parsed ? [parsed] : []
      })
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("transfer logs failed")
    }
  }
  if (lastError) throw lastError
  return []
}

function parseTransferLog(row: unknown): TransferEvent | null {
  if (!row || typeof row !== "object") return null
  const log = row as Record<string, unknown>
  const topics = Array.isArray(log.topics) ? log.topics.filter((topic): topic is string => typeof topic === "string") : []
  if (topics.length < 3 || typeof log.data !== "string") return null
  try {
    return {
      blockNumber: hexNumber(log.blockNumber),
      logIndex: hexNumber(log.logIndex),
      from: topicAddress(topics[1]),
      to: topicAddress(topics[2]),
      amount: BigInt(log.data),
    }
  } catch {
    return null
  }
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40).toLowerCase()}`
}

function hexNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value !== "string" || !value) return 0
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10) || 0
}

async function resolveSolanaHolders(
  chain: ChainConfig,
  mint: string,
  poolAddress: string,
  trades: Trade[],
): Promise<HolderLookupResult> {
  const oldestTradeSec = Math.min(
    ...trades.map((trade) => Math.floor(Date.parse(trade.timestamp) / 1000)).filter((value) => Number.isFinite(value)),
  )
  const floor = Number.isFinite(oldestTradeSec) ? oldestTradeSec - SOLANA_LOOKBACK_PAD_SEC : null
  const state = await loadSolanaTokenAccounts(chain.rpcs, mint)
  const { signatures, truncated } = await loadMintSignatures(chain.rpcs, mint, floor)
  // Pool swaps sometimes omit the mint from account keys; still fetch every trade tx.
  const needed = new Set(signatures)
  for (const trade of trades) {
    if (trade.txHash) needed.add(trade.txHash)
  }
  const excludedOwners = holderExcludeSet(poolAddress)
  const txs = await mapPool([...needed], SOLANA_TX_CONCURRENCY, async (signature) => {
    try {
      const tx = await solanaRpc(chain.rpcs, "getTransaction", [
        signature,
        { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ])
      return tx && typeof tx === "object" ? { signature, tx: tx as SolanaTx } : null
    } catch {
      return null
    }
  })

  const bySig = new Map<string, number>()
  const ordered = txs
    .filter((row): row is { signature: string; tx: SolanaTx } => row !== null)
    .sort((a, b) => (b.tx.slot || 0) - (a.tx.slot || 0))

  for (const row of ordered) {
    bySig.set(row.signature, countSolanaHolders(state, excludedOwners))
    reverseSolanaTx(state, mint, row.tx)
  }

  const counts = new Map<string, number>()
  for (const trade of trades) {
    const found = bySig.get(trade.txHash)
    if (found !== undefined) counts.set(trade.id, found)
  }
  return { counts, truncated }
}

function countSolanaHolders(state: SolAccountState, excludedOwners: Set<string>): number {
  const owners = new Set<string>()
  for (const row of state.values()) {
    if (row.amount > 0n && row.owner && !excludedOwners.has(row.owner)) owners.add(row.owner)
  }
  return owners.size
}

export function reverseSolanaTx(state: SolAccountState, mint: string, tx: SolanaTx) {
  if (!tx.meta || tx.meta.err) return
  const accounts = solanaAccountKeys(tx)
  const pre = tx.meta.preTokenBalances ?? []
  const post = tx.meta.postTokenBalances ?? []
  const touched = new Set<number>()
  for (const row of post) if (row.mint === mint) touched.add(row.accountIndex)
  for (const row of pre) if (row.mint === mint) touched.add(row.accountIndex)

  for (const index of touched) {
    const pubkey = accounts[index]
    if (!pubkey) continue
    const before = pre.find((row) => row.accountIndex === index && row.mint === mint)
    if (before && typeof before.uiTokenAmount?.amount === "string") {
      state.set(pubkey, {
        owner: before.owner || state.get(pubkey)?.owner || "",
        amount: BigInt(before.uiTokenAmount.amount),
      })
    } else {
      state.delete(pubkey)
    }
  }
}

async function loadSolanaTokenAccounts(rpcs: string[], mint: string): Promise<SolAccountState> {
  const state: SolAccountState = new Map()
  for (const program of [TOKEN_2022_PROGRAM, TOKEN_PROGRAM]) {
    try {
      const result = await solanaRpc(preferSolanaIndexRpcs(rpcs), "getProgramAccounts", [
        program,
        {
          encoding: "jsonParsed",
          filters: [{ memcmp: { offset: 0, bytes: mint } }],
        },
      ])
      if (!Array.isArray(result)) continue
      for (const row of result) {
        if (!row || typeof row !== "object") continue
        const account = row as {
          pubkey?: string
          account?: { data?: { parsed?: { info?: { owner?: string; tokenAmount?: { amount?: string } } } } }
        }
        if (typeof account.pubkey !== "string") continue
        const info = account.account?.data?.parsed?.info
        const amountText = info?.tokenAmount?.amount
        if (typeof amountText !== "string" || typeof info?.owner !== "string") continue
        const amount = BigInt(amountText)
        if (amount > 0n) state.set(account.pubkey, { owner: info.owner, amount })
      }
      if (state.size > 0) return state
    } catch {
      continue
    }
  }
  return state
}

function preferSolanaIndexRpcs(rpcs: string[]): string[] {
  // getProgramAccounts is often blocked on PublicNode; try mainnet-beta first.
  const preferred = rpcs.filter((rpc) => /mainnet-beta\.solana\.com/i.test(rpc))
  const rest = rpcs.filter((rpc) => !/mainnet-beta\.solana\.com/i.test(rpc))
  return preferred.length > 0 ? [...preferred, ...rest] : rpcs
}

async function loadMintSignatures(
  rpcs: string[],
  mint: string,
  floorSec: number | null,
): Promise<{ signatures: string[]; truncated: boolean }> {
  const signatures: string[] = []
  let before: string | null = null
  let truncated = false
  for (let page = 0; page < Math.ceil(SOLANA_MAX_SIGS / SOLANA_SIG_PAGE); page += 1) {
    const options: Record<string, unknown> = { limit: SOLANA_SIG_PAGE }
    if (before) options.before = before
    const result = await solanaRpc(rpcs, "getSignaturesForAddress", [mint, options])
    if (!Array.isArray(result) || result.length === 0) break
    let pastFloor = false
    for (const row of result) {
      if (!row || typeof row !== "object") continue
      const info = row as { signature?: string; err?: unknown; blockTime?: number | null }
      if (typeof info.signature !== "string" || info.err != null) continue
      if (floorSec !== null && typeof info.blockTime === "number" && info.blockTime < floorSec) {
        pastFloor = true
        continue
      }
      signatures.push(info.signature)
    }
    before = (result[result.length - 1] as { signature?: string })?.signature ?? null
    const oldest = (result[result.length - 1] as { blockTime?: number | null })?.blockTime
    if (result.length < SOLANA_SIG_PAGE) break
    if (pastFloor || (floorSec !== null && typeof oldest === "number" && oldest < floorSec)) break
    if (signatures.length >= SOLANA_MAX_SIGS) {
      truncated = true
      break
    }
  }
  return { signatures, truncated }
}

function solanaAccountKeys(tx: SolanaTx): string[] {
  const keys = tx.transaction.message.accountKeys.map((key) => (typeof key === "string" ? key : key.pubkey || ""))
  const loaded = tx.meta?.loadedAddresses
  return [...keys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])]
}

async function solanaRpc(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: Error | null = null
  for (const rpc of rpcs) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": "PairSheet/1.0" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(60000),
        cache: "no-store",
      })
      if (!response.ok) {
        last = new Error(`Solana RPC ${response.status}`)
        continue
      }
      const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
      if (body.error?.message) {
        last = new Error(body.error.message)
        continue
      }
      return body.result
    } catch (error) {
      last = error instanceof Error ? error : new Error("Solana RPC failed")
    }
  }
  throw last ?? new Error("Solana RPC failed")
}
