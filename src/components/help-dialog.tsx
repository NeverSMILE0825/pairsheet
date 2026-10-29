"use client"

import { useEffect, useId, useState } from "react"
import { CircleHelp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HELP_SECTIONS, HELP_UPDATED_AT } from "@/lib/help-content"

export function HelpDialogButton() {
  const [open, setOpen] = useState(false)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-9 text-muted-foreground hover:text-foreground"
        aria-label="Open Pair Sheet help"
        title="Help"
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="size-5" />
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(44rem,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <h2 id={titleId} className="text-base font-semibold tracking-tight">
                  Pair Sheet help
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Features and examples · updated {HELP_UPDATED_AT}
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close help" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <nav
              className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 sm:px-4"
              aria-label="Help sections"
            >
              {HELP_SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#help-${section.id}`}
                  className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {section.title}
                </a>
              ))}
            </nav>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-5">
              {HELP_SECTIONS.map((section) => (
                <section key={section.id} id={`help-${section.id}`} className="scroll-mt-3">
                  <h3 className="font-heading text-lg font-semibold tracking-tight">{section.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{section.summary}</p>
                  <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                  {section.examples?.length ? (
                    <div className="mt-3 space-y-2">
                      {section.examples.map((example) => (
                        <div
                          key={example.title}
                          className="rounded-xl bg-muted/50 px-3 py-2.5 ring-1 ring-foreground/5"
                        >
                          <p className="text-xs font-semibold tracking-wide text-primary uppercase">{example.title}</p>
                          <p className="mt-1 font-mono text-xs leading-relaxed break-all text-foreground/90">
                            {example.body}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
