"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  deleteEtherscanKey,
  maskEtherscanKey,
  parseEtherscanKeyPaste,
  saveEtherscanKeys,
  type EtherscanKey,
} from "@/lib/etherscan-keys"

export function EtherscanKeysDialog({
  open,
  keys,
  onClose,
  onChange,
  onNotice,
}: {
  open: boolean
  keys: EtherscanKey[]
  onClose: () => void
  onChange: (next: EtherscanKey[]) => void | Promise<void>
  onNotice?: (message: string, tone: "ok" | "error" | "info") => void
}) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const parsed = useMemo(() => parseEtherscanKeyPaste(`${name}\n${text}`), [name, text])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  async function storeKeys(source: string, emptyMessage: string, savedMessage: (added: number, updated: number, invalid: number) => string) {
    const nameIsKey = parseEtherscanKeyPaste(name).entries.length > 0
    const result = saveEtherscanKeys(keys, {
      name: nameIsKey ? "" : name,
      text: source,
    })
    if (!result) {
      setNotice({ tone: "error", message: emptyMessage })
      onNotice?.(emptyMessage, "error")
      return
    }
    setBusy(true)
    try {
      await onChange(result.keys)
      setName("")
      setText("")
      const message = savedMessage(result.added, result.updated, result.invalid)
      setNotice({ tone: "ok", message })
      onNotice?.(message, "ok")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save these keys."
      setNotice({ tone: "error", message })
      onNotice?.(message, "error")
    } finally {
      setBusy(false)
    }
  }

  function savedSummary(added: number, updated: number, invalid: number): string {
    const kept = updated > 0 ? ` ${updated.toLocaleString("en-US")} already saved, kept.` : ""
    const skipped = invalid > 0 ? ` ${invalid.toLocaleString("en-US")} line(s) were not keys.` : ""
    return `Saved ${added.toLocaleString("en-US")} Etherscan key${added === 1 ? "" : "s"} on this browser.${kept}${skipped}`
  }

  function save() {
    const nameIsKey = parseEtherscanKeyPaste(name).entries.length > 0
    return storeKeys(
      nameIsKey ? `${name}\n${text}` : text,
      "No API key found. Paste one or more keys, one per line, then click Save keys.",
      savedSummary,
    )
  }

  async function loadFile(file: File | null) {
    const input = fileRef.current
    if (input) input.value = ""
    if (!file) return
    let contents = ""
    try {
      contents = (await file.text()).replace(/^\uFEFF/, "")
    } catch {
      const message = `Could not read ${file.name}.`
      setNotice({ tone: "error", message })
      onNotice?.(message, "error")
      return
    }
    const label = file.name
    await storeKeys(
      contents,
      `No API key found in ${label}. Use a text file with one key per line.`,
      (added, updated, invalid) => `Loaded ${label}. ${savedSummary(added, updated, invalid)}`,
    )
  }

  async function remove(id: string) {
    setBusy(true)
    try {
      await onChange(deleteEtherscanKey(keys, id))
      const message = "Deleted that key. The others were kept."
      setNotice({ tone: "ok", message })
      onNotice?.(message, "info")
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not delete that key."
      setNotice({ tone: "error", message })
      onNotice?.(message, "error")
    } finally {
      setBusy(false)
    }
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
        aria-labelledby="etherscan-keys-title"
        className="flex max-h-[min(40rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="etherscan-keys-title" className="text-base font-semibold tracking-tight">
            Etherscan API keys
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved on this browser, the same way a pair snapshot is kept here. Not synced to GitHub — the shared pair list is public.
          </p>
        </div>

        {notice ? (
          <p
            className={`border-b border-border px-4 py-2 text-sm ${
              notice.tone === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
            }`}
            role="status"
          >
            {notice.message}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {keys.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No keys saved yet. Paste keys below, or Load file, then they stay on this browser. Funded by still works without them.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {keys.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name || "Key"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{maskEtherscanKey(row.key)}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-rose-300 hover:text-rose-200"
                    aria-label={`Delete key ending ${row.key.slice(-4)}`}
                    disabled={busy}
                    onClick={() => void remove(row.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid gap-2 border-t border-border px-4 py-3">
          <label className="text-sm font-medium" htmlFor="etherscan-key-value">
            Paste keys <span className="font-normal text-muted-foreground">{parsed.entries.length.toLocaleString("en-US")} ready</span>
          </label>
          <textarea
            id="etherscan-key-value"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"One key per line\nABC…\nDEF…"}
            autoComplete="off"
            spellCheck={false}
            className="h-28 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <label className="text-xs text-muted-foreground" htmlFor="etherscan-key-name">
            Name for a single key (optional)
          </label>
          <input
            id="etherscan-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Main"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,.text,text/plain"
              className="hidden"
              onChange={(event) => void loadFile(event.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" />
              Load file
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Close
            </Button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save keys
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
