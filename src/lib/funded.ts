import type { ChainConfig } from "./chains"
import { sameAddress } from "./decode"
import { shortAddress } from "./format"
import { fetchJson, mapPool, sleep } from "./http"

const KNOWN_LABELS: Record<string, string> = {
  "0xd152f549545093347a162dce210e7293f1452150": "Disperse.app",
}

export type FundingRow = {
  from: string
  to: string
  value: string
  blockNumber: number
  timestamp: number
  fromName?: string | null
  fromEns?: string | null
  fromTags?: string[]
}

export type Funder = {
  address: string
  label: string
}

export function earliestIncoming(maker: string, rows: FundingRow[]): FundingRow | null {
  const incoming = rows.filter((row) => {
    if (!row.to || !sameAddress(row.to, maker)) return false
    try {
      return BigInt(row.value || "0") > 0n
    } catch {
      return false
    }
  })
  incoming.sort((left, right) => left.blockNumber - right.blockNumber || left.timestamp - right.timestamp)
  return incoming[0] ?? null
}

export function funderLabel(
  address: string,
  profile: { name?: string | null; ens?: string | null; tags?: string[] },
): string {
  const known = KNOWN_LABELS[address.toLowerCase()]
  if (known) return known
  const tag = profile.tags?.find((item) => item.trim())
  if (tag) return tag
  if (profile.name?.trim()) return profile.name.trim()
  if (profile.ens?.trim()) return profile.ens.trim()
  return shortAddress(address)
}

export type FunderResult = {
  found: Map<string, Funder>
  // Wallets the explorer could not answer for (rate limit, timeout). Wallets with
  // no incoming transfer at all are not failures and are simply absent from `found`.
  failed: string[]
}

export async function resolveFunders(
  chain: ChainConfig,
  makers: string[],
  deadline = Number.POSITIVE_INFINITY,
  earliestTradeSec?: Map<string, number>,
): Promise<FunderResult> {
  if (chain.id === "solana") {
    return resolveSolanaFunders(chain, makers, deadline, earliestTradeSec)
  }

  const unique = [...new Set(makers.map((maker) => maker.toLowerCase()).filter(Boolean))]
  const found = new Map<string, Funder>()
  const failed: string[] = []
  await mapPool(unique, 3, async (maker) => {
    if (Date.now() > deadline) {
      failed.push(maker)
      return
    }
    try {
      const rows = await fundingRows(chain, maker)
      const first = earliestIncoming(maker, rows)
      if (!first) return
      const address = first.from.toLowerCase()
      const label = funderLabel(address, { name: first.fromName, ens: first.fromEns, tags: first.fromTags })
      found.set(maker, { address, label })
    } catch {
      failed.push(maker)
    }
  })
  return { found, failed }
}

const SOLANA_SIG_PAGE = 1000
const SOLANA_MAX_PAGES = 8
const SOLANA_LOOKBACK_SEC = 48 * 3600
const SOLANA_MIN_FUND_LAMPORTS = 10_000n
const SOLANA_SKIP_ACCOUNTS = new Set([
  "11111111111111111111111111111111",
  "ComputeBudget111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "So11111111111111111111111111111111111111112",
  "SysvarRent111111111111111111111111111111111",
  "SysvarC1ock11111111111111111111111111111111",
])

/**
 * Solana wallets often have huge histories, so we resolve "funded by" as the
 * earliest inbound SOL transfer at/before the maker's first trade in this export
 * (within a lookback window) — the same signal used for sniper/session funding.
 */
async function resolveSolanaFunders(
  chain: ChainConfig,
  makers: string[],
  deadline: number,
  earliestTradeSec?: Map<string, number>,
): Promise<FunderResult> {
  const unique = [...new Set(makers.filter(Boolean))]
  const found = new Map<string, Funder>()
  const failed: string[] = []
  await mapPool(unique, 4, async (maker) => {
    if (Date.now() > deadline) {
      failed.push(maker)
      return
    }
    try {
      const target = earliestTradeSec?.get(maker) ?? null
      const address = await findSolanaFunder(chain.rpcs, maker, target, deadline)
      if (!address) return
      found.set(maker, { address, label: shortAddress(address) })
    } catch {
      failed.push(maker)
    }
  })
  return { found, failed }
}

