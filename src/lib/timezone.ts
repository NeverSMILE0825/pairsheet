export const AUTO_ZONE = "auto"

export type DateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function detectZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function clampParts(value: DateTimeParts): DateTimeParts {
  const maxDay = daysInMonth(value.year, value.month)
  return {
    year: value.year,
    month: Math.min(12, Math.max(1, value.month)),
    day: Math.min(maxDay, Math.max(1, value.day)),
    hour: Math.min(23, Math.max(0, value.hour)),
    minute: Math.min(59, Math.max(0, value.minute)),
    second: Math.min(59, Math.max(0, value.second)),
  }
}

export function dateToParts(date: Date, zone: string): DateTimeParts {
  const p = parts(date, zone)
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  }
}

export function isoToParts(iso: string, zone: string): DateTimeParts | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return dateToParts(date, zone)
}

/** Wall-clock time in `zone` → UTC Date (handles DST by refining the offset). */
export function zonedPartsToUtc(value: DateTimeParts, zone: string): Date {
  const fixed = clampParts(value)
  const want = Date.UTC(fixed.year, fixed.month - 1, fixed.day, fixed.hour, fixed.minute, fixed.second)
  let guess = want
  for (let i = 0; i < 4; i += 1) {
    const got = dateToParts(new Date(guess), zone)
    const asUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second)
    const delta = want - asUtc
    if (delta === 0) break
    guess += delta
  }
  return new Date(guess)
}

/** Inclusive end of the chosen second (ms). */
export function zonedPartsEndMs(value: DateTimeParts, zone: string): number {
  return zonedPartsToUtc(value, zone).getTime() + 999
}

export function formatParts(value: DateTimeParts): string {
  const fixed = clampParts(value)
  const yy = String(fixed.year).slice(-2)
  return `${MONTH_SHORT[fixed.month - 1]} ${fixed.day} ${yy} ${pad2(fixed.hour)}:${pad2(fixed.minute)}:${pad2(fixed.second)}`
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function resolveZone(choice: string): string {
  const zone = choice === AUTO_ZONE ? detectZone() : choice
  return isValidZone(zone) ? zone : "UTC"
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

function parts(date: Date, zone: string, extra: Intl.DateTimeFormatOptions = {}) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...extra,
  })
  const map: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) map[part.type] = part.value
  return map
}

// "2024-08-04 15:54:23" in the chosen zone, for the CSV.
export function formatZoned(iso: string, zone: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const p = parts(date, zone)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
}

// "Aug 4 24 15:54:23" in the chosen zone, for the table.
export function formatTradeDate(iso: string, zone = "UTC"): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const p = parts(date, zone, { month: "short", day: "numeric", year: "2-digit" })
  return `${p.month} ${p.day} ${p.year} ${p.hour}:${p.minute}:${p.second}`
}

// Short name such as "UTC", "GMT+9" or "PDT" for the column header.
export function zoneAbbreviation(zone: string, at = new Date()): string {
  return parts(at, zone, { timeZoneName: "short" }).timeZoneName ?? zone
}

export function offsetMinutes(zone: string, at = new Date()): number {
  const p = parts(at, zone)
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000)
}

export function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+"
  const abs = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`
}

export type ZoneOption = { value: string; label: string }

export function zoneOptions(at = new Date()): ZoneOption[] {
  let names: string[] = []
  try {
    names = (Intl as unknown as { supportedValuesOf: (key: string) => string[] }).supportedValuesOf("timeZone")
  } catch {
    names = []
  }
  if (!names.includes("UTC")) names = ["UTC", ...names]
  return names
    .map((name) => ({ name, minutes: offsetMinutes(name, at) }))
    .sort((a, b) => a.minutes - b.minutes || a.name.localeCompare(b.name))
    .map(({ name, minutes }) => ({ value: name, label: `(${offsetLabel(minutes)}) ${name.replace(/_/g, " ")}` }))
}
