const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉"

export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n
  const value = negative ? -raw : raw
  const base = 10n ** BigInt(decimals)
  const whole = value / base
  const fraction = value % base
  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")
  const body = fractionText ? `${whole.toString()}.${fractionText}` : whole.toString()
  return negative ? `-${body}` : body
}

export function formatScaled(scaled: bigint, places: number): string {
  const negative = scaled < 0n
  const value = negative ? -scaled : scaled
  const base = 10n ** BigInt(places)
  const whole = value / base
  const fraction = (value % base).toString().padStart(places, "0").replace(/0+$/, "")
  const body = fraction ? `${whole.toString()}.${fraction}` : whole.toString()
  return negative ? `-${body}` : body
}

export function priceInQuote(
  quoteRaw: bigint,
  quoteDecimals: number,
  baseRaw: bigint,
  baseDecimals: number,
  places = 18,
): string {
  if (baseRaw === 0n) return "0"
  const scale = 10n ** BigInt(places)
  const scaled =
    (quoteRaw * scale * 10n ** BigInt(baseDecimals)) /
    (baseRaw * 10n ** BigInt(quoteDecimals))
  return formatScaled(scaled, places)
}

export function totalUsd(
  quoteRaw: bigint,
  quoteDecimals: number,
  quotePrice: number,
): string | null {
  if (!Number.isFinite(quotePrice) || quotePrice < 0) return null
  const priceScale = 8
  const priceInt = BigInt(Math.round(quotePrice * 10 ** priceScale))
  const places = 8
  const scaled =
    (quoteRaw * priceInt * 10n ** BigInt(places)) /
    (10n ** BigInt(quoteDecimals) * 10n ** BigInt(priceScale))
  return formatScaled(scaled, places)
}

export function priceUsdFromTotal(total: string, baseAmount: string): string | null {
  const totalValue = Number(total)
  const baseValue = Number(baseAmount)
  if (!Number.isFinite(totalValue) || !Number.isFinite(baseValue) || baseValue === 0) {
    return null
  }
  const price = totalValue / baseValue
  if (!Number.isFinite(price)) return null
  return price.toFixed(18).replace(/0+$/, "").replace(/\.$/, "")
}

// Whole tokens for the base-token column. Half amounts round away from zero.
export function formatIntegerAmount(amount: string): string {
  const trimmed = amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "—"
  const negative = trimmed.startsWith("-")
  const [whole, fraction = ""] = trimmed.slice(negative ? 1 : 0).split(".")
  let value = BigInt(whole)
  if (fraction[0] !== undefined && fraction[0] >= "5") value += 1n
  const grouped = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return negative && value !== 0n ? `-${grouped}` : grouped
}

export function formatGroupedAmount(amount: string): string {
  const negative = amount.startsWith("-")
  const [whole, fraction = ""] = amount.replace("-", "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  let shown = grouped
  if (fraction) {
    const keep = whole === "0" ? 6 : 4
    const trimmed = fraction.slice(0, keep).replace(/0+$/, "")
    if (trimmed) shown = `${grouped}.${trimmed}`
  }
  return negative ? `-${shown}` : shown
}

export function formatPoolSize(amount: string): string {
  const [whole, fraction = ""] = amount.split(".")
  if (whole !== "0" || !fraction) return formatGroupedAmount(amount)
  const zeros = fraction.length - fraction.replace(/^0+/, "").length
  const trimmed = fraction.slice(0, zeros + 4).replace(/0+$/, "")
  return trimmed ? `0.${trimmed}` : "0"
}

export function formatUsd(amount: string | null): string {
  if (!amount) return "—"
  const value = Number(amount)
  if (!Number.isFinite(value)) return "—"
  if (value === 0) return "$0"
  if (value >= 1) {
    return `$${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`
  }
  return `$${formatTiny(value)}`
}

// Dollar amounts on the maker panel. Negatives render as -$10.83.
// Amounts of $1,000,000 and up use the compact form so the column stays narrow.
export function formatPanelUsd(amount: string | null): string {
  if (amount === null) return "—"
  const trimmed = amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "—"
  const negative = trimmed.startsWith("-")
  const abs = Number(negative ? trimmed.slice(1) : trimmed)
  if (!Number.isFinite(abs)) return "—"
  if (abs >= 1_000_000) return formatCompactUsd(trimmed)
  const body = formatUsd(negative ? trimmed.slice(1) : trimmed)
  if (body === "—" || body === "$0") return body
  return negative ? `-${body}` : body
}

export function formatCompact(amount: string): string {
  const trimmed = amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "—"
  const negative = trimmed.startsWith("-")
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  const sign = negative && abs !== 0 ? "-" : ""
  if (abs === 0) return "0"
  const compact = compactMagnitude(abs)
  if (compact) return sign + compact
  if (abs >= 1) {
    return sign + abs.toLocaleString("en-US", { maximumFractionDigits: 2 })
  }
  if (abs >= 0.0001) {
    return sign + abs.toLocaleString("en-US", { maximumSignificantDigits: 4 })
  }
  return formatTiny(value)
}

export function formatCompactUsd(amount: string | null): string {
  if (amount === null) return "—"
  const compact = formatCompact(amount)
  if (compact === "—") return "—"
  if (compact === "0") return "$0"
  if (compact.startsWith("-")) return `-$${compact.slice(1)}`
  return `$${compact}`
}

// Quote-token amounts (WETH and similar) stay precise below 1,000.
export function formatQuoteAmount(amount: string): string {
  const trimmed = amount.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return "—"
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1000) return formatCompact(trimmed)
  if (abs === 0) return "0"
  if (abs < 0.0001) return formatTiny(value)
  const digits = abs >= 1 ? 4 : 6
  const text = abs.toLocaleString("en-US", { maximumFractionDigits: digits })
  return value < 0 ? `-${text}` : text
}