async function findSolanaFunder(
  rpcs: string[],
  maker: string,
  firstTradeSec: number | null,
  deadline: number,
): Promise<string | null> {
  const target = firstTradeSec ?? Math.floor(Date.now() / 1000)
  const floor = target - SOLANA_LOOKBACK_SEC
  const candidates: { signature: string; blockTime: number }[] = []
  let before: string | null = null

  for (let page = 0; page < SOLANA_MAX_PAGES; page += 1) {
    if (Date.now() > deadline) break
    const rows = await solanaSignatures(rpcs, maker, before)
    if (rows.length === 0) break
    let pastFloor = false
    for (const row of rows) {
      if (row.err != null || row.blockTime == null) continue
      if (row.blockTime > target) continue
      if (row.blockTime < floor) {
        pastFloor = true
        continue
      }
      candidates.push({ signature: row.signature, blockTime: row.blockTime })
    }
    before = rows[rows.length - 1]?.signature ?? null
    const oldest = rows[rows.length - 1]?.blockTime
    if (!before || rows.length < SOLANA_SIG_PAGE) break
    if (pastFloor || (typeof oldest === "number" && oldest < floor)) break
  }

  candidates.sort((a, b) => a.blockTime - b.blockTime || a.signature.localeCompare(b.signature))
  const window = candidates.slice(0, 80)
  for (const row of window) {
    if (Date.now() > deadline) break
    try {
      const tx = await solanaTransaction(rpcs, row.signature)
      const funder = inboundSolFunder(tx, maker)
      if (funder) return funder
    } catch {
      continue
    }
  }
  return null
}

export function inboundSolFunder(
  tx: {
    meta: {
      err: unknown
      preBalances: number[]
      postBalances: number[]
      loadedAddresses?: { writable?: string[]; readonly?: string[] }
    } | null
    transaction: { message: { accountKeys: Array<string | { pubkey: string }> } }
  } | null,
  maker: string,
): string | null {
  if (!tx?.meta || tx.meta.err) return null
  const accounts = solanaAccountKeys(tx)
  const idx = accounts.indexOf(maker)
  if (idx < 0) return null
  const pre = BigInt(tx.meta.preBalances[idx] ?? 0)
  const post = BigInt(tx.meta.postBalances[idx] ?? 0)
  const delta = post - pre
  if (delta < SOLANA_MIN_FUND_LAMPORTS) return null

  let best: string | null = null
  let bestLoss = 0n
  for (let index = 0; index < accounts.length; index += 1) {
    if (index === idx) continue
    const account = accounts[index]
    if (!account || SOLANA_SKIP_ACCOUNTS.has(account)) continue
    const loss = BigInt(tx.meta.preBalances[index] ?? 0) - BigInt(tx.meta.postBalances[index] ?? 0)
    if (loss > bestLoss) {
      bestLoss = loss
      best = account
    }
  }
  if (best && bestLoss >= SOLANA_MIN_FUND_LAMPORTS / 2n) return best
  const feePayer = accounts[0]
  if (feePayer && feePayer !== maker && !SOLANA_SKIP_ACCOUNTS.has(feePayer)) return feePayer
  return null
}

function solanaAccountKeys(tx: {
  meta: { loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null
  transaction: { message: { accountKeys: Array<string | { pubkey: string }> } }
}): string[] {
  const keys = tx.transaction.message.accountKeys.map((key) =>
    typeof key === "string" ? key : key.pubkey || "",
  )
  const loaded = tx.meta?.loadedAddresses
  return [...keys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])].filter(Boolean)
}

type SolSig = { signature: string; blockTime: number | null; err: unknown }

async function solanaSignatures(rpcs: string[], address: string, before: string | null): Promise<SolSig[]> {
  const options: Record<string, unknown> = { limit: SOLANA_SIG_PAGE }
  if (before) options.before = before
  const result = await solanaRpc(rpcs, "getSignaturesForAddress", [address, options])
  if (!Array.isArray(result)) return []
  return result.flatMap((row) => {
    if (!row || typeof row !== "object") return []
    const info = row as Record<string, unknown>
    if (typeof info.signature !== "string") return []
    return [
      {
        signature: info.signature,
        blockTime: typeof info.blockTime === "number" ? info.blockTime : null,
        err: info.err ?? null,
      },
    ]
  })
}

