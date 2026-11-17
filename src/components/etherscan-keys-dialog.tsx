"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  deleteEtherscanKey,
  maskEtherscanKey,
  saveEtherscanKey,
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
  const [key, setKey] = useState("")
  const [notice, setNotice] = useState<string | null>(null)

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
    const next = saveEtherscanKey(keys, { name, key })
    if (!next) {
      setNotice("Paste a full Etherscan API key (letters and numbers, at least 20 characters).")
      return
    }
    onChange(next)
    setName("")
    setKey("")
    setNotice("Saved on this browser. Keys are not synced to GitHub.")
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
        className="flex max-h-[min(36rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
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
            Name <span className="font-normal text-muted-foreground">optional</span>
          </label>
          <Input
            id="etherscan-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Main"
            autoComplete="off"
          />
          <label className="block text-sm font-medium" htmlFor="etherscan-key-value">
            API key
          </label>
          <Input
            id="etherscan-key-value"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Paste an Etherscan API key"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex justify-end">
            <Button type="button" onClick={save}>
              Save key
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
