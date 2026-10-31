"use client"

import { useEffect, useId, useMemo } from "react"
import { FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  buildBehaviourReport,
  formatWindowParagraph,
  type BehaviourReport,
} from "@/lib/behaviour-report"
import type { PoolView, Trade } from "@/lib/types"

type Props = {
  open: boolean
  onClose: () => void
  pool: PoolView
  trades: Trade[]
}

function isoLabel(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, " UTC").replace("T", " ")
}

export function BehaviourReportDialog({ open, onClose, pool, trades }: Props) {
  const titleId = useId()
  const report = useMemo((): BehaviourReport | null => {
    if (!open) return null
    return buildBehaviourReport(trades, pool)
  }, [open, trades, pool])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(44rem,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <FileText className="size-4 shrink-0 text-primary" aria-hidden />
              Buy &amp; sell behaviour report
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {pool.baseSymbol} / {pool.quoteSymbol} · {pool.dex}
            </p>
          </div>
          <Button type="button" size="icon" variant="ghost" aria-label="Close report" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm leading-relaxed sm:px-5">
          {!report ? (
            <p className="text-muted-foreground">Load swaps first, then generate a report.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {pool.baseSymbol} / {pool.quoteSymbol} on {pool.dex} from {isoLabel(report.startIso)} to{" "}
                {isoLabel(report.endIso)}. How buying and selling changed from launch onward (figures
                rounded to 2 decimals).
              </p>

              {report.windows.map((window) => (
                <section key={window.id} className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground capitalize">{window.label}</h3>
                  <p className="text-foreground/90">{formatWindowParagraph(window, report.quoteSymbol)}</p>
                </section>
              ))}

              <section className="space-y-1.5 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">How the story shifted</h3>
                <p className="text-foreground/90">{report.story}</p>
              </section>
            </>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-4 py-3 sm:px-5">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
