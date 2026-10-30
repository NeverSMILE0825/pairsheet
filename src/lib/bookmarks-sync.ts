import type { SavedAnalysisMeta } from "./saved-analyses"
import { mergeSavedMeta } from "./saved-analyses"

/** Shared bookmark catalog lives in the pairsheet repo so every browser can read it. */
export const SYNC_REPO = "NeverSMILE0825/pairsheet"
export const SYNC_PATH = "public/data/bookmarks.json"
export const SYNC_TOKEN_KEY = "pairsheet.githubSyncToken"
export const SYNC_STATUS_KEY = "pairsheet.githubSyncStatus"
/** Last known metas on this browser — backup if IndexedDB briefly fails during publish. */
export const BOOKMARK_CACHE_KEY = "pairsheet.bookmarkMetaCache"

const RAW_URL = `https://raw.githubusercontent.com/${SYNC_REPO}/main/${SYNC_PATH}`
const PAGES_URL = `https://neversmile0825.github.io/pairsheet/data/bookmarks.json`
const CONTENTS_URL = `https://api.github.com/repos/${SYNC_REPO}/contents/${SYNC_PATH}`

/** Dedicated IDB for sync settings — localStorage is blocked in some browsers that still allow IndexedDB. */
const SYNC_DB_NAME = "pairsheet-sync"
const SYNC_DB_VERSION = 1
const SYNC_STORE = "kv"
const IDB_TOKEN_KEY = "token"
const IDB_STATUS_KEY = "status"
const IDB_META_CACHE_KEY = "bookmarkMetaCache"

export type BookmarkCatalog = {
  version: 1
  updatedAt: string | null
  bookmarks: SavedAnalysisMeta[]
}

export type SyncStatus = {
  enabled: boolean
  lastOkAt: string | null
  lastError: string | null
  lastCount: number
  lastAction: "publish" | "pull" | "validate" | null
}

const emptyStatus = (): SyncStatus => ({
  enabled: false,
  lastOkAt: null,
  lastError: null,
  lastCount: 0,
  lastAction: null,
})

/** Always-available session copy — localStorage may throw "storage blocked". */
let memoryToken = ""
let memoryStatus: SyncStatus = emptyStatus()
let memoryMetaCache: SavedAnalysisMeta[] = []
let hydratePromise: Promise<void> | null = null

function readLocal(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string | null): boolean {
  if (typeof window === "undefined") return false
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

function openSyncDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"))
      return
    }
    const request = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION)
    request.onerror = () => reject(request.error ?? new Error("Could not open sync storage."))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SYNC_STORE)) {
        db.createObjectStore(SYNC_STORE)
      }
    }
  })
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openSyncDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE, "readonly")
      const req = tx.objectStore(SYNC_STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed."))
    })
  } finally {
    db.close()
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openSyncDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SYNC_STORE, "readwrite")
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed."))
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted."))
      if (value === null || value === undefined || value === "") tx.objectStore(SYNC_STORE).delete(key)
      else tx.objectStore(SYNC_STORE).put(value, key)
    })
  } finally {
    db.close()
  }
}

function parseStatus(raw: unknown): SyncStatus | null {
  if (!raw || typeof raw !== "object") return null
  const parsed = raw as SyncStatus
  return {
    enabled: false,
    lastOkAt: typeof parsed.lastOkAt === "string" ? parsed.lastOkAt : null,
    lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
    lastCount: typeof parsed.lastCount === "number" ? parsed.lastCount : 0,
    lastAction:
      parsed.lastAction === "publish" || parsed.lastAction === "pull" || parsed.lastAction === "validate"
        ? parsed.lastAction
        : null,
  }
}

