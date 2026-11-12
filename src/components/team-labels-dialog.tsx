"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteTeamLabel, parseTeamAddresses, saveTeamLabel, type TeamLabel } from "@/lib/team-labels"

export function TeamLabelsDialog({
  open,
  labels,
  onClose,
  onChange,
}: {
  open: boolean
  labels: TeamLabel[]
  onClose: () => void
  onChange: (next: TeamLabel[]) => void
}) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  const parsed = useMemo(() => parseTeamAddresses(text), [text])

  if (!open) return null

  function clearForm() {
    setName("")
    setText("")
    setEditingId(null)
  }

  function save() {
    const next = saveTeamLabel(labels, { id: editingId, name, addresses: parsed })
    if (next === labels) {
      setNotice("Enter a label name and at least one full 0x address.")
      return
    }
    onChange(next)
    clearForm()
    setNotice(`Saved ${name.trim()} · ${parsed.length.toLocaleString("en-US")} addresses. Other labels were kept.`)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="team-labels-title"
        className="grid max-h-[90vh] w-full max-w-5xl gap-4 overflow-y-auto rounded-2xl bg-card p-4 shadow-xl ring-1 ring-foreground/10 sm:grid-cols-2 sm:p-5"
      >
        <div>
          <h2 id="team-labels-title" className="text-base font-semibold tracking-tight">
            Team wallet labels
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Saved on this browser. A maker can belong to more than one label.</p>
          <label className="mt-4 block text-sm font-medium" htmlFor="team-label-name">
            Label name <span className="font-normal text-muted-foreground">e.g. ETH, GTA</span>
          </label>
          <Input
            id="team-label-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="ETH"
            className="mt-1 h-11"
            spellCheck={false}
          />
          <div className="mt-3 flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium" htmlFor="team-label-addresses">
              Team wallet addresses
            </label>
            <span className="text-xs text-muted-foreground">{parsed.length.toLocaleString("en-US")} addresses</span>
          </div>
          <textarea
            id="team-label-addresses"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="mt-1 h-48 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Paste one full 0x address per line. Commas and spaces also work. Saving this name replaces that label and keeps the others.
          </p>
          {notice ? (
            <p className={`mt-2 text-sm ${notice.startsWith("Saved") ? "text-emerald-300" : "text-amber-300"}`}>{notice}</p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" className="h-11" onClick={save}>
              Save team wallet list
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                clearForm()
                setNotice(null)
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 p-3">
          <h3 className="text-sm font-semibold">Saved labels</h3>
          {labels.length === 0 ? (
            <p className="px-1 py-8 text-sm text-muted-foreground">No labels yet. Save a name and its wallets to filter the tape.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {labels.map((label) => (
                <li key={label.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background px-3 py-2">
                  <p className="min-w-0 text-sm">
                    <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-300">{label.name}</span>
                    <span className="ml-2 text-muted-foreground">{label.addresses.length.toLocaleString("en-US")} addresses</span>
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(label.id)
                        setName(label.name)
                        setText(label.addresses.join("\n"))
                        setNotice(null)
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        onChange(deleteTeamLabel(labels, label.id))
                        if (editingId === label.id) clearForm()
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
