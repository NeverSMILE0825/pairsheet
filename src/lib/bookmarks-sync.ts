import type { SavedAnalysisMeta } from "./saved-analyses"

/** Shared bookmark catalog lives in the pairsheet repo so every browser can read it. */
export const SYNC_REPO = "NeverSMILE0825/pairsheet"
export const SYNC_PATH = "public/data/bookmarks.json"
export const SYNC_TOKEN_KEY = "pairsheet.githubSyncToken"

const RAW_URL = `https://raw.githubusercontent.com/${SYNC_REPO}/main/${SYNC_PATH}`
const CONTENTS_URL = `https://api.github.com/repos/${SYNC_REPO}/contents/${SYNC_PATH}`

export type BookmarkCatalog = {
  version: 1
  updatedAt: string | null
  bookmarks: SavedAnalysisMeta[]
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

/** Public read — no token. Uses raw GitHub so updates show before Pages finishes redeploying. */
export async function fetchRemoteBookmarks(): Promise<BookmarkCatalog> {
  try {
    const response = await fetch(`${RAW_URL}?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) return emptyCatalog()
    return parseCatalog(await response.json())
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
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) {
    return { sha: "", catalog: emptyCatalog() }
  }
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub read failed (${response.status}): ${text.slice(0, 160)}`)
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

/** Publish the merged bookmark list to the repo (requires a fine-grained PAT with Contents: Write). */
export async function publishBookmarks(bookmarks: SavedAnalysisMeta[]): Promise<BookmarkCatalog> {
  const token = getSyncToken()
  if (!token) throw new Error("Add a GitHub sync token first.")

  const catalog: BookmarkCatalog = {
    version: 1,
    updatedAt: new Date().toISOString(),
    bookmarks: [...bookmarks].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  }
  const { sha } = await readRemoteFile(token)
  const body: Record<string, string> = {
    message: `Sync saved pairs (${catalog.bookmarks.length})`,
    content: toBase64(`${JSON.stringify(catalog, null, 2)}\n`),
    branch: "main",
  }
  if (sha) body.sha = sha

  const response = await fetch(CONTENTS_URL, {
    method: "PUT",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) {
    const text = await response.text()
    if (response.status === 401 || response.status === 403) {
      throw new Error("GitHub rejected the sync token. Create a fine-grained PAT with Contents: Read and Write on NeverSMILE0825/pairsheet.")
    }
    throw new Error(`GitHub publish failed (${response.status}): ${text.slice(0, 160)}`)
  }
  return catalog
}

export function syncTokenHelpUrl(): string {
  return "https://github.com/settings/personal-access-tokens/new"
}