/** Load token/status from localStorage or IndexedDB into memory (call once on app start). */
export async function hydrateSyncStorage(): Promise<void> {
  if (typeof window === "undefined") return
  if (!hydratePromise) {
    hydratePromise = (async () => {
      const localToken = readLocal(SYNC_TOKEN_KEY)?.trim() || ""
      if (localToken) memoryToken = localToken
      try {
        const localStatus = parseStatus(JSON.parse(readLocal(SYNC_STATUS_KEY) || "null"))
        if (localStatus) memoryStatus = { ...localStatus, enabled: Boolean(memoryToken) }
      } catch {
        // ignore corrupt status
      }

      try {
        const localMetas = readLocal(BOOKMARK_CACHE_KEY)
        if (localMetas) {
          const parsed = JSON.parse(localMetas) as unknown
          if (Array.isArray(parsed)) {
            memoryMetaCache = parseCatalog({ version: 1, updatedAt: null, bookmarks: parsed }).bookmarks
          }
        }
      } catch {
        // ignore
      }

      try {
        if (!memoryToken) {
          const idbToken = await idbGet(IDB_TOKEN_KEY)
          if (typeof idbToken === "string" && idbToken.trim()) memoryToken = idbToken.trim()
        }
        if (!memoryStatus.lastOkAt && !memoryStatus.lastError) {
          const idbStatus = parseStatus(await idbGet(IDB_STATUS_KEY))
          if (idbStatus) memoryStatus = { ...idbStatus, enabled: Boolean(memoryToken) }
        }
        if (memoryMetaCache.length === 0) {
          const idbMetas = await idbGet(IDB_META_CACHE_KEY)
          if (Array.isArray(idbMetas)) {
            memoryMetaCache = parseCatalog({ version: 1, updatedAt: null, bookmarks: idbMetas }).bookmarks
          }
        }
      } catch {
        // IndexedDB blocked too — memory-only for this session.
      }

      memoryStatus = { ...memoryStatus, enabled: Boolean(memoryToken) }
    })()
  }
  await hydratePromise
}

export function getSyncToken(): string {
  if (memoryToken) return memoryToken
  return readLocal(SYNC_TOKEN_KEY)?.trim() || ""
}

export function setSyncToken(token: string): void {
  const value = token.trim()
  memoryToken = value
  memoryStatus = { ...memoryStatus, enabled: value.length > 0 }
  writeLocal(SYNC_TOKEN_KEY, value || null)
  void idbSet(IDB_TOKEN_KEY, value || null).catch(() => {
    // Persistence best-effort; memory token still enables publish this session.
  })
}

export function hasSyncToken(): boolean {
  return getSyncToken().length > 0
}

export function getSyncStatus(): SyncStatus {
  return { ...memoryStatus, enabled: hasSyncToken() }
}

function writeSyncStatus(patch: Partial<SyncStatus>): SyncStatus {
  const next: SyncStatus = { ...getSyncStatus(), ...patch, enabled: hasSyncToken() }
  memoryStatus = next
  writeLocal(SYNC_STATUS_KEY, JSON.stringify(next))
  void idbSet(IDB_STATUS_KEY, next).catch(() => {
    // ignore
  })
  return next
}

function emptyCatalog(): BookmarkCatalog {
  return { version: 1, updatedAt: null, bookmarks: [] }
}

function parseCatalog(payload: unknown): BookmarkCatalog {
  if (!payload || typeof payload !== "object") return emptyCatalog()
  const row = payload as { version?: unknown; updatedAt?: unknown; bookmarks?: unknown }
  if (!Array.isArray(row.bookmarks)) return emptyCatalog()
  const bookmarks = row.bookmarks.filter((item): item is SavedAnalysisMeta => {
    if (!item || typeof item !== "object") return false
    const meta = item as SavedAnalysisMeta
    return typeof meta.id === "string" && typeof meta.url === "string" && typeof meta.savedAt === "string"
  })
  return {
    version: 1,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
    bookmarks,
  }
}

function githubHeaders(token: string, json = false): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    ...(json ? { "content-type": "application/json" } : {}),
  }
}

async function readGithubError(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { message?: string; documentation_url?: string }
    if (body.message) return body.message
  } catch {
    // not json
  }
  return text.slice(0, 200) || `HTTP ${response.status}`
}

function authErrorMessage(status: number, detail: string): string {
  if (status === 401) {
    return "Token rejected (401). Create a new fine-grained PAT and paste it again — never reuse a token that was shared in chat."
  }
  if (status === 403) {
    return `GitHub denied write access (403): ${detail}. The PAT needs Contents: Read and Write on ${SYNC_REPO}, and the token resource owner must be NeverSMILE0825.`
  }
  if (status === 404) {
    return `Repo or file not found (404). Confirm the PAT can access ${SYNC_REPO}.`
  }
  return `GitHub error (${status}): ${detail}`
}

