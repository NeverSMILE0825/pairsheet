import type { WalletFacts } from "./annotate"
import type { PoolView, Trade } from "./types"

const DB_NAME = "pairsheet-analyses"
const DB_VERSION = 1
const META_STORE = "meta"
const PAYLOAD_STORE = "payload"

/** Bookmark / saved-pair count is unlimited. Only full tape blobs may be pruned under storage pressure. */
export const MAX_SAVED_PAIRS = Number.POSITIVE_INFINITY

export type SaveAnalysisResult = {
  meta: SavedAnalysisMeta
  /** False when the bookmark row was saved but the full tape could not fit in IndexedDB. */
  storedPayload: boolean
  /** Full tapes removed to free space for the new save (bookmark rows are kept). */
  prunedPayloadIds: string[]
}

export type SavedAnalysisMeta = {
  id: string
  url: string
  savedAt: string
  chainId: string
  chainName: string
  address: string
  dex: string
  baseSymbol: string
  quoteSymbol: string
  tradeCount: number
  /** Pinned to the top of the Open dialog when true. */
  starred?: boolean
}

export type SavedAnalysisPayload = {
  id: string
  url: string
  savedAt: string
  pool: PoolView
  trades: Trade[]
  facts: WalletFacts
  warning: string | null
  capped: boolean
  /** Present once Funded by has been resolved with the current rule. */
  funderRevision?: number
  /** Makers already checked. Blank funders in this list have no ETH credit. */
  funderChecked?: string[]
}

export function analysisId(pool: Pick<PoolView, "chainId" | "address">): string {
  return `${pool.chainId}:${pool.address.toLowerCase()}`
}

/** Starred first, then newest saved. */
export function compareSavedMeta(a: SavedAnalysisMeta, b: SavedAnalysisMeta): number {
  const star = Number(Boolean(b.starred)) - Number(Boolean(a.starred))
  if (star !== 0) return star
  return b.savedAt.localeCompare(a.savedAt)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error("Could not open saved analyses."))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(PAYLOAD_STORE)) {
        db.createObjectStore(PAYLOAD_STORE, { keyPath: "id" })
      }
    }
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."))
  })
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."))
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted."))
  })
}

export async function listSavedAnalyses(): Promise<SavedAnalysisMeta[]> {
  if (typeof indexedDB === "undefined") return []
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, "readonly")
    const rows = await requestToPromise(tx.objectStore(META_STORE).getAll() as IDBRequest<SavedAnalysisMeta[]>)
    await transactionDone(tx)
    return [...rows].sort(compareSavedMeta)
  } finally {
    db.close()
  }
}

export async function loadSavedAnalysis(id: string): Promise<SavedAnalysisPayload | null> {
  if (typeof indexedDB === "undefined") return null
  const db = await openDb()
  try {
    const tx = db.transaction(PAYLOAD_STORE, "readonly")
    const row = await requestToPromise(tx.objectStore(PAYLOAD_STORE).get(id) as IDBRequest<SavedAnalysisPayload | undefined>)
    await transactionDone(tx)
    return row ?? null
  } finally {
    db.close()
  }
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { name?: string; code?: number }
  return err.name === "QuotaExceededError" || err.code === 22
}

/**
 * Prefer deleting full tapes for unstarred, oldest-first pairs.
 * Bookmark meta rows are never selected — only payload blobs.
 */
export function pickPayloadsToPrune(
  metas: SavedAnalysisMeta[],
  preserveIds: Set<string>,
  count: number,
): string[] {
  if (count <= 0) return []
  return [...metas]
    .filter((item) => !preserveIds.has(item.id))
    .sort((a, b) => {
      const star = Number(Boolean(a.starred)) - Number(Boolean(b.starred))
      if (star !== 0) return star
      return a.savedAt.localeCompare(b.savedAt)
    })
    .slice(0, count)
    .map((item) => item.id)
}

