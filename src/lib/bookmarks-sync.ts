import type { SavedAnalysisMeta } from "./saved-analyses"

/** Shared bookmark catalog lives in the pairsheet repo so every browser can read it. */
export const SYNC_REPO = "NeverSMILE0825/pairsheet"
export const SYNC_PATH = "public/data/bookmarks.json"
export const SYNC_TOKEN_KEY = "pairsheet.githubSyncToken"
export const SYNC_STATUS_KEY = "pairsheet.githubSyncStatus"

const RAW_URL = `https://raw.githubusercontent.com/${SYNC_REPO}/main/${SYNC_PATH}`
const CONTENTS_URL = `https://api.github.com/repos/${SYNC_REPO}/contents/${SYNC_PATH}`

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

export function getSyncToken(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(SYNC_TOKEN_KEY)?.trim() || ""
  } catch {
    return ""
  }
}

export function setSyncToken(token: string): void {
  if (typeof window === "undefined") return
  try {
    const value = token.trim()
    if (value) window.localStorage.setItem(SYNC_TOKEN_KEY, value)
    else window.localStorage.removeItem(SYNC_TOKEN_KEY)
  } catch {
    // Storage blocked.
  }
}

export function hasSyncToken(): boolean {
  return getSyncToken().length > 0
}

export function getSyncStatus(): SyncStatus {
  if (typeof window === "undefined") {
    return { enabled: false, lastOkAt: null, lastError: null, lastCount: 0, lastAction: null }
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SYNC_STATUS_KEY) || "null") as SyncStatus | null
    if (!parsed || typeof parsed !== "object") {
      return { enabled: hasSyncToken(), lastOkAt: null, lastError: null, lastCount: 0, lastAction: null }
    }
    return {
      enabled: hasSyncToken(),
      lastOkAt: typeof parsed.lastOkAt === "string" ? parsed.lastOkAt : null,
      lastError: typeof parsed.lastError === "string" ? parsed.lastError : null,
      lastCount: typeof parsed.lastCount === "number" ? parsed.lastCount : 0,
      lastAction: parsed.lastAction === "publish" || parsed.lastAction === "pull" || parsed.lastAction === "validate" ? parsed.lastAction : null,
    }
  } catch {
    return { enabled: hasSyncToken(), lastOkAt: null, lastError: null, lastCount: 0, lastAction: null }
  }
}

function writeSyncStatus(patch: Partial<SyncStatus>): SyncStatus {
  const next: SyncStatus = { ...getSyncStatus(), ...patch, enabled: hasSyncToken() }
  try {
    window.localStorage.setItem(SYNC_STATUS_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
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

/** Public read — no token. Uses raw GitHub so updates show before Pages finishes redeploying. */
export async function fetchRemoteBookmarks(): Promise<BookmarkCatalog> {
  try {
    const response = await fetch(`${RAW_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return emptyCatalog()
    const catalog = parseCatalog(await response.json())
    if (catalog.bookmarks.length > 0 || catalog.updatedAt) {
      writeSyncStatus({ lastAction: "pull", lastCount: catalog.bookmarks.length })
    }
    return catalog
  } catch {
    return emptyCatalog()
  }
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
export async function validateSyncToken(token = getSyncToken()): Promise<{ ok: true; login?: string } | { ok: false; error: string }> {
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

async function putCatalog(token: string, catalog: BookmarkCatalog, sha: string): Promise<Response> {
  const body: Record<string, string> = {
    message: `Sync saved pairs (${catalog.bookmarks.length})`,
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

/** Publish the merged bookmark list to the repo (requires a fine-grained PAT with Contents: Write). */
export async function publishBookmarks(bookmarks: SavedAnalysisMeta[]): Promise<BookmarkCatalog> {
  const token = getSyncToken()
  if (!token) throw new Error("Add a GitHub sync token first.")

  const catalog: BookmarkCatalog = {
    version: 1,
    updatedAt: new Date().toISOString(),
    bookmarks: [...bookmarks].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  }

  try {
    let { sha } = await readRemoteFile(token)
    let response = await putCatalog(token, catalog, sha)
    // Stale sha (another publish landed) — refresh and retry once.
    if (response.status === 409) {
      ;({ sha } = await readRemoteFile(token))
      response = await putCatalog(token, catalog, sha)
    }
    if (!response.ok) {
      const detail = await readGithubError(response)
      const message = authErrorMessage(response.status, detail)
      writeSyncStatus({ lastError: message, lastAction: "publish" })
      throw new Error(message)
    }
    writeSyncStatus({
      lastOkAt: catalog.updatedAt,
      lastError: null,
      lastCount: catalog.bookmarks.length,
      lastAction: "publish",
    })
    return catalog
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("GitHub")) throw error
    const message = error instanceof Error ? error.message : "Publish failed."
    writeSyncStatus({ lastError: message, lastAction: "publish" })
    throw error instanceof Error ? error : new Error(message)
  }
}

export function clearSync(): void {
  setSyncToken("")
  try {
    window.localStorage.removeItem(SYNC_STATUS_KEY)
  } catch {
    // ignore
  }
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
