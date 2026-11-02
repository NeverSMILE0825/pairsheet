"use client"

import { useEffect, useId, useMemo, useState } from "react"
import { Check, Copy, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  REPORT_TIME_ZONE,
  buildBehaviourReport,
  formatBehaviourReportText,
  formatDuration,
  formatPauseParagraph,
  formatReportTime,
  formatSpeedSegmentParagraph,
  formatWindowParagraph,
  type BehaviourReport,
} from "@/lib/behaviour-report"
import type { PoolView, Trade } from "@/lib/types"

type Props = {
  open: boolean
  onClose: () => void
  pool: PoolView
  trades: Trade[]
  /** Wall-clock zone for report timestamps (default US Eastern). */
  timeZone?: string
}

export function BehaviourReportDialog({
  open,
  onClose,
  pool,
  trades,
  timeZone = REPORT_TIME_ZONE,
}: Props) {
  const titleId = useId()
  const [copied, setCopied] = useState(false)
  const report = useMemo((): BehaviourReport | null => {
    if (!open) return null
    return buildBehaviourReport(trades, pool, timeZone)
  }, [open, trades, pool, timeZone])

  const plainText = useMemo(() => {
    if (!report) return ""
    return formatBehaviourReportText(report, pool, timeZone)
  }, [report, pool, timeZone])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  async function copyReport() {
    if (!plainText) return
    try {
      await navigator.clipboard.writeText(plainText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

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
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              disabled={!report}
              onClick={() => void copyReport()}
              title="Copy the full report text"
            >
              {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label="Close report" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm leading-relaxed sm:px-5">
          {!report ? (
            <p className="text-muted-foreground">Load swaps first, then generate a report.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                {pool.baseSymbol} / {pool.quoteSymbol} on {pool.dex} from {formatReportTime(report.startIso, timeZone)}{" "}
                to {formatReportTime(report.endIso, timeZone)}. How buying and selling changed from launch
                onward (figures rounded to 2 decimals).
              </p>

              {report.windows.map((window) => (
                <section key={window.id} className="space-y-1.5">
                  <h3 className="text-sm font-semibold capitalize text-foreground">{window.label}</h3>
                  <p className="text-foreground/90">
                    {formatWindowParagraph(window, report.quoteSymbol, timeZone)}
                  </p>
                </section>
              ))}

              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">Pauses — when and how long</h3>
                <p className="text-foreground/90">{report.pausesStory}</p>
                {report.pauses.length > 0 ? (
                  <ul className="list-none space-y-2 text-foreground/90">
                    {report.pauses.map((pause, index) => (
                      <li key={`${pause.startIso}-${pause.endIso}`}>
                        {formatPauseParagraph(pause, index, timeZone)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">
                    Threshold for a notable pause: {formatDuration(report.pauseThresholdSec)}.
                  </p>
                )}
              </section>

              <section className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-foreground">How buy / sell speed changed</h3>
                <p className="text-foreground/90">{report.paceStory}</p>
                <div className="space-y-3">
                  {report.speedSegments.map((seg, index) => (
                    <div key={seg.id} className="space-y-1">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {seg.label}
                      </h4>
                      <p className="text-foreground/90">
                        {formatSpeedSegmentParagraph(seg, index > 0 ? report.speedSegments[index - 1] : null)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

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