function compactMagnitude(abs: number): string | null {
  const units = [
    { value: 1e12, suffix: "T" },
    { value: 1e9, suffix: "B" },
    { value: 1e6, suffix: "M" },
    { value: 1e3, suffix: "K" },
  ]
  for (const unit of units) {
    if (abs >= unit.value) {
      const scaled = abs / unit.value
      const text = scaled >= 100 ? scaled.toFixed(1) : scaled.toFixed(2)
      const trimmed = text.replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")
      return `${trimmed}${unit.suffix}`
    }
  }
  return null
}

export function formatTiny(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "—"
  const sign = value < 0 ? "-" : ""
  const abs = Math.abs(value)
  if (abs === 0) return "0"
  if (abs >= 0.0001) {
    return (
      sign +
      abs.toLocaleString("en-US", {
        maximumFractionDigits: abs >= 1 ? 4 : 6,
      })
    )
  }
  const exponent = Math.floor(Math.log10(abs))
  const zeros = -exponent - 1
  const mantissa = (abs * 10 ** (zeros + 1)).toFixed(digits - 1).replace(".", "")
  const significant = mantissa.replace(/0+$/, "") || "0"
  return `${sign}0.0${toSubscript(zeros)}${significant}`
}

function toSubscript(value: number): string {
  return String(value)
    .split("")
    .map((digit) => SUBSCRIPTS[Number(digit)] ?? digit)
    .join("")
}

export function shortAddress(address: string): string {
  if (address.length < 12) return address || "—"
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** EVM hex addresses are case-insensitive; Solana base58 addresses are not. */
export function normalizeAddress(address: string): string {
  return /^0x[a-fA-F0-9]+$/.test(address) ? address.toLowerCase() : address
}

export function compareDecimal(a: string, b: string): number {
  const aNeg = a.startsWith("-")
  const bNeg = b.startsWith("-")
  if (aNeg !== bNeg) return aNeg ? -1 : 1
  const [aWhole, aFrac = ""] = a.replace("-", "").split(".")
  const [bWhole, bFrac = ""] = b.replace("-", "").split(".")
  const direction = aNeg ? -1 : 1
  if (aWhole.length !== bWhole.length) return (aWhole.length - bWhole.length) * direction
  if (aWhole !== bWhole) return (aWhole < bWhole ? -1 : 1) * direction
  const width = Math.max(aFrac.length, bFrac.length)
  const left = aFrac.padEnd(width, "0")
  const right = bFrac.padEnd(width, "0")
  if (left === right) return 0
  return (left < right ? -1 : 1) * direction
}

// Exact sum of decimal strings such as "0.3" and "4.45892281616295148".
// Uses bigint so 18-decimal token amounts do not pick up float rounding.
export function sumDecimals(values: string[]): string {
  const parts = values
    .map((value) => value.trim())
    .filter((value) => /^-?\d+(\.\d+)?$/.test(value))
    .map((value) => {
      const [whole, fraction = ""] = value.replace("-", "").split(".")
      return { negative: value.startsWith("-"), whole, fraction }
    })
  const places = parts.reduce((max, part) => Math.max(max, part.fraction.length), 0)
  let total = 0n
  for (const part of parts) {
    const scaled = BigInt(part.whole + part.fraction.padEnd(places, "0"))
    total += part.negative ? -scaled : scaled
  }
  return formatScaled(total, places)
}

export function mulDecimals(left: string, right: string): string | null {
  const a = splitDecimal(left)
  const b = splitDecimal(right)
  if (!a || !b) return null
  const product = a.scaled * b.scaled
  const signed = a.negative === b.negative || product === 0n ? product : -product
  return formatScaled(signed, a.places + b.places)
}

// part / whole, clamped to 0–1. Used for the remaining-balance bar.
export function decimalRatio(part: string, whole: string): number {
  const p = splitDecimal(part)
  const w = splitDecimal(whole)
  if (!p || !w || p.negative || w.negative) return 0
  const places = Math.max(p.places, w.places)
  const pScaled = p.scaled * 10n ** BigInt(places - p.places)
  const wScaled = w.scaled * 10n ** BigInt(places - w.places)
  if (wScaled === 0n || pScaled === 0n) return 0
  const ratio = (pScaled * 10000n) / wScaled
  return Math.min(1, Number(ratio) / 10000)
}

function splitDecimal(value: string): { negative: boolean; scaled: bigint; places: number } | null {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const fraction = match[3] ?? ""
  return {
    negative: match[1] === "-",
    scaled: BigInt(match[2] + fraction),
    places: fraction.length,
  }
}

export function formatIncome(amount: string, places = 6): string {
  const negative = amount.startsWith("-")
  const [whole, fraction = ""] = amount.replace("-", "").split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  const trimmed = fraction.slice(0, places).replace(/0+$/, "")
  const body = trimmed ? `${grouped}.${trimmed}` : grouped
  return negative && body !== "0" ? `-${body}` : body
}
