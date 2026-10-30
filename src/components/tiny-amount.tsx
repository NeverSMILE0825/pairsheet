import { formatTinyParts } from "@/lib/format"

type TinyAmountProps = {
  value: number | string | null | undefined
  /** e.g. "$" for USD prices */
  prefix?: string
  className?: string
}

/**
 * Renders tiny prices as 0.0₈123 with a bold, enlarged zero-count so the
 * subscript-style digit stays readable in table mono text.
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
    <span className={`inline-flex items-baseline whitespace-nowrap tabular-nums ${className ?? ""}`}>
      {prefix}
      {parts.sign}
      0.0
      <span
        className="mx-px inline-flex min-w-[0.75em] translate-y-[0.08em] items-center justify-center rounded-sm bg-foreground/10 px-0.5 text-[1.2em] font-extrabold leading-none text-foreground"
        title={`${parts.zeros} zero${parts.zeros === 1 ? "" : "s"} after the decimal`}
      >
        {parts.zeros}
      </span>
      {parts.significant}
    </span>
  )
}
