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

/** One key per line, or several on a line. A name may sit before its key: `Main ABC...`. */
export function parseEtherscanKeyPaste(text: string): { entries: Array<{ name: string; key: string }>; invalid: number } {
  const entries: Array<{ name: string; key: string }> = []
  const seen = new Set<string>()
  let invalid = 0
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/[\s,;]+/).filter(Boolean)
    const pendingName: string[] = []
    for (const part of parts) {
      const key = normalizeEtherscanKey(part)
      if (key) {
        if (!seen.has(key)) {
          seen.add(key)
          entries.push({ name: pendingName.join(" "), key })
        }
        pendingName.length = 0
        continue
      }
      if (part.length < 20) pendingName.push(part)
      else {
        invalid += 1
        pendingName.length = 0
      }
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

function newKeyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `key-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
