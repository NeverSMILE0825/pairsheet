export const ETHERSCAN_KEYS_STORAGE = "pairsheet.etherscanKeys"

export type EtherscanKey = {
  id: string
  name: string
  key: string
  updatedAt: string
}

const KEY_PATTERN = /^[A-Za-z0-9]{20,80}$/

export function normalizeEtherscanKey(value: string): string | null {
  const key = value.trim()
  return KEY_PATTERN.test(key) ? key : null
}

export function maskEtherscanKey(key: string): string {
  const tail = key.slice(-4)
  return `••••${tail}`
}

export function readEtherscanKeys(): EtherscanKey[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ETHERSCAN_KEYS_STORAGE) || "null") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as Partial<EtherscanKey>
      const key = typeof row.key === "string" ? normalizeEtherscanKey(row.key) : null
      if (!key || !row.id) return []
      return [
        {
          id: String(row.id),
          name: typeof row.name === "string" ? row.name.trim() : "",
          key,
          updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
        },
      ]
    })
  } catch {
    return []
  }
}

export function writeEtherscanKeys(keys: EtherscanKey[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ETHERSCAN_KEYS_STORAGE, JSON.stringify(keys))
}

/** Add this key, or replace the saved row with the same key. Other keys stay. */
export function saveEtherscanKey(
  keys: EtherscanKey[],
  input: { name: string; key: string },
  now = new Date().toISOString(),
): EtherscanKey[] | null {
  const key = normalizeEtherscanKey(input.key)
  if (!key) return null
  const name = input.name.trim()
  const existing = keys.find((row) => row.key === key)
  const id = existing?.id || newKeyId()
  const next = keys.filter((row) => row.key !== key && row.id !== id)
  return [{ id, name, key, updatedAt: now }, ...next]
}

export type EtherscanKeyPaste = {
  keys: EtherscanKey[]
  added: number
  updated: number
  invalid: number
}

const KEY_RE = /[A-Za-z0-9]{20,80}/g

/** One key per line, several on a line, or a key buried in `apikey=` / quotes. A name may sit beside one key. */
export function parseEtherscanKeyPaste(text: string): { entries: Array<{ name: string; key: string }>; invalid: number } {
  const entries: Array<{ name: string; key: string }> = []
  const seen = new Set<string>()
  let invalid = 0
  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const found: string[] = []
    for (const match of line.matchAll(KEY_RE)) {
      const key = normalizeEtherscanKey(match[0])
      if (key) found.push(key)
    }
    if (found.length === 0) {
      if (line.length >= 8) invalid += 1
      continue
    }
    const label =
      found.length === 1
        ? line
            .replace(found[0], " ")
            .replace(/[^\w .+-]+/g, " ")
            .replace(/\b(api\s*key|apikey|key)\b/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
        : ""
    for (const key of found) {
      if (seen.has(key)) continue
      seen.add(key)
      entries.push({ name: label, key })
    }
  }
  return { entries, invalid }
}

/** Save every key in a paste. Existing keys stay. A repeated key updates that row. */
export function saveEtherscanKeys(
  keys: EtherscanKey[],
  input: { name?: string; text: string },
  now = new Date().toISOString(),
): EtherscanKeyPaste | null {
  const parsed = parseEtherscanKeyPaste(input.text)
  if (parsed.entries.length === 0) return null
  const shared = (input.name ?? "").trim()
  let next = keys
  let added = 0
  let updated = 0
  for (let index = parsed.entries.length - 1; index >= 0; index -= 1) {
    const entry = parsed.entries[index]
    const had = next.some((row) => row.key === entry.key)
    const name = entry.name || (parsed.entries.length === 1 ? shared : "")
    const saved = saveEtherscanKey(next, { name, key: entry.key }, now)
    if (!saved) continue
    next = saved
    if (had) updated += 1
    else added += 1
  }
  return { keys: next, added, updated, invalid: parsed.invalid }
}

export function deleteEtherscanKey(keys: EtherscanKey[], id: string): EtherscanKey[] {
  return keys.filter((row) => row.id !== id)
}

const KEY_DB = "pairsheet-etherscan-keys"
const KEY_STORE = "keys"
const KEY_RECORD = "list"

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB, 1)
    request.onerror = () => reject(request.error ?? new Error("Could not open key storage."))
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
    }
  })
}

async function readKeyDb(): Promise<EtherscanKey[]> {
  if (typeof indexedDB === "undefined") return []
  const db = await openKeyDb()
  try {
    const tx = db.transaction(KEY_STORE, "readonly")
    const row = await idbRequest(tx.objectStore(KEY_STORE).get(KEY_RECORD) as IDBRequest<EtherscanKey[] | undefined>)
    await idbDone(tx)
    return Array.isArray(row) ? row.flatMap(storedKey) : []
  } finally {
    db.close()
  }
}

async function writeKeyDb(keys: EtherscanKey[]): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await openKeyDb()
  try {
    const tx = db.transaction(KEY_STORE, "readwrite")
    tx.objectStore(KEY_STORE).put(keys, KEY_RECORD)
    await idbDone(tx)
  } finally {
    db.close()
  }
}

function storedKey(item: EtherscanKey): EtherscanKey[] {
  const key = item && typeof item.key === "string" ? normalizeEtherscanKey(item.key) : null
  if (!key || !item.id) return []
  return [
    {
      id: String(item.id),
      name: typeof item.name === "string" ? item.name.trim() : "",
      key,
      updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
    },
  ]
}

function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Key storage request failed."))
  })
}

function idbDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Key storage failed."))
    tx.onabort = () => reject(tx.error ?? new Error("Key storage was aborted."))
  })
}

/** Keys saved on this browser. IndexedDB is the copy that survives a reload; localStorage is the fast copy Funded by reads. */
export async function loadEtherscanKeys(): Promise<EtherscanKey[]> {
  const local = readEtherscanKeys()
  let stored: EtherscanKey[] = []
  try {
    stored = await readKeyDb()
  } catch {
    stored = []
  }
  if (stored.length === 0 && local.length > 0) {
    await writeKeyDb(local).catch(() => undefined)
    return local
  }
  if (stored.length > 0) {
    try {
      writeEtherscanKeys(stored)
    } catch {
      // IndexedDB still has the list.
    }
    return stored
  }
  return local
}

/** Same durability idea as a saved pair: write the list, and fail only when this browser rejected both stores. */
export async function persistEtherscanKeys(keys: EtherscanKey[]): Promise<void> {
  let stored = false
  try {
    writeEtherscanKeys(keys)
    stored = true
  } catch {
    stored = false
  }
  try {
    await writeKeyDb(keys)
    stored = true
  } catch {
    // localStorage may already hold the list.
  }
  if (!stored) throw new Error("This browser blocked saving the keys. Allow site storage, then try Save keys again.")
}

function newKeyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
