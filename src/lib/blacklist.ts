const STORAGE_KEY = "pairsheet.blacklist.v1"

export function blacklistPoolKey(chainId: string, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}

/** Append ids that are not already listed. Same array when nothing new is added. */
export function addBlacklistIds(current: string[], incoming: string[]): string[] {
  if (incoming.length === 0) return current
  const seen = new Set(current)
  const next = [...current]
  for (const id of incoming) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    next.push(id)
  }
  return next.length === current.length ? current : next
}

/** Drop ids. Same array when none of them were listed. */
export function removeBlacklistIds(current: string[], remove: Set<string>): string[] {
  if (remove.size === 0) return current
  const next = current.filter((id) => !remove.has(id))
  return next.length === current.length ? current : next
}

export function readBlacklist(poolKey: string): string[] {
  if (!poolKey || typeof localStorage === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    const ids = all[poolKey]
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => typeof id === "string" && id.length > 0)
  } catch {
    return []
  }
}

export function writeBlacklist(poolKey: string, ids: string[]): void {
  if (!poolKey || typeof localStorage === "undefined") return
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    all[poolKey] = ids
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch {
    return
  }
}
