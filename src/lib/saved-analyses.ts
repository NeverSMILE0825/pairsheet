import type { WalletFacts } from "./annotate"
import type { PoolView, Trade } from "./types"

const DB_NAME = "pairsheet-analyses"
const DB_VERSION = 1
const META_STORE = "meta"
const PAYLOAD_STORE = "payload"

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

export async function saveAnalysis(input: {
  url: string
  pool: PoolView
  trades: Trade[]
  facts: WalletFacts
  warning: string | null
  capped: boolean
}): Promise<SavedAnalysisMeta> {
  if (typeof indexedDB === "undefined") {
    throw new Error("Saved analyses need a browser with IndexedDB.")
  }
  const id = analysisId(input.pool)
  const savedAt = new Date().toISOString()
  const db = await openDb()
  try {
    const readTx = db.transaction(META_STORE, "readonly")
    const existing = await requestToPromise(
      readTx.objectStore(META_STORE).get(id) as IDBRequest<SavedAnalysisMeta | undefined>,
    )
    await transactionDone(readTx)
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
      starred: Boolean(existing?.starred),
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
    }
    const writeTx = db.transaction([META_STORE, PAYLOAD_STORE], "readwrite")
    writeTx.objectStore(META_STORE).put(meta)
    writeTx.objectStore(PAYLOAD_STORE).put(payload)
    await transactionDone(writeTx)
    return meta
  } finally {
    db.close()
  }
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