export function readCachedBookmarkMetas(): SavedAnalysisMeta[] {
  if (memoryMetaCache.length > 0) return memoryMetaCache
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(readLocal(BOOKMARK_CACHE_KEY) || "null") as unknown
    if (!Array.isArray(parsed)) return []
    return parseCatalog({ version: 1, updatedAt: null, bookmarks: parsed }).bookmarks
  } catch {
    return []
  }
}

export function cacheBookmarkMetas(metas: SavedAnalysisMeta[]): void {
  const merged = mergeSavedMeta(metas, readCachedBookmarkMetas())
  memoryMetaCache = merged
  writeLocal(BOOKMARK_CACHE_KEY, JSON.stringify(merged))
  void idbSet(IDB_META_CACHE_KEY, merged).catch(() => {
    // ignore
  })
}

async function fetchCatalogFromUrl(url: string): Promise<BookmarkCatalog | null> {
  try {
    const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return null
    return parseCatalog(await response.json())
  } catch {
    return null
  }
}

/**
 * Public read — no token.
 * Prefer raw GitHub (updates before Pages redeploys), then the live Pages URL.
 * Never mutates publish success status — opening the dialog must not flip the badge to "Not synced".
 */
export async function fetchRemoteBookmarks(): Promise<BookmarkCatalog> {
  const fromRaw = await fetchCatalogFromUrl(RAW_URL)
  if (fromRaw && (fromRaw.bookmarks.length > 0 || fromRaw.updatedAt)) return fromRaw
  const fromPages = await fetchCatalogFromUrl(PAGES_URL)
  if (fromPages) return fromPages
  return fromRaw ?? emptyCatalog()
}

type GitHubContent = {
  sha: string
  content?: string
  encoding?: string
}