/** Drop full tapes only (Open still lists the pair; shared/sync metas stay). */
export async function deletePayloadOnly(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await openDb()
  try {
    const tx = db.transaction(PAYLOAD_STORE, "readwrite")
    tx.objectStore(PAYLOAD_STORE).delete(id)
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export async function pruneOldestPayloads(
  preserveIds: Set<string>,
  count = 1,
): Promise<string[]> {
  const metas = await listSavedAnalyses()
  const victims = pickPayloadsToPrune(metas, preserveIds, count)
  for (const id of victims) await deletePayloadOnly(id)
  return victims
}

async function putMetaAndPayload(meta: SavedAnalysisMeta, payload: SavedAnalysisPayload): Promise<void> {
  const db = await openDb()
  try {
    const writeTx = db.transaction([META_STORE, PAYLOAD_STORE], "readwrite")
    writeTx.objectStore(META_STORE).put(meta)
    writeTx.objectStore(PAYLOAD_STORE).put(payload)
    await transactionDone(writeTx)
  } finally {
    db.close()
  }
}

async function putMetaOnly(meta: SavedAnalysisMeta): Promise<void> {
  const db = await openDb()
  try {
    const writeTx = db.transaction(META_STORE, "readwrite")
    writeTx.objectStore(META_STORE).put(meta)
    await transactionDone(writeTx)
  } finally {
    db.close()
  }
}

export async function saveAnalysis(input: {
  url: string
  pool: PoolView
  trades: Trade[]
  facts: WalletFacts
  warning: string | null
  capped: boolean
  /** Preserve original time when importing a vault. */
  savedAt?: string
  starred?: boolean
  funderRevision?: number
  funderChecked?: string[]
}): Promise<SaveAnalysisResult> {
  if (typeof indexedDB === "undefined") {
    throw new Error("Saved analyses need a browser with IndexedDB.")
  }
  const id = analysisId(input.pool)
  const savedAt = input.savedAt && Number.isFinite(Date.parse(input.savedAt)) ? input.savedAt : new Date().toISOString()
  const db = await openDb()
  let existing: SavedAnalysisMeta | undefined
  let existingPayload: SavedAnalysisPayload | undefined
  try {
    const readTx = db.transaction([META_STORE, PAYLOAD_STORE], "readonly")
    existing = await requestToPromise(
      readTx.objectStore(META_STORE).get(id) as IDBRequest<SavedAnalysisMeta | undefined>,
    )
    existingPayload = await requestToPromise(
      readTx.objectStore(PAYLOAD_STORE).get(id) as IDBRequest<SavedAnalysisPayload | undefined>,
    )
    await transactionDone(readTx)
  } finally {
    db.close()
  }
  const meta: SavedAnalysisMeta = {
    id,
    url: input.url,
    savedAt,
    chainId: input.pool.chainId,
    chainName: input.pool.chainName,
    address: input.pool.address,
    dex: input.pool.dex,
    baseSymbol: input.pool.baseSymbol,
    quoteSymbol: input.pool.quoteSymbol,
    tradeCount: input.trades.length,
    starred: input.starred !== undefined ? Boolean(input.starred) : Boolean(existing?.starred),
  }
  const payload: SavedAnalysisPayload = {
    id,
    url: input.url,
    savedAt,
    pool: input.pool,
    trades: input.trades,
    facts: input.facts,
    warning: input.warning,
    capped: input.capped,
    funderRevision: input.funderRevision !== undefined ? input.funderRevision : existingPayload?.funderRevision,
    funderChecked: input.funderChecked !== undefined ? input.funderChecked : existingPayload?.funderChecked,
  }

  // Bookmark row first — shared list / Open dialog must not depend on tape fitting.
  await putMetaOnly(meta)

  const prunedPayloadIds: string[] = []
  const preserve = new Set<string>([id])
  let batch = 1
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await putMetaAndPayload(meta, payload)
      return { meta, storedPayload: true, prunedPayloadIds }
    } catch (error) {
      if (!isQuotaError(error)) throw error
      const removed = await pruneOldestPayloads(preserve, batch)
      prunedPayloadIds.push(...removed)
      if (removed.length === 0) break
      batch = Math.min(8, batch * 2)
    }
  }

  // Meta stays; Open will reload from chain for this pair on browsers without a tape.
  return { meta, storedPayload: false, prunedPayloadIds }
}

export async function setAnalysisStarred(id: string, starred: boolean): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await openDb()
  try {
    const tx = db.transaction(META_STORE, "readwrite")
    const store = tx.objectStore(META_STORE)
    const existing = await requestToPromise(store.get(id) as IDBRequest<SavedAnalysisMeta | undefined>)
    if (!existing) {
      await transactionDone(tx)
      return
    }
    store.put({ ...existing, starred })
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export async function deleteSavedAnalysis(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await openDb()
  try {
    const tx = db.transaction([META_STORE, PAYLOAD_STORE], "readwrite")
    tx.objectStore(META_STORE).delete(id)
    tx.objectStore(PAYLOAD_STORE).delete(id)
    await transactionDone(tx)
  } finally {
    db.close()
  }
}

export function formatSavedAt(iso: string): string {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return iso
  return new Date(time).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export type SavedVault = {
  version: 1
  exportedAt: string
  bookmarks: SavedAnalysisMeta[]
  payloads: SavedAnalysisPayload[]
}

export async function exportSavedVault(): Promise<SavedVault> {
  const bookmarks = await listSavedAnalyses()
  const payloads: SavedAnalysisPayload[] = []
  for (const item of bookmarks) {
    const payload = await loadSavedAnalysis(item.id)
    if (payload) payloads.push(payload)
  }
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    bookmarks,
    payloads,
  }
}

export async function importSavedVault(vault: SavedVault): Promise<number> {
  if (!vault || vault.version !== 1 || !Array.isArray(vault.payloads)) {
    throw new Error("That file is not a Pair Sheet saved-pairs export.")
  }
  if (typeof indexedDB === "undefined") {
    throw new Error("Saved analyses need a browser with IndexedDB.")
  }
  let imported = 0
  for (const payload of vault.payloads) {
    if (!payload?.id || !payload.pool || !Array.isArray(payload.trades)) continue
    const metaFromVault = vault.bookmarks.find((row) => row.id === payload.id)
    const result = await saveAnalysis({
      url: payload.url,
      pool: payload.pool,
      trades: payload.trades,
      facts: payload.facts,
      warning: payload.warning,
      capped: payload.capped,
      funderRevision: payload.funderRevision,
      funderChecked: payload.funderChecked,
      savedAt: payload.savedAt || metaFromVault?.savedAt,
      starred: Boolean(metaFromVault?.starred),
    })
    if (result.meta) imported += 1
  }
  return imported
}

/** Merge local IndexedDB metas with cloud bookmarks; newer savedAt wins, stars OR together. */
export function mergeSavedMeta(local: SavedAnalysisMeta[], remote: SavedAnalysisMeta[]): SavedAnalysisMeta[] {
  const map = new Map<string, SavedAnalysisMeta>()
  for (const item of remote) map.set(item.id, { ...item })
  for (const item of local) {
    const prev = map.get(item.id)
    if (!prev) {
      map.set(item.id, { ...item })
      continue
    }
    const newer = item.savedAt >= prev.savedAt ? item : prev
    const older = newer === item ? prev : item
    map.set(item.id, {
      ...older,
      ...newer,
      starred: Boolean(item.starred || prev.starred),
      tradeCount: Math.max(item.tradeCount, prev.tradeCount),
    })
  }
  return [...map.values()].sort(compareSavedMeta)
}
