"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
}: {
  open: boolean
  keys: EtherscanKey[]
  onClose: () => void
  onChange: (next: EtherscanKey[]) => void
}) {
  const [name, setName] = useState("")
  const [text, setText] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const parsed = useMemo(() => parseEtherscanKeyPaste(text), [text])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  function save() {
    const result = saveEtherscanKeys(keys, { name, text })
    if (!result) {
      setNotice("Paste one or more Etherscan API keys, one per line.")
      return
    }
    onChange(result.keys)
    setName("")
    setText("")
    const invalid = result.invalid > 0 ? ` ${result.invalid.toLocaleString("en-US")} line(s) were not keys.` : ""
    const updated = result.updated > 0 ? ` ${result.updated.toLocaleString("en-US")} already saved, kept.` : ""
    setNotice(
      `Saved ${result.added.toLocaleString("en-US")} key${result.added === 1 ? "" : "s"} on this browser.${updated}${invalid} Keys are not synced to GitHub.`,
    )
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
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="etherscan-keys-title" className="text-base font-semibold tracking-tight">
            Etherscan API keys
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Used for Funded by on EVM chains. Several keys run in parallel. Stored on this browser only — never synced with saved pairs.
          </p>
        </div>
        <div className="grid gap-3 overflow-y-auto px-4 py-3">
          <label className="block text-sm font-medium" htmlFor="etherscan-key-name">
            Name <span className="font-normal text-muted-foreground">optional, used when you paste one key</span>
          </label>
          <Input
            id="etherscan-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Main"
            autoComplete="off"
          />
          <div className="flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium" htmlFor="etherscan-key-value">
              API keys
            </label>
            <span className="text-xs text-muted-foreground">
              {parsed.entries.length.toLocaleString("en-US")} key{parsed.entries.length === 1 ? "" : "s"}
            </span>
          </div>
          <textarea
            id="etherscan-key-value"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={"One key per line\nABC…\nDEF…"}
            autoComplete="off"
            spellCheck={false}
            className="h-36 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex justify-end">
            <Button type="button" onClick={save}>
              Save keys
            </Button>
          </div>
          {notice ? <p className="text-sm text-muted-foreground">{notice}</p> : null}
          <ul className="grid gap-2">
            {keys.length === 0 ? (
              <li className="text-sm text-muted-foreground">No keys saved. Funded by still works through the public explorers, one wallet at a time.</li>
            ) : (
              keys.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.name || "Key"}</p>
                    <p className="font-mono text-xs text-muted-foreground">{maskEtherscanKey(row.key)}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onChange(deleteEtherscanKey(keys, row.id))
                      setNotice("Deleted. Other keys were kept.")
                    }}
                  >
                    Delete
                  </Button>
                </li>
              ))
            )}
          </ul>
        </div>
        <div className="flex justify-end border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
