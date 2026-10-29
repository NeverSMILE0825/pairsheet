"use client"

import { useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Bot, Calculator, CalendarRange, ChevronLeft, ChevronRight, Download, ExternalLink, Loader2, Users, X } from "lucide-react"
import { DateTimeField } from "@/components/datetime-field"
import { MakerCountButton } from "@/components/maker-summary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getChain, supportedChainNames } from "@/lib/chains"
import { resolveFunders } from "@/lib/funded"
import { resolveHolderCounts } from "@/lib/holders"
import { getSwapPage } from "@/lib/history"
import { AppError } from "@/lib/http"
import { lookUpWallets } from "@/lib/wallets"
import { EMPTY_FACTS, annotateTrades, routersToCheck, type WalletFacts } from "@/lib/annotate"
import { csvFilename, tradesToCsv } from "@/lib/csv"
import {
  compareDecimal,
  formatGroupedAmount,
  formatIntegerAmount,
  formatPoolSize,
  formatIncome,
  formatTiny,
  formatUsd,
  normalizeAddress,
  shortAddress,
  sumDecimals,
} from "@/lib/format"
import { latestQuotePrice, summarizeMakers } from "@/lib/maker"
import { buildMinuteTape, formatMinuteLabel, formatSpeed } from "@/lib/minute-tape"
import {
  AUTO_ZONE,
  dateToParts,
  detectZone,
  formatParts,
  formatTradeDate,
  isoToParts,
  resolveZone,
  zoneAbbreviation,
  zoneOptions,
  zonedPartsEndMs,
  zonedPartsToUtc,
  type DateTimeParts,
} from "@/lib/timezone"
import type { PoolView, SwapsResponse, Trade } from "@/lib/types"

type TableView = "transactions" | "minutes"

type PeriodFilter = { startMs: number; endMs: number }

/** Soft cap so a single browser session stays responsive; explorer windows can exceed 10k. */
const MAX_TRADES = 50000
const ZONE_KEY = "pairsheet.timezone"
const PAGE_SIZES = [25, 50, 100, 250]
const WALLET_BATCH = 12
const WALLET_ROUTER_LIMIT = 120

type Phase = "idle" | "loading" | "done" | "error"
type SideFilter = "ALL" | "BUY" | "SELL" | "ADD" | "REMOVE" | "INIT"

const FILTER_LABELS: Record<SideFilter, string> = {
  ALL: "All",
  BUY: "Buys",
  SELL: "Sells",
  ADD: "Adds",
  REMOVE: "Removes",
  INIT: "Init",
}
type SortKey =
  | "txNo"
  | "timestamp"
  | "type"
  | "priceUsd"
  | "totalUsd"
  | "priceQuote"
  | "baseAmount"
  | "quoteAmount"
  | "selected"
  | "others"
  | "baseReserve"
  | "quoteReserve"
  | "holders"
  | "maker"
  | "makerTxCount"
  | "fundedBy"

const CHAINS = supportedChainNames().join(", ")
const PAGE_ATTEMPTS = 3
const FUNDER_BATCH = 6
const FUNDER_PARALLEL = 2
const FUNDER_PASSES = 4
const FUNDER_RETRY_MS = 6000

