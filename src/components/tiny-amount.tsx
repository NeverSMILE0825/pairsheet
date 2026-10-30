import { formatTinyParts } from "@/lib/format"

type TinyAmountProps = {
  value: number | string | null | undefined
  /** e.g. "$" for USD prices */
  prefix?: string
  className?: string
}

/**
 * Tiny prices as 0.0₈123. The zero-count uses a normal digit (not Unicode
 * subscript glyphs), sized a bit above the old tiny subscripts so it stays
 * readable without a heavy badge.
 */
export function TinyAmount({ value, prefix = "", className }: TinyAmountProps) {
  if (value === null || value === undefined || value === "") return "—"
  const numeric = typeof value === "number" ? value : Number(value)
  const parts = formatTinyParts(numeric)
  if (!parts) return "—"
  if (parts.kind === "plain") {
    return (
      <span className={className}>
        {prefix}
        {parts.sign}
        {parts.text}
      </span>
    )
  }
  return (
    <span className={`whitespace-nowrap tabular-nums ${className ?? ""}`}>
      {prefix}
      {parts.sign}
      0.0
      <sub
        className="bottom-0 mx-px text-[0.92em] font-bold leading-none text-foreground"
        title={`${parts.zeros} zero${parts.zeros === 1 ? "" : "s"} after the decimal`}
      >
        {parts.zeros}
      </sub>
      {parts.significant}
    </span>
  )
}
