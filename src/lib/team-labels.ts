import { normalizeAddress, sumDecimals } from "./format"

export const TEAM_LABELS_KEY = "pairsheet.teamLabels"

export type TeamLabel = {
  id: string
  name: string
  addresses: string[]
  updatedAt: string
}

export type LabelMode = "only" | "without"

const ADDRESS = /0x[a-fA-F0-9]{40}/g

/** Pull full 0x addresses out of lines, commas, or spaces. Short or broken tokens are dropped. */
export function parseTeamAddresses(text: string): string[] {
  const seen = new Set<string>()
  const addresses: string[] = []
  for (const match of text.match(ADDRESS) ?? []) {
    const address = normalizeAddress(match)
    if (seen.has(address)) continue
    seen.add(address)
    addresses.push(address)
  }
  return addresses
}

export function readTeamLabels(): TeamLabel[] {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TEAM_LABELS_KEY) || "null") as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const row = item as Partial<TeamLabel>
      const name = typeof row.name === "string" ? row.name.trim() : ""
      const addresses = Array.isArray(row.addresses) ? parseTeamAddresses(row.addresses.join("\n")) : []
      if (!name || !row.id || addresses.length === 0) return []
      return [{ id: String(row.id), name, addresses, updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "" }]
    })
  } catch {
    return []
  }
}

export function writeTeamLabels(labels: TeamLabel[]): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(TEAM_LABELS_KEY, JSON.stringify(labels))
  } catch {
    // Storage can be blocked; the in-memory list still works for this visit.
  }
}

/** Add this label, or replace the one being edited / the one with the same name. Other labels stay. */
export function saveTeamLabel(
  labels: TeamLabel[],
  input: { id?: string | null; name: string; addresses: string[] },
  now = new Date().toISOString(),
): TeamLabel[] {
  const name = input.name.trim()
  const addresses = parseTeamAddresses(input.addresses.join("\n"))
  if (!name || addresses.length === 0) return labels
  const sameName = labels.find((label) => label.name.toLowerCase() === name.toLowerCase())
  const id = input.id || sameName?.id || newLabelId()
  const next = labels.filter((label) => label.id !== id && label.name.toLowerCase() !== name.toLowerCase())
  return [{ id, name, addresses, updatedAt: now }, ...next]
}

export function deleteTeamLabel(labels: TeamLabel[], id: string): TeamLabel[] {
  return labels.filter((label) => label.id !== id)
}

export function makerInLabel(maker: string, addresses: ReadonlySet<string>, mode: LabelMode): boolean {
  const hit = Boolean(maker) && addresses.has(normalizeAddress(maker))
  return mode === "only" ? hit : !hit
}

/** Buys add the quote amount, sells subtract it. Adds, removes, and init are not part of the net. */
export function netQuoteFlow(trades: { type: string; quoteAmount: string }[]): string {
  const parts: string[] = []
  for (const trade of trades) {
    if (trade.type !== "BUY" && trade.type !== "SELL") continue
    if (!/^\d+(\.\d+)?$/.test(trade.quoteAmount)) continue
    parts.push(trade.type === "SELL" ? negate(trade.quoteAmount) : trade.quoteAmount)
  }
  if (parts.length === 0) return "0"
  return sumDecimals(parts)
}

function negate(amount: string): string {
  if (amount.startsWith("-")) return amount.slice(1) || "0"
  if (amount === "0") return "0"
  return `-${amount}`
}

function newLabelId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  return `label-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
