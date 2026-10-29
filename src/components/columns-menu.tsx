"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Columns3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ColumnDef } from "@/lib/table-columns"
import { countVisible } from "@/lib/table-columns"

export function ColumnsMenu<Id extends string>({
  label,
  defs,
  visibility,
  onChange,
  onReset,
  resolveLabel,
}: {
  label?: string
  defs: ColumnDef<Id>[]
  visibility: Record<Id, boolean>
  onChange: (id: Id, visible: boolean) => void
  onReset: () => void
  resolveLabel?: (id: Id, fallback: string) => string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const visible = countVisible(visibility)

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("mousedown", onPointer)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onPointer)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <Columns3 className="size-3.5" />
        {label ?? "Columns"}
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {visible}/{defs.length}
        </span>
      </Button>
      {open ? (
        <div
          role="dialog"
          aria-labelledby={titleId}
          className="absolute right-0 z-40 mt-2 w-72 rounded-xl bg-card p-3 shadow-xl ring-1 ring-foreground/10"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p id={titleId} className="text-sm font-semibold">
              Show columns
            </p>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onReset}>
              Show all
            </Button>
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {defs.map((col) => {
              const checked = visibility[col.id]
              const alone = checked && visible <= 1
              return (
                <li key={col.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={checked}
                      disabled={alone}
                      onChange={(event) => onChange(col.id, event.target.checked)}
                    />
                    <span className="min-w-0 truncate">{resolveLabel?.(col.id, col.label) ?? col.label}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Hide unused columns to shrink horizontal scrolling. At least one column stays on.
          </p>
        </div>
      ) : null}
    </div>
  )
}