type Income = {
  count: number
  buys: number
  sells: number
  liquidity: number
  total: string
  bought: string
  sold: string
  net: string
  usd: string | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

export function Exporter() {
  const [url, setUrl] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [pool, setPool] = useState<PoolView | null>(null)
  const [rawTrades, setTrades] = useState<Trade[]>([])
  const [facts, setFacts] = useState<WalletFacts>(EMPTY_FACTS)
  const [progress, setProgress] = useState("")
  const [capped, setCapped] = useState(false)
  const [filter, setFilter] = useState<SideFilter>("ALL")
  const [query, setQuery] = useState("")
  const [funder, setFunder] = useState("")
  const [sortKey, setSortKey] = useState<SortKey>("timestamp")
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [tableView, setTableView] = useState<TableView>("transactions")
  const [zoneChoice, setZoneChoice] = useState<string>(() => {
    if (typeof window === "undefined") return AUTO_ZONE
    try {
      return window.localStorage.getItem(ZONE_KEY) || AUTO_ZONE
    } catch {
      return AUTO_ZONE
    }
  })
  const [copied, setCopied] = useState(false)
  const [funding, setFunding] = useState<{ done: number; total: number } | null>(null)
  const [holdersBusy, setHoldersBusy] = useState(false)
  const run = useRef(0)
  const selectionAnchor = useRef<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [income, setIncome] = useState<Income | null>(null)
  const [startAt, setStartAt] = useState<DateTimeParts | null>(null)
  const [endAt, setEndAt] = useState<DateTimeParts | null>(null)
  const [period, setPeriod] = useState<PeriodFilter | null>(null)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [fromNo, setFromNo] = useState("")
  const [toNo, setToNo] = useState("")
  const [noError, setNoError] = useState<string | null>(null)

  async function lookUpWalletFacts(chainId: string, view: PoolView, loaded: Trade[], token: number) {
    const chain = getChain(chainId)
    if (!chain || chain.id === "solana") return
    const routers = routersToCheck(loaded, view.address, WALLET_ROUTER_LIMIT)
    const batches = chunk(routers, WALLET_BATCH)
    if (batches.length === 0) batches.push([])
    let next = 0
    const worker = async () => {
      while (next < batches.length && run.current === token) {
        const index = next
        next += 1
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const body = await lookUpWallets(chain, batches[index], index === 0 ? view.baseAddress : null)
            if (run.current !== token) return
            setFacts((current) => ({
              contracts: { ...current.contracts, ...body.contracts },
              deployer: body.deployer ?? current.deployer,
            }))
            break
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 2500))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: 2 }, worker))
  }

  async function lookUpFunders(chainId: string, makers: string[], token: number, loaded: Trade[] = []) {
    const chain = getChain(chainId)
    if (!chain) return
    const solana = chain.id === "solana"
    let pending = [
      ...new Set(
        makers
          .map((maker) => (solana ? maker : maker.toLowerCase()))
          .filter(Boolean),
      ),
    ]
    const earliestTradeSec = new Map<string, number>()
    if (solana) {
      for (const trade of loaded) {
        if (!trade.maker) continue
        const ts = Math.floor(Date.parse(trade.timestamp) / 1000)
        if (!Number.isFinite(ts)) continue
        const prev = earliestTradeSec.get(trade.maker)
        if (prev === undefined || ts < prev) earliestTradeSec.set(trade.maker, ts)
      }
    }
    const total = pending.length
    let done = 0
    if (total === 0) return
    setFunding({ done, total })

    for (let pass = 0; pass < FUNDER_PASSES && pending.length > 0 && run.current === token; pass += 1) {
      if (pass > 0) await new Promise((resolve) => setTimeout(resolve, FUNDER_RETRY_MS * pass))
      const batches = chunk(pending, FUNDER_BATCH)
      const retry: string[] = []
      let next = 0
      const worker = async () => {
        while (next < batches.length && run.current === token) {
          const batch = batches[next]
          next += 1
          try {
            const { found, failed } = await resolveFunders(
              chain,
              batch,
              Date.now() + 45000,
              solana ? earliestTradeSec : undefined,
            )
            const missed = new Set(failed)
            if (run.current !== token) return
            setTrades((current) =>
              current.map((trade) => {
                const key = solana ? trade.maker : trade.maker.toLowerCase()
                const match = found.get(key)
                return match && !trade.fundedByAddress
                  ? { ...trade, fundedBy: match.label, fundedByAddress: match.address }
                  : trade
              }),
            )
            for (const maker of batch) {
              if (missed.has(maker)) retry.push(maker)
              else done += 1
            }
          } catch {
            retry.push(...batch)
          }
          if (run.current === token) setFunding({ done, total })
        }
      }
      await Promise.all(Array.from({ length: FUNDER_PARALLEL }, worker))
      pending = retry
    }
    if (run.current === token) setFunding(null)
  }

  async function lookUpHolders(chainId: string, view: PoolView, loaded: Trade[], token: number) {
    const chain = getChain(chainId)
    if (!chain || loaded.length === 0) return
    setHoldersBusy(true)
    try {
      const { counts, truncated } = await resolveHolderCounts(chain, view, loaded)
      if (run.current !== token) return
      setTrades((current) =>
        current.map((trade) => {
          const holders = counts.get(trade.id)
          return holders === undefined || trade.holders !== null ? trade : { ...trade, holders }
        }),
      )
      if (truncated) {
        setWarning((current) =>
          current?.includes("holder")
            ? current
            : [current, "Holder history was truncated for this token; some older rows may show blanks."]
                .filter(Boolean)
                .join(" "),
        )
      }
    } catch {
      // Keep swaps usable even if holder reconstruction fails.
    } finally {
      if (run.current === token) setHoldersBusy(false)
    }
  }

  async function load(target = url) {
    const trimmed = target.trim()
    run.current += 1
    const token = run.current
    setPhase("loading")
    setError(null)
    setWarning(null)
    setCapped(false)
    setPool(null)
    setTrades([])
    setFacts(EMPTY_FACTS)
    setFunder("")
    setSelected(new Set())
    selectionAnchor.current = null
    setIncome(null)
    setFunding(null)
    setHoldersBusy(false)
    setStartAt(null)
    setEndAt(null)
    setPeriod(null)
    setPeriodError(null)
    setFromNo("")
    setToNo("")
    setNoError(null)
    setPage(0)
    setTableView("transactions")
    setProgress("Reading transactions from the chain…")

    try {
      let cursor: string | null = null
      const loaded: Trade[] = []
      const seen = new Set<string>()
      let chainId = ""
      let poolView: PoolView | null = null
      do {
        let body: SwapsResponse | null = null
        let failure = "Could not load swaps."
        for (let attempt = 0; attempt < PAGE_ATTEMPTS && !body; attempt += 1) {
          if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt))
          try {
            body = await getSwapPage(trimmed, cursor)
            if (run.current !== token) return
          } catch (requestError) {
            if (run.current !== token) return
            failure = requestError instanceof Error ? requestError.message : failure
            if (requestError instanceof AppError && requestError.status < 500) break
          }
        }
        if (!body) throw new Error(failure)
        chainId = body.pool.chainId
        poolView = body.pool
        setPool(body.pool)
        if (body.warning) setWarning(body.warning)
        for (const trade of body.trades) {
          if (seen.has(trade.id)) continue
          seen.add(trade.id)
          loaded.push(trade)
        }
        setTrades([...loaded])
        setProgress(
          body.nextCursor
            ? `Loaded ${loaded.length.toLocaleString("en-US")} transactions. Still reading the chain…`
            : `Loaded ${loaded.length.toLocaleString("en-US")} transactions.`,
        )
        cursor = body.nextCursor
        if (cursor && loaded.length >= MAX_TRADES) {
          setCapped(true)
          cursor = null
        }
      } while (cursor)
      setPhase("done")
      if (poolView) {
        void lookUpWalletFacts(chainId, poolView, loaded, token)
        void lookUpHolders(chainId, poolView, loaded, token)
      }
      void lookUpFunders(
        chainId,
        loaded.map((trade) => trade.maker),
        token,
        loaded,
      )
    } catch (loadError) {
      if (run.current !== token) return
      setPhase("error")
      setError(loadError instanceof Error ? loadError.message : "Could not load swaps.")
    }
  }

  const zone = resolveZone(zoneChoice)
  const zoneName = zoneAbbreviation(zone)
  const hasPool = pool !== null
  const zones = useMemo(() => (hasPool ? zoneOptions() : []), [hasPool])

  function changeZone(choice: string) {
    setZoneChoice(choice)
    try {
      window.localStorage.setItem(ZONE_KEY, choice)
    } catch {
      return
    }
  }

  const trades = useMemo(
    () => annotateTrades(rawTrades, pool?.address ?? "", facts),
    [rawTrades, pool?.address, facts],
  )
  const makerSummaries = useMemo(() => summarizeMakers(trades), [trades])
  const quotePrice = useMemo(() => latestQuotePrice(trades), [trades])

  const tapeBounds = useMemo(() => {
    if (trades.length === 0) return null
    let oldest = trades[0]
    let newest = trades[0]
    for (const trade of trades) {
      if (
        trade.blockNumber < oldest.blockNumber ||
        (trade.blockNumber === oldest.blockNumber && trade.logIndex < oldest.logIndex)
      ) {
        oldest = trade
      }
      if (
        trade.blockNumber > newest.blockNumber ||
        (trade.blockNumber === newest.blockNumber && trade.logIndex > newest.logIndex)
      ) {
        newest = trade
      }
    }
    const start = isoToParts(oldest.timestamp, zone)
    const end = isoToParts(newest.timestamp, zone)
    if (!start || !end) return null
    return {
      start,
      end,
      yearMin: Math.min(start.year, end.year),
      yearMax: Math.max(start.year, end.year),
    }
  }, [trades, zone])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = trades.filter((trade) => {
      if (filter !== "ALL" && trade.type !== filter) return false
      if (funder === "__none__" && trade.fundedByAddress) return false
      if (funder && funder !== "__none__" && trade.fundedByAddress !== funder) return false
      if (period) {
        const time = Date.parse(trade.timestamp)
        if (!Number.isFinite(time) || time < period.startMs || time > period.endMs) return false
      }
      if (!needle) return true
      return (
        trade.maker.includes(needle) ||
        trade.txHash.includes(needle) ||
        (trade.fundedBy ?? "").toLowerCase().includes(needle) ||
        (trade.fundedByAddress ?? "").includes(needle)
      )
    })
    const direction = sortDesc ? -1 : 1
    return [...rows].sort((a, b) => {
      if (sortKey === "selected") {
        const diff = Number(selected.has(a.id)) - Number(selected.has(b.id))
        return diff * direction || compareTrades(b, a, "timestamp")
      }
      if (sortKey === "others") {
        return (tagWeight(a) - tagWeight(b)) * direction || compareTrades(b, a, "timestamp")
      }
      if (sortKey === "makerTxCount") {
        const diff = a.makerTxCount - b.makerTxCount
        return diff * direction || a.maker.localeCompare(b.maker) || compareTrades(b, a, "timestamp")
      }
      const missingA = isMissing(a, sortKey)
      const missingB = isMissing(b, sortKey)
      if (missingA !== missingB) return missingA ? 1 : -1
      return compareTrades(a, b, sortKey) * direction
    })
  }, [trades, filter, funder, query, sortKey, sortDesc, selected, period])

  /** Minute tape ignores type filter so Buy/Sell columns both stay meaningful. */
  const minuteSource = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return trades.filter((trade) => {
      if (funder === "__none__" && trade.fundedByAddress) return false
      if (funder && funder !== "__none__" && trade.fundedByAddress !== funder) return false
      if (period) {
        const time = Date.parse(trade.timestamp)
        if (!Number.isFinite(time) || time < period.startMs || time > period.endMs) return false
      }
      if (!needle) return true
      return (
        trade.maker.includes(needle) ||
        trade.txHash.includes(needle) ||
        (trade.fundedBy ?? "").toLowerCase().includes(needle) ||
        (trade.fundedByAddress ?? "").includes(needle)
      )
    })
  }, [trades, funder, query, period])

  const minuteRows = useMemo(() => buildMinuteTape(minuteSource, zone), [minuteSource, zone])

  const listLength = tableView === "minutes" ? minuteRows.length : filtered.length
  const pageCount = Math.max(1, Math.ceil(listLength / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [filtered, currentPage, pageSize],
  )
  const minutePageRows = useMemo(
    () => minuteRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [minuteRows, currentPage, pageSize],
  )
  const firstShown = listLength === 0 ? 0 : currentPage * pageSize + 1
  const lastShown = Math.min(listLength, (currentPage + 1) * pageSize)

  const funders = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>()
    for (const trade of trades) {
      const key = trade.fundedByAddress || "__none__"
      const current = counts.get(key) ?? { label: trade.fundedBy || "Unknown", count: 0 }
      current.count += 1
      counts.set(key, current)
    }
    return [...counts.entries()].sort((left, right) => right[1].count - left[1].count || left[1].label.localeCompare(right[1].label))
  }, [trades])

  const stats = useMemo(() => summarize(trades), [trades])

  const allVisibleSelected = pageRows.length > 0 && pageRows.every((trade) => selected.has(trade.id))
  const someVisibleSelected = pageRows.some((trade) => selected.has(trade.id))
  const allMatchingSelected = filtered.length > 0 && filtered.every((trade) => selected.has(trade.id))

  function changeSelection(update: (draft: Set<string>) => void) {
    setSelected((current) => {
      const next = new Set(current)
      update(next)
      return next
    })
    setIncome(null)
  }

  function toggleTrade(id: string) {
    changeSelection((draft) => {
      if (!draft.delete(id)) draft.add(id)
    })
  }

  /** Normal click toggles one row. Shift+click selects every row between the anchor and this one (current table order). */
  function selectTrade(trade: Trade, shiftKey: boolean) {
    const index = filtered.findIndex((row) => row.id === trade.id)
    if (index < 0) return
    if (shiftKey && selectionAnchor.current !== null) {
      const from = Math.min(selectionAnchor.current, index)
      const to = Math.max(selectionAnchor.current, index)
      changeSelection((draft) => {
        for (let i = from; i <= to; i += 1) draft.add(filtered[i].id)
      })
      return
    }
    toggleTrade(trade.id)
    selectionAnchor.current = index
  }

  function toggleVisible() {
    changeSelection((draft) => {
      for (const trade of pageRows) {
        if (allVisibleSelected) draft.delete(trade.id)
        else draft.add(trade.id)
      }
    })
    selectionAnchor.current = pageRows.length > 0 ? filtered.findIndex((row) => row.id === pageRows[0].id) : null
  }

  function selectAllMatching() {
    changeSelection((draft) => {
      for (const trade of filtered) draft.add(trade.id)
    })
    selectionAnchor.current = filtered.length > 0 ? 0 : null
  }

  function selectByTxNo() {
    const from = Number.parseInt(fromNo.trim(), 10)
    const to = Number.parseInt(toNo.trim(), 10)
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < 1) {
      setNoError("Enter valid From No and To No (oldest = 1).")
      return
    }
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)
    const matches = trades.filter((trade) => trade.txNo >= lo && trade.txNo <= hi)
    if (matches.length === 0) {
      setNoError(`No transactions with No ${lo.toLocaleString("en-US")}–${hi.toLocaleString("en-US")}.`)
      return
    }
    changeSelection((draft) => {
      for (const trade of matches) draft.add(trade.id)
    })
    setNoError(null)
    const first = filtered.findIndex((row) => row.id === matches[0].id)
    selectionAnchor.current = first >= 0 ? first : null
  }

  function calculateIncome() {
    const chosen = trades.filter((trade) => selected.has(trade.id))
    if (chosen.length === 0) return
    const buys = chosen.filter((trade) => trade.type === "BUY")
    const sells = chosen.filter((trade) => trade.type === "SELL")
    const bought = sumDecimals(buys.map((trade) => trade.quoteAmount))
    const sold = sumDecimals(sells.map((trade) => trade.quoteAmount))
    const swaps = [...buys, ...sells]
    const usdValues = swaps.flatMap((trade) => (trade.totalUsd ? [trade.totalUsd] : []))
    setIncome({
      count: chosen.length,
      buys: buys.length,
      sells: sells.length,
      liquidity: chosen.length - swaps.length,
      total: sumDecimals(swaps.map((trade) => trade.quoteAmount)),
      bought,
      sold,
      net: sumDecimals([sold, `-${bought}`]),
      usd: usdValues.length > 0 ? sumDecimals(usdValues) : null,
    })
  }

  function extractPeriod() {
    if (!startAt || !endAt) {
      setPeriodError("Pick a start time and an end time.")
      return
    }
    let startParts = startAt
    let endParts = endAt
    let startMs = zonedPartsToUtc(startParts, zone).getTime()
    let endMs = zonedPartsEndMs(endParts, zone)
    if (endMs < startMs) {
      startParts = endAt
      endParts = startAt
      setStartAt(startParts)
      setEndAt(endParts)
      startMs = zonedPartsToUtc(startParts, zone).getTime()
      endMs = zonedPartsEndMs(endParts, zone)
    }
    setPeriodError(null)
    setPeriod({ startMs, endMs })
    selectionAnchor.current = null
    setPage(0)
  }

  function clearPeriod() {
    setPeriod(null)
    setPeriodError(null)
    selectionAnchor.current = null
    setPage(0)
  }

  function toggleSort(key: SortKey) {
    setPage(0)
    selectionAnchor.current = null
    if (sortKey === key) {
      setSortDesc((value) => !value)
      return
    }
    setSortKey(key)
    setSortDesc(key !== "maker" && key !== "type" && key !== "fundedBy" && key !== "txNo")
  }

  function download() {
    if (!pool || filtered.length === 0) return
    const csv = tradesToCsv(pool, filtered, zone)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = csvFilename(pool)
    link.click()
    URL.revokeObjectURL(link.href)
  }

  async function copyAddress() {
    if (!pool) return
    await navigator.clipboard.writeText(pool.address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10 2xl:px-12">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_0_6px_oklch(0.82_0.12_190/0.12)]">
            <LedgerMark />
          </span>
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">On-chain tape</p>
            <h1 className="font-heading text-3xl font-semibold tracking-tight">Pair Sheet</h1>
          </div>
        </div>
        <p className="max-w-3xl text-base text-muted-foreground sm:text-lg">
          Paste a DEXTools pair link. Pair Sheet reads every buy, sell, liquidity add and remove from the pool contract, shows the pool size and the funding wallet behind each transaction, and exports the full history as CSV.
        </p>
      </header>

      <form
        className="rounded-2xl bg-card p-3 ring-1 ring-foreground/10 sm:p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void load()
        }}
      >
        <label htmlFor="pair-url" className="mb-2 block text-sm font-medium">
          DEXTools pair URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="pair-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.dextools.io/app/ether/pair-explorer/0x…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-11 flex-1 font-mono text-sm"
            aria-invalid={phase === "error"}
          />
          <Button type="submit" size="lg" className="h-11 px-4" disabled={phase === "loading" || url.trim() === ""}>
            {phase === "loading" ? <Loader2 className="animate-spin" /> : null}
            {phase === "loading" ? "Reading chain" : "Load swaps"}
          </Button>
        </div>
      </form>

      {phase === "loading" ? (
        <p className="text-sm text-muted-foreground" role="status">
          {progress}
        </p>
      ) : holdersBusy ? (
        <p className="text-sm text-muted-foreground" role="status">
          Counting exact base-token holders at each transaction…
        </p>
      ) : funding ? (
        <p className="text-sm text-muted-foreground" role="status">
          Finding who funded each wallet: {funding.done.toLocaleString("en-US")} of {funding.total.toLocaleString("en-US")}
        </p>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {pool ? (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">
                  {pool.baseSymbol} / {pool.quoteSymbol}
                </h2>
                <Badge>{pool.chainName}</Badge>
                <Badge variant="outline">{pool.dex}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <button type="button" className="font-mono text-foreground hover:text-primary" onClick={() => void copyAddress()}>
                  {copied ? "Copied" : pool.address}
                </button>
                <a className="inline-flex items-center gap-1 hover:text-foreground" href={pool.dextoolsUrl} target="_blank" rel="noreferrer">
                  DEXTools <ExternalLink className="size-3.5" />
                </a>
                <a
                  className="inline-flex items-center gap-1 hover:text-foreground"
                  href={`${pool.explorerAddress}/${pool.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Explorer <ExternalLink className="size-3.5" />
                </a>
              </div>
            </div>
            <Button type="button" size="lg" className="h-11" onClick={download} disabled={filtered.length === 0 || funding !== null}>
              <Download />
              Download CSV
              {filtered.length > 0 ? ` · ${filtered.length.toLocaleString("en-US")}` : ""}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Transactions" value={stats.count.toLocaleString("en-US")} />
            <Stat label="Buys" value={stats.buys.toLocaleString("en-US")} tone="buy" />
            <Stat label="Sells" value={stats.sells.toLocaleString("en-US")} tone="sell" />
            <Stat label="Add / Remove" value={`${stats.adds.toLocaleString("en-US")} / ${stats.removes.toLocaleString("en-US")}`} />
            <Stat label="Quote volume" value={stats.volume} />
          </div>

          {warning ? <p className="text-sm text-muted-foreground">{warning}</p> : null}
          {capped ? (
            <p className="text-sm text-muted-foreground">
              Stopped at {MAX_TRADES.toLocaleString("en-US")} transactions. This pool has more history than one export pulls.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  ["transactions", "Transactions"],
                  ["minutes", "Per minute"],
                ] as const
              ).map(([view, label]) => (
                <button
                  key={view}
                  type="button"
                  aria-pressed={tableView === view}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${tableView === view ? "bg-background text-foreground" : "text-muted-foreground"}`}
                  onClick={() => {
                    setTableView(view)
                    setPage(0)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {tableView === "transactions" ? (
            <div className="flex gap-1 rounded-lg bg-muted p-1">
              {(Object.keys(FILTER_LABELS) as SideFilter[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={filter === side}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === side ? "bg-background text-foreground" : "text-muted-foreground"}`}
                  onClick={() => {
                    setFilter(side)
                    selectionAnchor.current = null
                    setPage(0)
                  }}
                >
                  {FILTER_LABELS[side]}
                </button>
              ))}
            </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Buy/sell counts each minute from launch ({zoneName}). Average speed is 60s ÷ count.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Time zone
              <select
                aria-label="Time zone"
                value={zoneChoice}
                onChange={(event) => changeZone(event.target.value)}
                className="h-9 max-w-64 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
              >
                <option value={AUTO_ZONE}>Local ({detectZone().replace(/_/g, " ")})</option>
                {zones.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {tableView === "transactions" ? (
              <>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Funded by
                  <select
                    aria-label="Filter by funded by"
                    value={funder}
                    onChange={(event) => {
                      setFunder(event.target.value)
                      selectionAnchor.current = null
                      setPage(0)
                    }}
                    className="h-9 max-w-56 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">All</option>
                    {funders.map(([address, info]) => (
                      <option key={address} value={address}>
                        {info.label} ({info.count})
                      </option>
                    ))}
                  </select>
                </label>
                <Input
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    selectionAnchor.current = null
                    setPage(0)
                  }}
                  placeholder="Filter by maker, funder, or tx"
                  className="h-9 sm:max-w-xs"
                  spellCheck={false}
                />
              </>
            ) : null}
          </div>

          {tableView === "transactions" ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="lg" className="h-10" onClick={calculateIncome} disabled={selected.size === 0}>
                <Calculator />
                Calculate Income
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {selected.size === 0
                  ? "Tick rows, Shift+click a range, or select by No — then calculate."
                  : `${selected.size.toLocaleString("en-US")} transaction${selected.size === 1 ? "" : "s"} selected`}
              </p>
              {filtered.length > pageRows.length && !allMatchingSelected ? (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-sm text-foreground hover:bg-accent"
                  onClick={selectAllMatching}
                >
                  Select all {filtered.length.toLocaleString("en-US")} matching
                </button>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/50 px-2.5 py-1.5 ring-1 ring-foreground/10">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  From No
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="From transaction number"
                    value={fromNo}
                    onChange={(event) => {
                      setFromNo(event.target.value.replace(/[^\d]/g, ""))
                      setNoError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") selectByTxNo()
                    }}
                    placeholder="1"
                    className="h-8 w-16 rounded-lg border border-input bg-background px-2 font-mono text-sm text-foreground"
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  To No
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="To transaction number"
                    value={toNo}
                    onChange={(event) => {
                      setToNo(event.target.value.replace(/[^\d]/g, ""))
                      setNoError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") selectByTxNo()
                    }}
                    placeholder="50"
                    className="h-8 w-16 rounded-lg border border-input bg-background px-2 font-mono text-sm text-foreground"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={selectByTxNo}
                  disabled={!fromNo || !toNo || trades.length === 0}
                >
                  Select
                </Button>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <DateTimeField
                  label="Start time"
                  value={startAt}
                  onChange={setStartAt}
                  fallback={tapeBounds?.start ?? null}
                  yearMin={tapeBounds?.yearMin}
                  yearMax={tapeBounds?.yearMax}
                />
                <DateTimeField
                  label="End time"
                  value={endAt}
                  onChange={setEndAt}
                  fallback={tapeBounds?.end ?? null}
                  yearMin={tapeBounds?.yearMin}
                  yearMax={tapeBounds?.yearMax}
                />
                <Button
                  type="button"
                  size="lg"
                  className="h-10"
                  onClick={extractPeriod}
                  disabled={!startAt || !endAt}
                >
                  <CalendarRange />
                  Extract
                </Button>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-foreground hover:bg-accent"
                    onClick={() => {
                      changeSelection((draft) => draft.clear())
                      selectionAnchor.current = null
                    }}
                  >
                    <X className="size-3.5" />
                    Clear selection
                  </button>
                ) : null}
              </div>
            </div>
            {noError ? (
              <p className="text-sm text-destructive" role="alert">
                {noError}
              </p>
            ) : null}
            {periodError ? (
              <p className="text-sm text-destructive" role="alert">
                {periodError}
              </p>
            ) : null}
            {period ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>
                  Showing {filtered.length.toLocaleString("en-US")} transaction{filtered.length === 1 ? "" : "s"} from{" "}
                  <span className="font-mono text-foreground">{formatParts(dateToParts(new Date(period.startMs), zone))}</span>
                  {" – "}
                  <span className="font-mono text-foreground">{formatParts(dateToParts(new Date(period.endMs), zone))}</span>
                  {" "}({zoneName})
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-foreground hover:bg-accent"
                  onClick={clearPeriod}
                >
                  <X className="size-3.5" />
                  Clear period
                </button>
              </div>
            ) : null}
          </div>
          ) : null}

          {tableView === "transactions" && income ? (
            <div className="rounded-2xl bg-card p-4 ring-1 ring-primary/40" role="region" aria-label="Income result">
              <p className="text-xs tracking-wide text-muted-foreground uppercase">
                Sum of {pool.quoteSymbol} in {income.count.toLocaleString("en-US")} selected transaction{income.count === 1 ? "" : "s"}
              </p>
              <p className="mt-1 font-mono text-3xl font-semibold text-primary" title={`${income.total} ${pool.quoteSymbol}`} data-testid="income-total">
                {formatIncome(income.total)} {pool.quoteSymbol}
              </p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Bought ({income.buys.toLocaleString("en-US")} {income.buys === 1 ? "buy" : "buys"})</dt>
                  <dd className="font-mono text-emerald-400">
                    {formatIncome(income.bought)} {pool.quoteSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Sold ({income.sells.toLocaleString("en-US")} {income.sells === 1 ? "sell" : "sells"})</dt>
                  <dd className="font-mono text-rose-400">
                    {formatIncome(income.sold)} {pool.quoteSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Net (sold minus bought)</dt>
                  <dd className="font-mono">
                    {formatIncome(income.net)} {pool.quoteSymbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">USD at trade time</dt>
                  <dd className="font-mono">{income.usd ? formatUsd(income.usd) : "—"}</dd>
                </div>
              </dl>
              {income.liquidity > 0 ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {income.liquidity.toLocaleString("en-US")} selected add/remove row{income.liquidity === 1 ? " is" : "s are"} not counted, only buys and sells.
                </p>
              ) : null}
            </div>
          ) : null}

          {tableView === "minutes" ? (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <caption className="sr-only">
                  Per-minute buy and sell counts for {pool.baseSymbol} / {pool.quoteSymbol}
                </caption>
                <thead className="bg-muted/70 text-left text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium text-right">No</th>
                    <th className="px-3 py-2 font-medium">Start Time ({zoneName})</th>
                    <th className="px-3 py-2 font-medium">End Time ({zoneName})</th>
                    <th className="px-3 py-2 font-medium text-right">Buy Count</th>
                    <th className="px-3 py-2 font-medium text-right">Sell Count</th>
                    <th className="px-3 py-2 font-medium text-right">Average Buy Speed</th>
                    <th className="px-3 py-2 font-medium text-right">Average Sell Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {minutePageRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-16 text-center text-muted-foreground">
                        No minutes to show yet.
                      </td>
                    </tr>
                  ) : (
                    minutePageRows.map((row) => (
                      <tr key={row.startMs} className="border-t border-border/80 hover:bg-muted/40">
                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                          {row.no.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatMinuteLabel(row.start)}</td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatMinuteLabel(row.end)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-emerald-400">
                          {row.buyCount.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-rose-400">
                          {row.sellCount.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatSpeed(row.avgBuySpeedSec)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{formatSpeed(row.avgSellSpeedSec)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1620px] border-collapse text-sm">
                <caption className="sr-only">
                  Swaps for {pool.baseSymbol} / {pool.quoteSymbol}
                </caption>
                <thead className="bg-muted/70 text-left text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2" aria-sort={sortKey === "selected" ? (sortDesc ? "descending" : "ascending") : "none"}>
                      <input
                        type="checkbox"
                        aria-label="Select all transactions on this page"
                        className="size-4 cursor-pointer accent-[var(--primary)]"
                        checked={allVisibleSelected}
                        ref={(node) => {
                          if (node) node.indeterminate = someVisibleSelected && !allVisibleSelected
                        }}
                        onChange={toggleVisible}
                        disabled={pageRows.length === 0}
                      />
                      <button
                        type="button"
                        className="mt-1 inline-flex items-center text-muted-foreground hover:text-foreground"
                        aria-label="Sort by selected"
                        onClick={() => toggleSort("selected")}
                      >
                        {sortKey === "selected" ? sortDesc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" />}
                      </button>
                    </th>
                    <SortHeader label="No" column="txNo" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={`Date (${zoneName})`} column="timestamp" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} />
                    <SortHeader label="Type" column="type" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} />
                    <SortHeader label="Price (USD)" column="priceUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label="Total" column="totalUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={`Price (${pool.quoteSymbol})`} column="priceQuote" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={pool.baseSymbol} column="baseAmount" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={pool.quoteSymbol} column="quoteAmount" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={`Pool ${pool.baseSymbol}`} column="baseReserve" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label={`Pool ${pool.quoteSymbol}`} column="quoteReserve" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <SortHeader label="Holders" column="holders" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" />
                    <th
                      className="px-3 py-2 font-medium text-left"
                      aria-sort={
                        sortKey === "maker" || sortKey === "makerTxCount" ? (sortDesc ? "descending" : "ascending") : "none"
                      }
                    >
                      <span className="inline-flex items-center gap-3">
                        <SortButton label="Maker" column="maker" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} />
                        <SortButton
                          label="Txns"
                          column="makerTxCount"
                          sortKey={sortKey}
                          desc={sortDesc}
                          onSort={toggleSort}
                        />
                      </span>
                    </th>
                    <SortHeader label="Funded by" column="fundedBy" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} />
                    <SortHeader label="Others" column="others" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-4 py-16 text-center text-muted-foreground">
                        {phase === "loading"
                          ? "Reading pool logs…"
                          : trades.length === 0
                            ? "No Uniswap-style transactions were found on this pool."
                            : "Nothing matches this filter."}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((trade) => (
                      <tr
                        key={trade.id}
                        className={`border-t border-border/80 hover:bg-muted/40 ${selected.has(trade.id) ? "bg-primary/10" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select ${trade.type} ${trade.txHash}`}
                            title="Click to toggle. Shift+click to select a range."
                            className="size-4 cursor-pointer accent-[var(--primary)]"
                            checked={selected.has(trade.id)}
                            onClick={(event) => {
                              event.preventDefault()
                              selectTrade(trade, event.shiftKey)
                            }}
                            onChange={() => {}}
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums" title="Transaction number (oldest = 1)">
                          {trade.txNo.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatTradeDate(trade.timestamp, zone)}</td>
                        <td className="px-3 py-2">
                          <span className={`font-semibold ${TYPE_TONE[trade.type]}`}>
                            {trade.type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{trade.priceUsd ? `$${formatTiny(Number(trade.priceUsd))}` : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatUsd(trade.totalUsd)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{trade.priceQuote ? formatTiny(Number(trade.priceQuote)) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs" title={formatGroupedAmount(trade.baseAmount)}>
                          {formatIntegerAmount(trade.baseAmount)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{formatGroupedAmount(trade.quoteAmount)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs" title={trade.baseReserve ?? "Pool size unavailable"}>
                          {trade.baseReserve ? formatPoolSize(trade.baseReserve) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs" title={trade.quoteReserve ?? "Pool size unavailable"}>
                          {trade.quoteReserve ? formatPoolSize(trade.quoteReserve) : "—"}
                        </td>
                        <td
                          className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                          title={trade.holders !== null ? `${trade.holders.toLocaleString("en-US")} holders after this trade` : "Holder count unavailable"}
                        >
                          {trade.holders !== null ? trade.holders.toLocaleString("en-US") : holdersBusy ? "…" : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {trade.maker ? (
                            <>
                              <a
                                className="font-mono text-xs hover:text-primary"
                                href={`${pool.explorerAddress}/${trade.maker}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {shortAddress(trade.maker)}
                              </a>
                              <MakerCountButton
                                maker={trade.maker}
                                count={trade.makerTxCount}
                                summary={makerSummaries.get(normalizeAddress(trade.maker)) ?? null}
                                baseSymbol={pool.baseSymbol}
                                quoteSymbol={pool.quoteSymbol}
                                priceUsd={pool.priceUsd}
                                priceQuote={quotePrice}
                                partial={capped}
                                onFilter={() => {
                                  setQuery(trade.maker)
                                  setPage(0)
                                }}
                              />
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {trade.fundedBy && trade.fundedByAddress ? (
                            <a
                              className="text-xs font-medium text-rose-300 hover:text-rose-200"
                              href={`${pool.explorerAddress}/${trade.fundedByAddress}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {trade.fundedBy}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            {trade.makerTags.includes("bot") ? (
                              <span
                                className="text-amber-400"
                                title="Bot / Smart contract: this transaction went straight to the pool or through a contract with unpublished source code."
                              >
                                <Bot className="size-4" aria-label="Bot or smart contract" />
                              </span>
                            ) : null}
                            {trade.makerTags.includes("team") ? (
                              <span
                                className="text-amber-400"
                                title="Team wallet: deployed this token or added the pool’s first liquidity."
                              >
                                <Users className="size-4" aria-label="Team wallet" />
                              </span>
                            ) : null}
                            <a
                              className="text-muted-foreground hover:text-foreground"
                              href={`${pool.explorerTx}/${trade.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Open this transaction on the explorer"
                              aria-label={`Open transaction ${trade.txHash} on the explorer`}
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}
          <nav
            aria-label="Pagination"
            className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between"
          >
            <p className="text-muted-foreground" aria-live="polite">
              Showing {firstShown.toLocaleString("en-US")}–{lastShown.toLocaleString("en-US")} of{" "}
              {listLength.toLocaleString("en-US")}
              {tableView === "minutes" ? " minutes" : ""}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-muted-foreground">
                Rows per page
                <select
                  aria-label="Rows per page"
                  value={pageSize}
                  onChange={(event) => {
                    setPageSize(Number(event.target.value))
                    setPage(0)
                  }}
                  className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                >
                  {PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setPage(0)} disabled={currentPage === 0}>
                  First
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Previous page"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage === 0}
                >
                  <ChevronLeft />
                </Button>
                <span className="px-2 font-mono text-xs text-muted-foreground">
                  Page {(currentPage + 1).toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Next page"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                >
                  <ChevronRight />
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setPage(pageCount - 1)} disabled={currentPage >= pageCount - 1}>
                  Last
                </Button>
              </div>
            </div>
          </nav>
          <p className="text-xs leading-5 text-muted-foreground">
            Amounts come from the pool’s on-chain Swap, Mint (ADD) and Burn (REMOVE) events; for ADD and REMOVE the two amounts are the tokens deposited or withdrawn and Total is the quote-token side in USD. USD totals multiply the quote token by its historical price from DefiLlama. The {pool.baseSymbol} column is a whole number of tokens; hover a cell for the exact amount. The CSV keeps the full on-chain value.
            The CSV includes every row that matches the filters, not only the current page
            {filter !== "ALL" || funder || query.trim() ? " after filters" : ""}. Dates in the table use the time zone selected above; the file has both the UTC time and the time in that zone. Pool columns show how much of each token the pool held right after that swap (hover for the exact value); for Uniswap V3 style pools this is the balance at the end of the swap’s block. Holders is the exact number of wallets with a non-zero base-token balance right after that trade, rebuilt from on-chain transfers. The number next to a maker is how many transactions that wallet made in this pool. Hover it for that wallet’s buys, sells, realized PnL, and tokens still held, in USD, the quote token, and the base token. Click it to show only that wallet. Maker sorts that column by address, and Txns sorts it by the number. The Bot icon marks transactions sent straight to the pool or through a contract with unpublished source; the Team icon marks the token deployer and the wallet that added the first liquidity. Funded by is the address that first sent native currency to the maker. Each maker and transaction links to the explorer. Supported chains: {CHAINS}.
          </p>
        </section>
      ) : phase === "idle" || phase === "error" ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Step n="1" title="Paste the pair" body="Use the pair-explorer URL from DEXTools, including the chain and pool address." />
          <Step n="2" title="Read the tape" body="Buys, sells, adds and removes are decoded from the pool’s logs, with the wallet that sent each transaction and the pool size after it." />
          <Step n="3" title="Save the CSV" body="Date, type, USD price, total, both token amounts, pool size, holders, maker, who funded that wallet, and transaction hash." />
        </section>
      ) : null}
    </div>
  )
}

const TYPE_TONE: Record<Trade["type"], string> = {
  BUY: "text-emerald-400",
  SELL: "text-rose-400",
  ADD: "text-sky-400",
  REMOVE: "text-amber-400",
  INIT: "text-foreground",
}

function summarize(trades: Trade[]) {
  let buys = 0
  let sells = 0
  let adds = 0
  let removes = 0
  let volume = 0
  for (const trade of trades) {
    if (trade.type === "ADD" || trade.type === "INIT") {
      adds += 1
      continue
    }
    if (trade.type === "REMOVE") {
      removes += 1
      continue
    }
    if (trade.type === "BUY") buys += 1
    else sells += 1
    const total = Number(trade.totalUsd)
    if (Number.isFinite(total)) volume += total
  }
  return {
    count: trades.length,
    buys,
    sells,
    adds,
    removes,
    volume: volume > 0 ? formatUsd(volume.toFixed(2)) : "—",
  }
}

function tagWeight(trade: Trade): number {
  return (trade.makerTags.includes("bot") ? 2 : 0) + (trade.makerTags.includes("team") ? 1 : 0)
}

function isMissing(trade: Trade, key: SortKey): boolean {
  if (key === "selected" || key === "others" || key === "makerTxCount" || key === "txNo") return false
  if (key === "fundedBy") return !trade.fundedBy
  if (key === "holders") return trade.holders === null
  if (key === "maker") return !trade.maker
  if (key === "timestamp" || key === "type") return false
  return trade[key] === null
}

function compareTrades(a: Trade, b: Trade, key: SortKey): number {
  if (key === "timestamp") return a.timestamp.localeCompare(b.timestamp) || a.logIndex - b.logIndex
  if (key === "type" || key === "maker") return a[key].localeCompare(b[key])
  if (key === "fundedBy") return (a.fundedBy || "").localeCompare(b.fundedBy || "")
  if (key === "selected" || key === "others") return 0
  if (key === "makerTxCount") return a.makerTxCount - b.makerTxCount
  if (key === "txNo") return a.txNo - b.txNo
  if (key === "holders") return (a.holders ?? -1) - (b.holders ?? -1)
  return compareDecimal(a[key] ?? "0", b[key] ?? "0")
}

function SortHeader({
  label,
  column,
  sortKey,
  desc,
  onSort,
  align = "left",
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  desc: boolean
  onSort: (column: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sortKey === column
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
    >
      <SortButton label={label} column={column} sortKey={sortKey} desc={desc} onSort={onSort} align={align} />
    </th>
  )
}

function SortButton({
  label,
  column,
  sortKey,
  desc,
  onSort,
  align = "left",
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  desc: boolean
  onSort: (column: SortKey) => void
  align?: "left" | "right"
}) {
  const active = sortKey === column
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
      aria-label={
        column === "makerTxCount"
          ? "Sort by maker transaction count"
          : column === "txNo"
            ? "Sort by transaction number"
            : undefined
      }
      onClick={() => onSort(column)}
    >
      {label}
      {active ? desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
    </button>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "buy" | "sell" }) {
  const color = tone === "buy" ? "text-emerald-400" : tone === "sell" ? "text-rose-400" : "text-foreground"
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 font-mono text-xl ${color}`}>{value}</p>
    </div>
  )
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <article className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="font-mono text-xs text-primary">0{n}</p>
      <h2 className="mt-2 font-medium">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
    </article>
  )
}

function LedgerMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <path
        d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.2a.8.8 0 0 1-1.2.7L14 18.2l-2.8 1.7a.8.8 0 0 1-.8 0L7.6 18.2 4.8 19.9A.8.8 0 0 1 3.6 19.2V7A2.5 2.5 0 0 1 6 4.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M7.5 9h6M7.5 12.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