async function readRemoteFile(token: string): Promise<{ sha: string; catalog: BookmarkCatalog }> {
  const response = await fetch(CONTENTS_URL, {
    headers: githubHeaders(token),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    return { sha: "", catalog: emptyCatalog() }
  }
  if (!response.ok) {
    throw new Error(authErrorMessage(response.status, await readGithubError(response)))
  }
  const body = (await response.json()) as GitHubContent
  let catalog = emptyCatalog()
  if (body.content) {
    try {
      const decoded = atob(body.content.replace(/\n/g, ""))
      catalog = parseCatalog(JSON.parse(decoded))
    } catch {
      catalog = emptyCatalog()
    }
  }
  return { sha: body.sha, catalog }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Confirm the token can read the bookmarks file (or create it). */
export async function validateSyncToken(
  token = getSyncToken(),
): Promise<{ ok: true; login?: string } | { ok: false; error: string }> {
  const value = token.trim()
  if (!value) return { ok: false, error: "Paste a GitHub fine-grained token first." }
  if (!value.startsWith("github_pat_") && !value.startsWith("ghp_")) {
    return { ok: false, error: "That does not look like a GitHub PAT (expected github_pat_… or ghp_…)." }
  }
  try {
    const who = await fetch("https://api.github.com/user", {
      headers: githubHeaders(value),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    if (!who.ok) {
      const detail = await readGithubError(who)
      const error = authErrorMessage(who.status, detail)
      writeSyncStatus({ lastError: error, lastAction: "validate" })
      return { ok: false, error }
    }
    const user = (await who.json()) as { login?: string }
    await readRemoteFile(value)
    writeSyncStatus({ lastError: null, lastAction: "validate" })
    return { ok: true, login: user.login }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not validate token."
    writeSyncStatus({ lastError: message, lastAction: "validate" })
    return { ok: false, error: message }
  }
}

function pairLabel(meta: SavedAnalysisMeta): string {
  return `${meta.baseSymbol}/${meta.quoteSymbol}`
}

/** Stable fingerprint of bookmark rows (ignores catalog.updatedAt). */
export function bookmarkSyncFingerprint(bookmarks: SavedAnalysisMeta[]): string {
  const normalized = [...bookmarks]
    .map((item) => ({
      id: item.id,
      url: item.url,
      savedAt: item.savedAt,
      chainId: item.chainId,
      address: item.address.toLowerCase(),
      dex: item.dex,
      baseSymbol: item.baseSymbol,
      quoteSymbol: item.quoteSymbol,
      tradeCount: item.tradeCount,
      starred: Boolean(item.starred),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify(normalized)
}

/**
 * Git commit message for a bookmark publish. Returns null when the list is unchanged
 * (so we skip creating another "Sync saved pairs (N)" no-op commit).
 */
export function describeBookmarkSync(
  previous: SavedAnalysisMeta[],
  next: SavedAnalysisMeta[],
): string | null {
  const prevMap = new Map(previous.map((item) => [item.id, item]))
  const nextMap = new Map(next.map((item) => [item.id, item]))
  const added: string[] = []
  const removed: string[] = []
  const updated: string[] = []
  const starred: string[] = []
  const unstarred: string[] = []

  for (const [id, meta] of nextMap) {
    const prior = prevMap.get(id)
    if (!prior) {
      added.push(pairLabel(meta))
      continue
    }
    const starChanged = Boolean(prior.starred) !== Boolean(meta.starred)
    const otherChanged =
      prior.savedAt !== meta.savedAt ||
      prior.tradeCount !== meta.tradeCount ||
      prior.url !== meta.url ||
      prior.baseSymbol !== meta.baseSymbol ||
      prior.quoteSymbol !== meta.quoteSymbol ||
      prior.dex !== meta.dex
    if (otherChanged) {
      updated.push(
        meta.tradeCount !== prior.tradeCount
          ? `${pairLabel(meta)} (${meta.tradeCount.toLocaleString("en-US")} trades)`
          : pairLabel(meta),
      )
    } else if (starChanged) {
      if (meta.starred) starred.push(pairLabel(meta))
      else unstarred.push(pairLabel(meta))
    }
  }
  for (const [id, meta] of prevMap) {
    if (!nextMap.has(id)) removed.push(pairLabel(meta))
  }

  if (
    added.length === 0 &&
    removed.length === 0 &&
    updated.length === 0 &&
    starred.length === 0 &&
    unstarred.length === 0
  ) {
    return null
  }

  if (next.length === 0 && removed.length > 0) {
    return removed.length === 1
      ? `Remove ${removed[0]} from shared bookmarks`
      : `Clear shared bookmarks (${removed.length} removed)`
  }

  if (added.length === 1 && removed.length === 0 && updated.length === 0 && starred.length === 0 && unstarred.length === 0) {
    return `Add ${added[0]} to shared bookmarks`
  }
  if (removed.length === 1 && added.length === 0 && updated.length === 0 && starred.length === 0 && unstarred.length === 0) {
    return `Remove ${removed[0]} from shared bookmarks`
  }
  if (starred.length === 1 && added.length === 0 && removed.length === 0 && updated.length === 0 && unstarred.length === 0) {
    return `Star ${starred[0]} on shared bookmarks`
  }
  if (unstarred.length === 1 && added.length === 0 && removed.length === 0 && updated.length === 0 && starred.length === 0) {
    return `Unstar ${unstarred[0]} on shared bookmarks`
  }
  if (updated.length === 1 && added.length === 0 && removed.length === 0 && starred.length === 0 && unstarred.length === 0) {
    return `Update ${updated[0]} on shared bookmarks`
  }

  const parts: string[] = []
  if (added.length) parts.push(`add ${added.join(", ")}`)
  if (removed.length) parts.push(`remove ${removed.join(", ")}`)
  if (starred.length) parts.push(`star ${starred.join(", ")}`)
  if (unstarred.length) parts.push(`unstar ${unstarred.join(", ")}`)
  if (updated.length) parts.push(`refresh ${updated.join(", ")}`)
  const detail = parts.join("; ")
  if (detail.length <= 72) return `Update shared bookmarks: ${detail}`
  return `Update shared bookmarks (${added.length} added, ${removed.length} removed, ${updated.length + starred.length + unstarred.length} changed)`
}

async function putCatalog(
  token: string,
  catalog: BookmarkCatalog,
  sha: string,
  message: string,
): Promise<Response> {
  const body: Record<string, string> = {
    message,
    content: toBase64(`${JSON.stringify(catalog, null, 2)}\n`),
    branch: "main",
  }
  if (sha) body.sha = sha
  return fetch(CONTENTS_URL, {
    method: "PUT",
    headers: githubHeaders(token, true),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
}

/** True when a real non-empty publish landed and has not failed since. */
export function isSyncSuccessful(status: SyncStatus = getSyncStatus()): boolean {
  return Boolean(status.enabled && status.lastOkAt && !status.lastError && status.lastCount > 0)
}

/** Publish the merged bookmark list to the repo (requires a fine-grained PAT with Contents: Write). */
export async function publishBookmarks(
  bookmarks: SavedAnalysisMeta[],
  tokenOverride?: string,
  options?: { allowEmpty?: boolean },
): Promise<BookmarkCatalog> {
  const token = (tokenOverride ?? getSyncToken()).trim()
  if (!token) throw new Error("Add a GitHub sync token first.")
  if (bookmarks.length === 0 && !options?.allowEmpty) {
    throw new Error("No local saved pairs to publish. Save a pair on this browser first, then Publish now.")
  }

  const bookmarksSorted = [...bookmarks].sort((a, b) => b.savedAt.localeCompare(a.savedAt))

  try {
    let { sha, catalog: remote } = await readRemoteFile(token)
    const unchanged =
      bookmarkSyncFingerprint(remote.bookmarks) === bookmarkSyncFingerprint(bookmarksSorted)
    const commitMessage = unchanged ? null : describeBookmarkSync(remote.bookmarks, bookmarksSorted)

    // Same pair list as GitHub — do not bump updatedAt or open another empty commit.
    if (!commitMessage) {
      if (remote.bookmarks.length > 0) cacheBookmarkMetas(remote.bookmarks)
      writeSyncStatus({
        lastOkAt: remote.updatedAt ?? new Date().toISOString(),
        lastError: null,
        lastCount: remote.bookmarks.length,
        lastAction: "publish",
        enabled: true,
      })
      return remote.bookmarks.length > 0
        ? remote
        : { version: 1, updatedAt: remote.updatedAt, bookmarks: bookmarksSorted }
    }

    const catalog: BookmarkCatalog = {
      version: 1,
      updatedAt: new Date().toISOString(),
      bookmarks: bookmarksSorted,
    }

    let response = await putCatalog(token, catalog, sha, commitMessage)
    // Stale sha (another publish landed) — refresh and retry once.
    if (response.status === 409) {
      ;({ sha, catalog: remote } = await readRemoteFile(token))
      const retryMessage = describeBookmarkSync(remote.bookmarks, bookmarksSorted)
      if (!retryMessage) {
        if (remote.bookmarks.length > 0) cacheBookmarkMetas(remote.bookmarks)
        writeSyncStatus({
          lastOkAt: remote.updatedAt ?? catalog.updatedAt,
          lastError: null,
          lastCount: remote.bookmarks.length,
          lastAction: "publish",
          enabled: true,
        })
        return remote
      }
      response = await putCatalog(token, catalog, sha, retryMessage)
    }
    if (!response.ok) {
      const detail = await readGithubError(response)
      const message = authErrorMessage(response.status, detail)
      writeSyncStatus({ lastError: message, lastAction: "publish", lastOkAt: null })
      throw new Error(message)
    }

    // Confirm Contents API matches what we sent (never report success on a silent empty write).
    const verified = await readRemoteFile(token)
    if (catalog.bookmarks.length > 0 && verified.catalog.bookmarks.length === 0) {
      const message = "Publish wrote an empty shared list. Try Publish now again."
      writeSyncStatus({ lastError: message, lastAction: "publish", lastOkAt: null, lastCount: 0 })
      throw new Error(message)
    }

    if (verified.catalog.bookmarks.length > 0) cacheBookmarkMetas(verified.catalog.bookmarks)
    writeSyncStatus({
      lastOkAt: verified.catalog.updatedAt ?? catalog.updatedAt,
      lastError: null,
      lastCount: verified.catalog.bookmarks.length,
      lastAction: "publish",
      enabled: true,
    })
    return verified.catalog
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("GitHub") || error.message.includes("PAT"))) throw error
    const message = error instanceof Error ? error.message : "Publish failed."
    writeSyncStatus({ lastError: message, lastAction: "publish", lastOkAt: null })
    throw error instanceof Error ? error : new Error(message)
  }
}

export function clearSync(): void {
  setSyncToken("")
  memoryStatus = emptyStatus()
  writeLocal(SYNC_STATUS_KEY, null)
  void idbSet(IDB_STATUS_KEY, null).catch(() => {
    // ignore
  })
}

export function syncTokenHelpUrl(): string {
  return "https://github.com/settings/personal-access-tokens/new"
}

export function formatSyncAgo(iso: string | null): string {
  if (!iso) return "never"
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return "just now"
  const sec = Math.floor(ms / 1000)
  if (sec < 10) return "just now"
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}