async function solanaTransaction(rpcs: string[], signature: string) {
  const result = await solanaRpc(rpcs, "getTransaction", [
    signature,
    { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
  ])
  if (!result || typeof result !== "object") return null
  return result as {
    meta: {
      err: unknown
      preBalances: number[]
      postBalances: number[]
      loadedAddresses?: { writable?: string[]; readonly?: string[] }
    } | null
    transaction: { message: { accountKeys: Array<string | { pubkey: string }> } }
  }
}

async function solanaRpc(rpcs: string[], method: string, params: unknown[]): Promise<unknown> {
  let last: Error | null = null
  for (const rpc of rpcs) {
    try {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", "user-agent": "PairSheet/1.0" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(18000),
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

async function fundingRows(chain: ChainConfig, maker: string): Promise<FundingRow[]> {
  if (chain.blockscout) {
    const [internalRows, normalRows] = await Promise.all([
      blockscoutList(chain.blockscout, maker, "internal-transactions"),
      blockscoutList(chain.blockscout, maker, "transactions"),
    ])
    return [...internalRows, ...normalRows]
  }
  if (!chain.routescan) return []
  return accountRows(`https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api`, maker)
}

async function blockscoutList(
  host: string,
  maker: string,
  kind: "internal-transactions" | "transactions",
): Promise<FundingRow[]> {
  const rows: FundingRow[] = []
  const oldestFirst = kind === "transactions"
  let params = oldestFirst ? "?sort=block_number&order=asc" : ""
  for (let page = 0; page < 4; page += 1) {
    const url = `${host}/api/v2/addresses/${maker}/${kind}${params}`
    const body = (await fetchFunding(url)) as {
      items?: unknown[]
      next_page_params?: Record<string, string | number | null> | null
    }
    for (const item of body.items ?? []) {
      const parsed = parseBlockscout(item)
      if (parsed) rows.push(parsed)
    }
    if (oldestFirst && earliestIncoming(maker, rows)) break
    const next = body.next_page_params
    if (!next) break
    params = `?${new URLSearchParams(
      Object.entries(next)
        .filter((entry): entry is [string, string | number] => entry[1] !== null && entry[1] !== undefined)
        .map(([key, value]) => [key, String(value)]),
    )}`
  }
  return rows
}

// Etherscan-style account API. Sorted oldest first, so a wallet's first
// incoming transfer is in the first page no matter how busy the wallet is.
async function accountRows(base: string, maker: string): Promise<FundingRow[]> {
  const lists = await Promise.all(
    ["txlistinternal", "txlist"].map(async (action) => {
      const params = new URLSearchParams({
        module: "account",
        action,
        address: maker,
        startblock: "0",
        endblock: "99999999",
        page: "1",
        offset: "25",
        sort: "asc",
      })
      const body = (await fetchFunding(`${base}?${params}`)) as { result?: unknown }
      return Array.isArray(body.result) ? body.result : []
    }),
  )
  const rows: FundingRow[] = []
  for (const item of lists.flat()) {
    const parsed = parseExplorer(item)
    if (parsed) rows.push(parsed)
  }
  return rows
}

async function fetchFunding(url: string, attempts = 2): Promise<unknown> {
  let last: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJson(url, undefined, 10000, 1)
    } catch (error) {
      last = error instanceof Error ? error : new Error("funding lookup failed")
      if (!/429|502|503|504|upstream/i.test(last.message)) break
      await sleep(400 * (attempt + 1))
    }
  }
  throw last ?? new Error("funding lookup failed")
}

function parseBlockscout(item: unknown): FundingRow | null {
  if (!item || typeof item !== "object") return null
  const row = item as Record<string, unknown>
  const from = party(row.from)
  const to = party(row.to)
  if (!from?.hash || !to?.hash) return null
  const timestamp = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : 0
  return {
    from: from.hash,
    to: to.hash,
    value: typeof row.value === "string" || typeof row.value === "number" ? String(row.value) : "0",
    blockNumber: Number(row.block_number) || 0,
    timestamp: Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : 0,
    fromName: from.name,
    fromEns: from.ens,
    fromTags: from.tags,
  }
}

function party(value: unknown): { hash: string; name: string | null; ens: string | null; tags: string[] } | null {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  if (typeof row.hash !== "string") return null
  const tags = Array.isArray(row.public_tags)
    ? row.public_tags
        .map((tag) => {
          if (!tag || typeof tag !== "object") return ""
          const record = tag as { display_name?: string; label?: string }
          return record.display_name || record.label || ""
        })
        .filter(Boolean)
    : []
  return {
    hash: row.hash,
    name: typeof row.name === "string" ? row.name : null,
    ens: typeof row.ens_domain_name === "string" ? row.ens_domain_name : null,
    tags,
  }
}

function parseExplorer(item: unknown): FundingRow | null {
  if (!item || typeof item !== "object") return null
  const row = item as Record<string, unknown>
  const from = typeof row.from === "string" ? row.from : ""
  const to = typeof row.to === "string" ? row.to : ""
  if (!from || !to) return null
  if (row.isError === "1" || row.txreceipt_status === "0") return null
  return {
    from,
    to,
    value: typeof row.value === "string" || typeof row.value === "number" ? String(row.value) : "0",
    blockNumber: numberField(row.blockNumber),
    timestamp: numberField(row.timeStamp),
  }
}

function numberField(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value !== "string" || !value) return 0
  return Number.parseInt(value, value.startsWith("0x") ? 16 : 10) || 0
}
