"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Calculator, CalendarRange, ChevronLeft, ChevronRight, Cloud, Download, ExternalLink, FileText, FolderOpen, Loader2, RefreshCw, Save, Star, Trash2, Upload, Users, X } from "lucide-react"
import { MevBotIcon } from "@/components/mev-bot-icon"
import { BehaviourReportDialog } from "@/components/behaviour-report-dialog"
import { ColumnsMenu } from "@/components/columns-menu"
import { HelpDialogButton } from "@/components/help-dialog"
import { TeamLabelsDialog } from "@/components/team-labels-dialog"
import { DateTimeField } from "@/components/datetime-field"
import { MakerCountButton } from "@/components/maker-summary"
import { TradeSizeIcon } from "@/components/trade-size-icon"
import { TinyAmount } from "@/components/tiny-amount"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getChain } from "@/lib/chains"
import { assignGasFeeTotals, countMissingGas, ethFromWei, formatGasUsd, repairTradeGas, rowGasUsd, totalGasSpend, tradesNeedGasRepair } from "@/lib/gas-fees"
import {
  DA_COLUMN_DEFS,
  TX_COLUMN_DEFS,
  countVisible,
  defaultDaVisibility,
  defaultTxVisibility,
  displayGwei,
  loadDaVisibility,
  loadTxVisibility,
  saveDaVisibility,
  saveTxVisibility,
  tableMinWidth,
  type DaColumnId,
  type TxColumnId,
} from "@/lib/table-columns"
import { FUNDER_REVISION, applyFunderResults, makerFunderKey, makersToRefresh, resolveFunders, type Funder } from "@/lib/funded"
import { resolveHolderCounts } from "@/lib/holders"
import { addBlacklistIds, blacklistPoolKey, readBlacklist, removeBlacklistIds, writeBlacklist } from "@/lib/blacklist"
import { getSwapPage, mergeNewTrades, newestTradeBlock } from "@/lib/history"
import { AppError } from "@/lib/http"
import { isPoolId, marketCapsDrift, repriceMarketCaps, resolveTokenTotalSupply, suppliesDiffer } from "@/lib/pool"
import { finalizeV4Tape } from "@/lib/v4-tape"
import { lookUpWallets } from "@/lib/wallets"
import { EMPTY_FACTS, annotateTrades, frontRunningById, makersToCheck, routersToCheck, type WalletFacts } from "@/lib/annotate"
import { csvFilename, tradesToCsv } from "@/lib/csv"
import {
  compareDecimal,
  formatGroupedAmount,
  formatIntegerAmount,
  changeTone,
  formatPoolSize,
  formatQuoteAmount,
  formatIncome,
  formatUsd,
  formatUsdInteger,
  normalizeAddress,
  shortAddress,
  sumDecimals,
} from "@/lib/format"
import { describeMcapMultiple, latestPoolMcapAnchor, marketCapAtPooledQuote, normalizePooledQuote, trimDecimal } from "@/lib/mcap-pool"
import { makerInLabel, netQuoteFlow, readTeamLabels, writeTeamLabels, type LabelMode, type TeamLabel } from "@/lib/team-labels"
import { latestQuotePrice, summarizeMakers } from "@/lib/maker"
import { summarizeTrades } from "@/lib/trade-stats"
import { latestQuoteUsdPrice, quoteAbsDelta, quoteAmountToUsd } from "@/lib/trade-size"
import { IntervalChartDialog } from "@/components/interval-chart"
import { LiveMarketWidgets } from "@/components/live-market"
import { fetchEthSnap } from "@/lib/live-market"
import {
  LAUNCH_PRESETS,
  describeLaunchWindow,
  hoursToMs,
  launchWindowMs,
  parseLaunchHours,
} from "@/lib/launch-window"
import {
  DEFAULT_INTERVAL_MS,
  INTERVAL_PRESETS,
  MAX_INTERVAL_BUCKETS,
  buildIntervalTape,
  estimateBucketCount,
  formatBucketLabel,
  formatIntervalMs,
  formatSpeed,
  formatSpeedTitle,
  intervalOriginMs,
  intervalToMs,
  type IntervalUnit,
  type MinuteRow,
} from "@/lib/minute-tape"
import {
  cacheBookmarkMetas,
  clearSync,
  dismissBookmark,
  fetchRemoteBookmarks,
  formatSyncAgo,
  getSyncStatus,
  getSyncToken,
  hasSyncToken,
  hydrateSyncStorage,
  isSyncSuccessful,
  publishBookmarks,
  readCachedBookmarkMetas,
  restoreBookmark,
  setSyncToken,
  syncTokenHelpUrl,
  validateSyncToken,
  withoutDismissed,
  type SyncStatus,
} from "@/lib/bookmarks-sync"
import {
  analysisId,
  compareSavedMeta,
  deleteSavedAnalysis,
  exportSavedVault,
  formatSavedAt,
  importSavedVault,
  listSavedAnalyses,
  loadSavedAnalysis,
  mergeSavedMeta,
  saveAnalysis,
  setAnalysisStarred,
  type SavedAnalysisMeta,
  type SavedVault,
} from "@/lib/saved-analyses"
import {
  AUTO_ZONE,
  DEFAULT_ZONE,
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

type TableView = "transactions" | "minutes" | "blacklist"

type PeriodFilter = { startMs: number; endMs: number }

/** Soft cap so a single browser session stays responsive; explorer windows can exceed 10k. */
const MAX_TRADES = 50000
const ZONE_KEY = "pairsheet.timezone"
const LOOKUP_FUNDERS_KEY = "pairsheet.lookupFunders"
const LOOKUP_GAS_KEY = "pairsheet.lookupGas"
const LOOKUP_HOLDERS_KEY = "pairsheet.lookupHolders"
const LIVE_ENABLED_KEY = "pairsheet.liveUpdates"
const PAGE_SIZES = [25, 50, 100, 250]
const WALLET_BATCH = 12
const WALLET_ROUTER_LIMIT = 120
const WALLET_MAKER_LIMIT = 80

type Phase = "idle" | "loading" | "done" | "error"
type ExtraLookup = "gas" | "holders" | "funders"
type SideFilter = "ALL" | "BUY" | "SELL" | "ADD" | "REMOVE" | "INIT"

const EXTRA_LOOKUP_COPY: Record<
  ExtraLookup,
  { title: string; body: string; confirm: string }
> = {
  gas: {
    title: "Load gas fees?",
    body: "Fetch transaction receipts to fill Gas Price and Gas Fee Total for every row. This can take a while on large tapes.",
    confirm: "Load gas fees",
  },
  holders: {
    title: "Load holders?",
    body: "Replay base-token transfers to count holders after each transaction. This can take a while on busy tokens.",
    confirm: "Load holders",
  },
  funders: {
    title: "Load Funded by?",
    body: "Look up which address first funded each maker wallet. This is often the slowest optional step.",
    confirm: "Load Funded by",
  },
}

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
  | "marketCapUsd"
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
  | "gasPriceGwei"
  | "gasUsd"
  | "gasFeeTotalEth"

type MinuteSortKey =
  | "no"
  | "startMs"
  | "endMs"
  | "buyCount"
  | "sellCount"
  | "avgBuySpeedSec"
  | "avgSellSpeedSec"
  | "startQuoteReserve"
  | "endQuoteReserve"
  | "startMarketCapUsd"
  | "endMarketCapUsd"
  | "startPriceUsd"
  | "endPriceUsd"
  | "startHolders"
  | "endHolders"
  | "endGasPriceGwei"
  | "endGasFeeTotalEth"

const PAGE_ATTEMPTS = 3
/** Both axes scroll inside the table card; header cells stay pinned. */
const TABLE_SCROLL = "max-h-[70vh] overflow-auto overscroll-contain"
const TABLE_HEAD =
  "sticky top-0 z-10 bg-muted text-left text-xs tracking-wide text-muted-foreground uppercase [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-muted [&_th]:border-b [&_th]:border-border/80"
/** How often an open tape checks the chain for swaps newer than the snapshot. */
const LIVE_POLL_MS = 12_000
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
  const [liveMode, setLiveMode] = useState<"off" | "updating" | "live">("off")
  const [liveEnabled, setLiveEnabled] = useState(true)
  const [manualUpdating, setManualUpdating] = useState(false)
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
  const [minuteSortKey, setMinuteSortKey] = useState<MinuteSortKey>("startMs")
  const [minuteSortDesc, setMinuteSortDesc] = useState(false)
  const [intervalMs, setIntervalMs] = useState(DEFAULT_INTERVAL_MS)
  const [intervalPreset, setIntervalPreset] = useState<string>("1m")
  const [customIntervalValue, setCustomIntervalValue] = useState("1")
  const [customIntervalUnit, setCustomIntervalUnit] = useState<IntervalUnit>("min")
  const [chartOpen, setChartOpen] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [tableView, setTableView] = useState<TableView>("transactions")
  const [txColumns, setTxColumns] = useState<Record<TxColumnId, boolean>>(() =>
    typeof window === "undefined" ? defaultTxVisibility() : loadTxVisibility(),
  )
  const [daColumns, setDaColumns] = useState<Record<DaColumnId, boolean>>(() =>
    typeof window === "undefined" ? defaultDaVisibility() : loadDaVisibility(),
  )
  const [zoneChoice, setZoneChoice] = useState<string>(() => {
    if (typeof window === "undefined") return DEFAULT_ZONE
    try {
      return window.localStorage.getItem(ZONE_KEY) || DEFAULT_ZONE
    } catch {
      return DEFAULT_ZONE
    }
  })
  const [lookupFunders, setLookupFunders] = useState(false)
  const [lookupGas, setLookupGas] = useState(false)
  const [lookupHolders, setLookupHolders] = useState(false)
  const [copied, setCopied] = useState(false)
  const [funding, setFunding] = useState<{ done: number; total: number } | null>(null)
  const [holdersBusy, setHoldersBusy] = useState(false)
  const [gasBusy, setGasBusy] = useState(false)
  const [confirmExtra, setConfirmExtra] = useState<ExtraLookup | null>(null)
  const [savedUpdateAsk, setSavedUpdateAsk] = useState<{
    pairLabel: string
    funderCount: number
    gasCount: number
  } | null>(null)
  const run = useRef(0)
  const tradesRef = useRef<Trade[]>([])
  const liveEnabledRef = useRef(true)
  const catchUpLock = useRef(false)
  const liveGeneration = useRef(0)
  const savedUpdateJob = useRef<{
    token: number
    url: string
    pool: PoolView
    facts: WalletFacts
    warning: string | null
    capped: boolean
    savedAt: string
    starred?: boolean
    funderTargets: string[]
    funderRevision: number | undefined
    funderChecked: string[] | undefined
    repairGas: boolean
  } | null>(null)
  const liveApi = useRef({
    url: "",
    pool: null as PoolView | null,
    lookupGas: false,
    lookupHolders: false,
    facts: EMPTY_FACTS,
    warning: null as string | null,
    capped: false,
    lookUpHolders: (_chainId: string, _view: PoolView, _loaded: Trade[], _token: number) =>
      Promise.resolve(),
  })
  const selectionAnchor = useRef<number | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [blacklistIds, setBlacklistIds] = useState<string[]>([])
  const [blacklistSelected, setBlacklistSelected] = useState<Set<string>>(new Set())
  const [blacklistKeyLoaded, setBlacklistKeyLoaded] = useState("")
  const [income, setIncome] = useState<Income | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [startAt, setStartAt] = useState<DateTimeParts | null>(null)
  const [endAt, setEndAt] = useState<DateTimeParts | null>(null)
  const [period, setPeriod] = useState<PeriodFilter | null>(null)
  const [periodError, setPeriodError] = useState<string | null>(null)
  const [launchFrom, setLaunchFrom] = useState("")
  const [launchTo, setLaunchTo] = useState("")
  const [pooledInput, setPooledInput] = useState("")
  const [pooledEdited, setPooledEdited] = useState(false)
  const [ethUsd, setEthUsd] = useState<number | null>(null)
  const [showTotalGas, setShowTotalGas] = useState(false)
  const [teamLabels, setTeamLabels] = useState<TeamLabel[]>([])
  const [teamLabelsOpen, setTeamLabelsOpen] = useState(false)
  const [labelId, setLabelId] = useState("")
  const [labelMode, setLabelMode] = useState<LabelMode>("only")
  const [fromNo, setFromNo] = useState("")
  const [toNo, setToNo] = useState("")
  const [noError, setNoError] = useState<string | null>(null)
  const [savedList, setSavedList] = useState<SavedAnalysisMeta[]>([])
  const [localSavedIds, setLocalSavedIds] = useState<Set<string>>(() => new Set())
  const [saveBusy, setSaveBusy] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [saveNoticeTone, setSaveNoticeTone] = useState<"ok" | "error" | "info">("info")
  const [gasSavePrompt, setGasSavePrompt] = useState(false)
  const [showSelectedOnly, setShowSelectedOnly] = useState(false)
  const [showMevOnly, setShowMevOnly] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SavedAnalysisMeta | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteResult, setDeleteResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncTokenDraft, setSyncTokenDraft] = useState("")
  const [syncEnabled, setSyncEnabled] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => getSyncStatus())
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [showSyncSetup, setShowSyncSetup] = useState(false)
  const importFileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    try {
      setLookupFunders(window.localStorage.getItem(LOOKUP_FUNDERS_KEY) === "1")
      setLookupGas(window.localStorage.getItem(LOOKUP_GAS_KEY) === "1")
      setLookupHolders(window.localStorage.getItem(LOOKUP_HOLDERS_KEY) === "1")
      if (window.localStorage.getItem(LIVE_ENABLED_KEY) === "0") setLiveEnabled(false)
      setTeamLabels(readTeamLabels())
    } catch {
      setLookupFunders(false)
      setLookupGas(false)
      setLookupHolders(false)
    }
  }, [])

  useEffect(() => {
    setPooledEdited(false)
    setPooledInput("")
    setShowTotalGas(false)
  }, [pool?.address])

  useEffect(() => {
    if (!pool || pool.chainId !== "ether") {
      setEthUsd(null)
      return
    }
    let stopped = false
    const load = () => {
      fetchEthSnap()
        .then((snap) => {
          if (!stopped) setEthUsd(snap.priceUsd)
        })
        .catch(() => undefined)
    }
    load()
    const timer = window.setInterval(load, 60_000)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [pool?.chainId])

  useEffect(() => {
    void (async () => {
      await hydrateSyncStorage()
      setSyncEnabled(hasSyncToken())
      setSyncTokenDraft(getSyncToken())
      setSyncStatus(getSyncStatus())
      await refreshSavedList()
    })()
  }, [])

  useEffect(() => {
    const picked = tableView === "blacklist" ? blacklistSelected : selected
    if (showSelectedOnly && picked.size === 0) setShowSelectedOnly(false)
  }, [showSelectedOnly, selected, blacklistSelected, tableView])

  const blacklistKey = pool ? blacklistPoolKey(pool.chainId, pool.address) : ""

  useEffect(() => {
    if (!blacklistKey) {
      setBlacklistIds([])
      setBlacklistSelected(new Set())
      setBlacklistKeyLoaded("")
      return
    }
    setBlacklistIds(readBlacklist(blacklistKey))
    setBlacklistSelected(new Set())
    setBlacklistKeyLoaded(blacklistKey)
  }, [blacklistKey])

  useEffect(() => {
    if (!blacklistKey || blacklistKeyLoaded !== blacklistKey) return
    writeBlacklist(blacklistKey, blacklistIds)
  }, [blacklistKey, blacklistKeyLoaded, blacklistIds])

  tradesRef.current = rawTrades
  liveEnabledRef.current = liveEnabled
  liveApi.current = {
    url,
    pool,
    lookupGas,
    lookupHolders,
    facts,
    warning,
    capped,
    lookUpHolders,
  }

  useEffect(() => {
    if (!liveEnabled || phase !== "done" || !pool || rawTrades.length === 0 || !url.trim()) {
      if (!catchUpLock.current) setLiveMode("off")
      return
    }
    const generation = liveGeneration.current + 1
    liveGeneration.current = generation
    let timer = 0
    const stopped = () => liveGeneration.current !== generation

    async function tick() {
      if (stopped()) return
      const ran = await catchUpLatest(false, stopped)
      if (stopped()) return
      timer = window.setTimeout(() => void tick(), ran ? LIVE_POLL_MS : 1_000)
    }

    void tick()
    return () => {
      liveGeneration.current += 1
      window.clearTimeout(timer)
    }
    // catchUpLatest reads the latest tape through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEnabled, phase, pool, url])

  function persistLookupFlag(key: string, next: boolean) {
    try {
      window.localStorage.setItem(key, next ? "1" : "0")
    } catch {
      return
    }
  }

  function changeLookupFunders(next: boolean) {
    setLookupFunders(next)
    persistLookupFlag(LOOKUP_FUNDERS_KEY, next)
  }

  function changeLookupGas(next: boolean) {
    setLookupGas(next)
    persistLookupFlag(LOOKUP_GAS_KEY, next)
  }

  function changeLookupHolders(next: boolean) {
    setLookupHolders(next)
    persistLookupFlag(LOOKUP_HOLDERS_KEY, next)
  }

  function changeLiveEnabled(next: boolean) {
    setLiveEnabled(next)
    liveEnabledRef.current = next
    persistLookupFlag(LIVE_ENABLED_KEY, next)
    if (!next && !catchUpLock.current) setLiveMode("off")
  }

  /**
   * Append swaps newer than the open tape. Live polling and the Update button
   * share this so a saved pair can catch up without a full Load swaps.
   */
  async function catchUpLatest(manual: boolean, isStopped: () => boolean = () => false): Promise<boolean> {
    if (catchUpLock.current) {
      if (manual) flashNotice("Already checking the chain for new swaps.", "info")
      return false
    }
    const api = liveApi.current
    const watchUrl = api.url.trim()
    if (!api.pool || !watchUrl || tradesRef.current.length === 0) {
      if (manual) flashNotice("Open a saved pair or load swaps before updating.", "info")
      return false
    }
    const since = newestTradeBlock(tradesRef.current)
    if (!since) {
      if (manual) flashNotice("This tape has no block to continue from. Use Load swaps.", "info")
      return false
    }
    catchUpLock.current = true
    if (manual) setManualUpdating(true)
    setLiveMode("updating")
    let cursor: string | null = null
    let added = 0
    const wantGas = api.lookupGas || tradesRef.current.some((trade) => trade.gasPriceGwei)
    try {
      do {
        if (isStopped()) return false
        const body = await getSwapPage(watchUrl, cursor, {
          includeGas: wantGas,
          sinceBlock: cursor ? null : since,
        })
        if (isStopped()) return false
        if (body.trades.length > 0 && api.pool) {
          const current = tradesRef.current
          if (current.length < MAX_TRADES) {
            const merged = mergeNewTrades(current, body.trades)
            if (merged !== current) {
              const room = merged.length > MAX_TRADES ? merged.slice(0, MAX_TRADES) : merged
              added += room.length - current.length
              const polished = polishTape(api.pool, room)
              tradesRef.current = polished
              setTrades(polished)
            }
          }
        }
        cursor = body.nextCursor
        if (tradesRef.current.length >= MAX_TRADES) {
          setCapped(true)
          cursor = null
        }
      } while (cursor)
      if (isStopped()) return false
      if (added > 0 && api.pool) {
        const snapshot = tradesRef.current
        const hadHolders = api.lookupHolders || snapshot.some((trade) => trade.holders != null)
        if (hadHolders) void api.lookUpHolders(api.pool.chainId, api.pool, snapshot, run.current)
        void persistCaughtUpTape(api.pool, snapshot, api).then(() => refreshSavedList().catch(() => undefined))
      }
      if (manual) {
        const pair = `${api.pool.baseSymbol} / ${api.pool.quoteSymbol}`
        flashNotice(
          added > 0
            ? `Updated ${pair} with ${added.toLocaleString("en-US")} new transaction${added === 1 ? "" : "s"}.`
            : `${pair} is already up to date.`,
          "ok",
        )
      }
    } catch (error) {
      if (manual && !isStopped()) {
        flashNotice(error instanceof Error ? error.message : "Could not update this pair.", "error")
      }
    } finally {
      catchUpLock.current = false
      if (manual) setManualUpdating(false)
      if (!isStopped() || !liveEnabledRef.current) setLiveMode(liveEnabledRef.current ? "live" : "off")
    }
    return !isStopped()
  }

  const tapeReady = phase === "done" && pool !== null && rawTrades.length > 0
  const extraBusy = gasBusy || holdersBusy || funding !== null

  async function runExtraLookup(kind: ExtraLookup) {
    if (!pool || rawTrades.length === 0 || phase !== "done") return
    run.current += 1
    const token = run.current
    const chainId = pool.chainId
    try {
      if (kind === "gas") {
        const chain = getChain(chainId)
        if (!chain || chain.id === "solana") {
          flashNotice("Gas columns are only available on EVM chains.", "info")
          return
        }
        setGasBusy(true)
        setProgress(
          `Filling gas fees for ${countMissingGas(rawTrades).toLocaleString("en-US") || rawTrades.length.toLocaleString("en-US")} transactions…`,
        )
        const result = await repairTradeGas(rawTrades, chain.rpcs, (progress) => {
          if (run.current !== token) return
          setProgress(
            `Filling gas fees… ${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} receipts (pass ${progress.round})`,
          )
        })
        if (run.current !== token) return
        setTrades(result.trades)
        setProgress("")
        flashNotice(
          result.missing > 0
            ? `Filled gas for ${result.fetched.toLocaleString("en-US")} txs; ${result.missing.toLocaleString("en-US")} still missing.`
            : `Gas Price and Gas Fee Total updated for ${pool.baseSymbol} / ${pool.quoteSymbol}.`,
          result.missing > 0 ? "info" : "ok",
        )
        return
      }
      if (kind === "holders") {
        await lookUpHolders(chainId, pool, rawTrades, token)
        if (run.current !== token) return
        flashNotice(`Holders updated for ${pool.baseSymbol} / ${pool.quoteSymbol}.`, "ok")
        return
      }
      await lookUpFunders(
        chainId,
        rawTrades.map((trade) => trade.maker),
        token,
        rawTrades,
      )
      if (run.current !== token) return
      flashNotice(`Funded by updated for ${pool.baseSymbol} / ${pool.quoteSymbol}.`, "ok")
    } catch (error) {
      if (run.current !== token) return
      flashNotice(error instanceof Error ? error.message : "Could not load that data.", "error")
    } finally {
      if (run.current === token) {
        setGasBusy(false)
        setProgress("")
      }
    }
  }

  useEffect(() => {
    if (!savedOpen) return
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSavedOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [savedOpen])

  async function refreshSavedList() {
    try {
      const local = await listSavedAnalyses().catch(() => [] as SavedAnalysisMeta[])
      setLocalSavedIds(new Set(local.map((item) => item.id)))
      const remote = await fetchRemoteBookmarks()
      const merged = withoutDismissed(mergeSavedMeta(local, remote.bookmarks))
      cacheBookmarkMetas(merged, { replace: true })
      setSavedList(merged)
      // Re-read status after pull — pull must not wipe a successful publish badge.
      setSyncStatus(getSyncStatus())
    } catch {
      // IndexedDB / network may be unavailable; keep the live load path working.
    }
  }

  async function localBookmarksForPublish(): Promise<SavedAnalysisMeta[]> {
    const fromDb = await listSavedAnalyses().catch(() => [] as SavedAnalysisMeta[])
    const fromUi = savedList.filter((item) => localSavedIds.has(item.id))
    const fromCache = readCachedBookmarkMetas()
    const merged = withoutDismissed(mergeSavedMeta(mergeSavedMeta(fromDb, fromUi), fromCache))
    if (merged.length > 0) cacheBookmarkMetas(merged, { replace: true })
    return merged
  }

  async function publishMergedBookmarks(nextLocal?: SavedAnalysisMeta[], tokenOverride?: string) {
    const token = (tokenOverride ?? getSyncToken()).trim()
    if (!token) throw new Error("Add a GitHub sync token first.")
    const local = withoutDismissed(nextLocal ?? (await localBookmarksForPublish()))
    cacheBookmarkMetas(local, { replace: true })
    const remote = await fetchRemoteBookmarks()
    const merged = withoutDismissed(mergeSavedMeta(local, remote.bookmarks))
    const removedShared = remote.bookmarks.some((item) => !merged.some((row) => row.id === item.id))
    if (merged.length === 0 && !removedShared) {
      throw new Error("No local saved pairs to publish. Save a pair on this browser first, then Publish now.")
    }
    const catalog = await publishBookmarks(merged, token, { allowEmpty: merged.length === 0 })
    setLocalSavedIds(new Set(local.map((item) => item.id)))
    setSavedList(withoutDismissed(mergeSavedMeta(local, catalog.bookmarks)))
    setSyncStatus(getSyncStatus())
    setSyncEnabled(true)
    return catalog
  }

  async function lookUpWalletFacts(chainId: string, view: PoolView, loaded: Trade[], token: number) {
    const chain = getChain(chainId)
    if (!chain || chain.id === "solana") return
    const routers = routersToCheck(loaded, view.address, WALLET_ROUTER_LIMIT)
    const makers = makersToCheck(loaded, WALLET_MAKER_LIMIT)
    const addresses = [...new Set([...routers, ...makers])]
    const batches = chunk(addresses, WALLET_BATCH)
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

  function detectMevBots() {
    if (rawTrades.length === 0 || phase === "loading") return
    setShowMevOnly(true)
    setPage(0)
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
                return match
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

  function resetViewState() {
    setError(null)
    setWarning(null)
    setCapped(false)
    setPool(null)
    setTrades([])
    setFacts(EMPTY_FACTS)
    setFunder("")
    setSelected(new Set())
    selectionAnchor.current = null
    setShowSelectedOnly(false)
    setShowMevOnly(false)
    setIncome(null)
    setFunding(null)
    setHoldersBusy(false)
    setGasBusy(false)
    setProgress("")
    setStartAt(null)
    setEndAt(null)
    setPeriod(null)
    setPeriodError(null)
    setLaunchFrom("")
    setLaunchTo("")
    setFromNo("")
    setToNo("")
    setNoError(null)
    setPage(0)
    setTableView("transactions")
    setSaveNotice(null)
    setSaveNoticeTone("info")
    setGasSavePrompt(false)
    setSavedUpdateAsk(null)
  }

  async function load(target = url) {
    const trimmed = target.trim()
    run.current += 1
    const token = run.current
    setPhase("loading")
    resetViewState()
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
            body = await getSwapPage(trimmed, cursor, { includeGas: lookupGas })
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

      let finalTrades = loaded
      if (lookupGas) {
        finalTrades = assignGasFeeTotals(loaded)
        const chain = getChain(chainId)
        if (chain && chain.id !== "solana" && countMissingGas(finalTrades) > 0) {
          setProgress(
            `Filling gas fees for ${countMissingGas(finalTrades).toLocaleString("en-US")} transactions…`,
          )
          const result = await repairTradeGas(finalTrades, chain.rpcs, (progress) => {
            if (run.current !== token) return
            setProgress(
              `Filling gas fees… ${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} receipts (pass ${progress.round})`,
            )
          })
          if (run.current !== token) return
          finalTrades = result.trades
          if (result.missing > 0) {
            flashNotice(
              `Loaded gas for ${result.fetched.toLocaleString("en-US")} txs; ${result.missing.toLocaleString("en-US")} still missing after retries. Re-open the saved tape or reload to retry those.`,
              "info",
            )
          }
        }
      }
      if (run.current !== token) return
      if (poolView) finalTrades = polishTape(poolView, finalTrades)
      setTrades(finalTrades)
      setPhase("done")
      setProgress("")
      if (poolView) {
        void lookUpWalletFacts(chainId, poolView, finalTrades, token)
        if (lookupHolders) void lookUpHolders(chainId, poolView, finalTrades, token)
      }
      if (lookupFunders) {
        void lookUpFunders(
          chainId,
          finalTrades.map((trade) => trade.maker),
          token,
          finalTrades,
        )
      }
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

  const poolManager = pool ? getChain(pool.chainId)?.v4PoolManager ?? null : null
  const trades = useMemo(
    () => annotateTrades(rawTrades, pool?.address ?? "", facts, { poolManager }),
    [rawTrades, pool?.address, facts, poolManager],
  )
  const mevDrainById = useMemo(() => frontRunningById(rawTrades), [rawTrades])
  const mevCount = useMemo(
    () => trades.filter((trade) => trade.makerTags.includes("bot")).length,
    [trades],
  )
  const makerSummaries = useMemo(() => summarizeMakers(trades), [trades])
  const quotePrice = useMemo(() => latestQuotePrice(trades), [trades])
  const quoteUsdPrice = useMemo(() => latestQuoteUsdPrice(trades), [trades])

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

  const launchOrigin = useMemo(() => intervalOriginMs(trades), [trades])
  const launchLabel =
    launchOrigin !== null && period ? describeLaunchWindow(launchOrigin, period.startMs, period.endMs) : null

  const activeLabel = teamLabels.find((label) => label.id === labelId) ?? null
  const activeLabelAddresses = useMemo(
    () => (activeLabel ? new Set(activeLabel.addresses) : null),
    [activeLabel],
  )

  function changeTeamLabels(next: TeamLabel[]) {
    setTeamLabels(next)
    writeTeamLabels(next)
    if (labelId && !next.some((label) => label.id === labelId)) setLabelId("")
  }

  const tapeQuery = useMemo(
    () => ({
      query,
      filter,
      funder,
      period,
      showSelectedOnly,
      showMevOnly,
      sortKey,
      sortDesc,
      labelAddresses: activeLabelAddresses,
      labelMode: activeLabel ? labelMode : null,
    }),
    [query, filter, funder, period, showSelectedOnly, showMevOnly, sortKey, sortDesc, activeLabelAddresses, activeLabel, labelMode],
  )

  const filtered = useMemo(
    () => arrangeTape(trades, selected, tapeQuery),
    [trades, selected, tapeQuery],
  )

  const blacklistTrades = useMemo(() => {
    if (blacklistIds.length === 0 || trades.length === 0) return [] as Trade[]
    const byId = new Map(trades.map((trade) => [trade.id, trade]))
    const rows: Trade[] = []
    for (const id of blacklistIds) {
      const trade = byId.get(id)
      if (trade) rows.push(trade)
    }
    return rows
  }, [trades, blacklistIds])

  const blacklistFiltered = useMemo(
    () => arrangeTape(blacklistTrades, blacklistSelected, tapeQuery),
    [blacklistTrades, blacklistSelected, tapeQuery],
  )

  const viewingBlacklist = tableView === "blacklist"
  const activeTape = viewingBlacklist ? blacklistFiltered : filtered
  const activeSelected = viewingBlacklist ? blacklistSelected : selected
  const labelNet = activeLabel ? netQuoteFlow(activeTape) : null
  const labelsByMaker = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const label of teamLabels) {
      for (const address of label.addresses) {
        const names = map.get(address) ?? []
        names.push(label.name)
        map.set(address, names)
      }
    }
    return map
  }, [teamLabels])

  /** Minute tape ignores type filter so Buy/Sell columns both stay meaningful. */
  const minuteSource = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return trades.filter((trade) => {
      if (funder === "__none__" && trade.fundedByAddress) return false
      if (funder && funder !== "__none__" && trade.fundedByAddress !== funder) return false
      if (activeLabelAddresses && !makerInLabel(trade.maker, activeLabelAddresses, labelMode)) return false
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
  }, [trades, funder, query, period, activeLabelAddresses, labelMode])

  const estimatedBuckets = useMemo(
    () => estimateBucketCount(minuteSource, intervalMs),
    [minuteSource, intervalMs],
  )
  const intervalTooFine = estimatedBuckets > MAX_INTERVAL_BUCKETS

  const minuteRows = useMemo(() => {
    if (intervalTooFine) return [] as MinuteRow[]
    const rows = buildIntervalTape(minuteSource, zone, intervalMs)
    const direction = minuteSortDesc ? -1 : 1
    return [...rows].sort((a, b) => {
      const missingA = isMinuteMissing(a, minuteSortKey)
      const missingB = isMinuteMissing(b, minuteSortKey)
      if (missingA !== missingB) return missingA ? 1 : -1
      return compareMinuteRows(a, b, minuteSortKey) * direction || a.startMs - b.startMs
    })
  }, [minuteSource, zone, intervalMs, intervalTooFine, minuteSortKey, minuteSortDesc])

  const intervalLabel = formatIntervalMs(intervalMs)

  function applyIntervalMs(ms: number, presetId: string) {
    setIntervalMs(ms)
    setIntervalPreset(presetId)
    setPage(0)
  }

  function applyCustomInterval() {
    const parsed = Number(customIntervalValue)
    const ms = intervalToMs(parsed, customIntervalUnit)
    if (ms === null) return
    applyIntervalMs(ms, "custom")
  }

  const listLength = tableView === "minutes" ? minuteRows.length : activeTape.length
  const txColCount = countVisible(txColumns)
  const daColCount = countVisible(daColumns)
  const showTx = (id: TxColumnId) => txColumns[id]
  const showDa = (id: DaColumnId) => daColumns[id]

  function setTxColumn(id: TxColumnId, visible: boolean) {
    setTxColumns((current) => {
      if (!visible && countVisible(current) <= 1) return current
      const next = { ...current, [id]: visible }
      saveTxVisibility(next)
      return next
    })
  }

  function setDaColumn(id: DaColumnId, visible: boolean) {
    setDaColumns((current) => {
      if (!visible && countVisible(current) <= 1) return current
      const next = { ...current, [id]: visible }
      saveDaVisibility(next)
      return next
    })
  }

  function resetTxColumns() {
    const next = defaultTxVisibility()
    saveTxVisibility(next)
    setTxColumns(next)
  }

  function resetDaColumns() {
    const next = defaultDaVisibility()
    saveDaVisibility(next)
    setDaColumns(next)
  }
  const pageCount = Math.max(1, Math.ceil(listLength / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => activeTape.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [activeTape, currentPage, pageSize],
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

  const stats = useMemo(() => {
    const summary = summarizeTrades(trades)
    return {
      ...summary,
      volume: summary.volume > 0 ? formatUsd(summary.volume.toFixed(2)) : "—",
    }
  }, [trades])

  const poolAnchor = useMemo(() => latestPoolMcapAnchor(rawTrades), [rawTrades])
  const gasSpend = useMemo(
    () => (pool ? totalGasSpend(rawTrades, pool.quoteSymbol, ethUsd) : null),
    [pool, rawTrades, ethUsd],
  )
  const pooledShown = pooledEdited ? pooledInput : poolAnchor ? trimDecimal(poolAnchor.quoteReserve) : ""
  const estimatedMcap =
    poolAnchor && pooledShown
      ? marketCapAtPooledQuote(poolAnchor.quoteReserve, poolAnchor.marketCapUsd, pooledEdited ? pooledShown : poolAnchor.quoteReserve)
      : null

  const allVisibleSelected = pageRows.length > 0 && pageRows.every((trade) => activeSelected.has(trade.id))
  const someVisibleSelected = pageRows.some((trade) => activeSelected.has(trade.id))
  const allMatchingSelected = activeTape.length > 0 && activeTape.every((trade) => activeSelected.has(trade.id))

  function changeSelection(update: (draft: Set<string>) => void) {
    const setter = tableView === "blacklist" ? setBlacklistSelected : setSelected
    setter((current) => {
      const next = new Set(current)
      update(next)
      return next
    })
    setIncome(null)
  }

  function addTradeToBlacklist(tradeId: string) {
    const next = addBlacklistIds(blacklistIds, [tradeId])
    if (next === blacklistIds) {
      flashNotice("That transaction is already in the blacklist.", "info")
      return
    }
    setBlacklistIds(next)
    flashNotice("Added 1 transaction to the blacklist.", "ok")
  }

  function removeTradeFromBlacklist(tradeId: string) {
    const next = removeBlacklistIds(blacklistIds, new Set([tradeId]))
    if (next === blacklistIds) return
    setBlacklistIds(next)
    setBlacklistSelected((current) => {
      if (!current.has(tradeId)) return current
      const draft = new Set(current)
      draft.delete(tradeId)
      return draft
    })
    setIncome(null)
    flashNotice("Removed 1 transaction from the blacklist.", "ok")
  }

  function emptyBlacklist() {
    if (blacklistIds.length === 0) return
    setBlacklistIds([])
    setBlacklistSelected(new Set())
    setIncome(null)
    flashNotice("Blacklist cleared.", "ok")
  }

  function toggleTrade(id: string) {
    changeSelection((draft) => {
      if (!draft.delete(id)) draft.add(id)
    })
  }

  /**
   * Normal click toggles one row. Shift+click selects every row between the
   * anchor and this one (current filtered table order).
   */
  function selectTrade(trade: Trade, shiftKey: boolean) {
    const list = tableView === "blacklist" ? blacklistFiltered : filtered
    const index = list.findIndex((row) => row.id === trade.id)
    if (index < 0) return
    if (shiftKey && selectionAnchor.current !== null) {
      const from = Math.min(selectionAnchor.current, index)
      const to = Math.max(selectionAnchor.current, index)
      changeSelection((draft) => {
        for (let i = from; i <= to; i += 1) draft.add(list[i].id)
      })
      selectionAnchor.current = index
      return
    }
    toggleTrade(trade.id)
    selectionAnchor.current = index
  }

  /** Header checkbox: select / clear every row on the current page only. */
  function toggleVisible() {
    const pageIds = pageRows.map((trade) => trade.id)
    changeSelection((draft) => {
      if (allVisibleSelected) {
        for (const id of pageIds) draft.delete(id)
      } else {
        for (const id of pageIds) draft.add(id)
      }
    })
    selectionAnchor.current = pageRows.length > 0 ? activeTape.findIndex((row) => row.id === pageRows[0].id) : null
  }

  function selectAllMatching() {
    const list = tableView === "blacklist" ? blacklistFiltered : filtered
    changeSelection((draft) => {
      for (const trade of list) draft.add(trade.id)
    })
    selectionAnchor.current = list.length > 0 ? 0 : null
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
    const source = tableView === "blacklist" ? blacklistTrades : trades
    const list = tableView === "blacklist" ? blacklistFiltered : filtered
    const matches = source.filter((trade) => trade.txNo >= lo && trade.txNo <= hi)
    if (matches.length === 0) {
      setNoError(`No transactions with No ${lo.toLocaleString("en-US")}—${hi.toLocaleString("en-US")}.`)
      return
    }
    changeSelection((draft) => {
      for (const trade of matches) draft.add(trade.id)
    })
    setNoError(null)
    const first = list.findIndex((row) => row.id === matches[0].id)
    selectionAnchor.current = first >= 0 ? first : null
  }

  function calculateIncome() {
    const onBlacklist = tableView === "blacklist"
    const source = onBlacklist ? blacklistTrades : trades
    const picked = onBlacklist ? blacklistSelected : selected
    const chosen = source.filter((trade) => picked.has(trade.id))
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

  function applyPeriod(startMs: number, endMs: number) {
    const lo = Math.min(startMs, endMs)
    const hi = Math.max(startMs, endMs)
    setStartAt(dateToParts(new Date(lo), zone))
    setEndAt(dateToParts(new Date(hi), zone))
    setPeriodError(null)
    setPeriod({ startMs: lo, endMs: hi })
    selectionAnchor.current = null
    setPage(0)
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

  function extractLaunchOffset(startOffsetMs: number, endOffsetMs: number) {
    const origin = intervalOriginMs(trades)
    if (origin === null) {
      setPeriodError("This tape has no start time.")
      return
    }
    const window = launchWindowMs(origin, startOffsetMs, endOffsetMs)
    applyPeriod(window.startMs, window.endMs)
  }

  function extractCustomLaunch() {
    const start = parseLaunchHours(launchFrom)
    const end = parseLaunchHours(launchTo)
    if (start === null || end === null) {
      setPeriodError("Enter start and end hours from the pool start, for example 2 and 5.")
      return
    }
    if (start === end) {
      setPeriodError("End hour must be different from the start hour.")
      return
    }
    if (end < start) {
      setLaunchFrom(String(end))
      setLaunchTo(String(start))
    }
    extractLaunchOffset(hoursToMs(start), hoursToMs(end))
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

  function toggleMinuteSort(key: MinuteSortKey) {
    if (minuteSortKey === key) {
      setMinuteSortDesc((value) => !value)
      return
    }
    setMinuteSortKey(key)
    setMinuteSortDesc(key !== "no" && key !== "startMs" && key !== "endMs")
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

  function flashNotice(message: string, tone: "ok" | "error" | "info" = "info") {
    setSaveNoticeTone(tone)
    setSaveNotice(message)
  }

  async function persistAnalysis() {
    if (!pool || rawTrades.length === 0) return
    setSaveBusy(true)
    setSaveNotice(null)
    try {
      const { meta, storedPayload, prunedPayloadIds } = await saveAnalysis({
        url: url.trim() || pool.dextoolsUrl,
        pool,
        trades: rawTrades,
        facts,
        warning,
        capped,
      })
      restoreBookmark(meta.id)
      cacheBookmarkMetas([meta])
      const local = await listSavedAnalyses()
      setLocalSavedIds(new Set(local.map((item) => item.id)))
      const pruneNote =
        prunedPayloadIds.length > 0
          ? ` Freed space by dropping ${prunedPayloadIds.length.toLocaleString("en-US")} older full tape(s) (bookmarks kept).`
          : ""
      const tapeNote = storedPayload
        ? ""
        : " Bookmark saved; this browser could not keep the full tape (storage full) — Open will reload from chain."
      if (hasSyncToken()) {
        const catalog = await publishMergedBookmarks(local)
        setSyncStatus(getSyncStatus())
        flashNotice(
          `Saved ${pool.baseSymbol} / ${pool.quoteSymbol} and synced ${catalog.bookmarks.length.toLocaleString("en-US")} pair(s) to every browser.${pruneNote}${tapeNote}`,
          "ok",
        )
      } else {
        await refreshSavedList()
        setSyncStatus(getSyncStatus())
        flashNotice(
          `Saved ${pool.baseSymbol} / ${pool.quoteSymbol} on this browser.${pruneNote}${tapeNote} Open → Enable sync (or Export) to use it on Edge / other PCs.`,
          "ok",
        )
      }
      setGasSavePrompt(false)
    } catch (saveError) {
      flashNotice(saveError instanceof Error ? saveError.message : "Could not save this analysis.", "error")
    } finally {
      setSaveBusy(false)
    }
  }

  function publishOpenTrades(next: Trade[]) {
    tradesRef.current = next
    setTrades(next)
  }

  async function runSavedUpdate() {
    const job = savedUpdateJob.current
    if (!job || run.current !== job.token) return
    setSavedUpdateAsk(null)
    const chain = getChain(job.pool.chainId)
    const pairLabel = `${job.pool.baseSymbol} / ${job.pool.quoteSymbol}`
    let latest = tradesRef.current
    let poolView = job.pool
    const persist = async (funderRevision?: number, funderChecked?: string[]) => {
      await saveAnalysis({
        url: job.url,
        pool: poolView,
        trades: latest,
        facts: job.facts,
        warning: job.warning,
        capped: job.capped,
        savedAt: job.savedAt,
        starred: job.starred,
        funderRevision,
        funderChecked,
      }).catch(() => null)
    }
    const publish = (next: Trade[]) => {
      latest = next
      publishOpenTrades(next)
    }

    if (chain && poolView.baseAddress) {
      const fresh = await resolveTokenTotalSupply(chain, poolView.baseAddress).catch(() => null)
      if (run.current !== job.token) return
      if (fresh && (suppliesDiffer(poolView.baseTotalSupply, fresh) || marketCapsDrift(latest, fresh))) {
        poolView = { ...poolView, baseTotalSupply: fresh }
        let next = polishTape(poolView, latest)
        if (marketCapsDrift(next, fresh)) {
          const repriced = repriceMarketCaps(next, fresh)
          if (repriced.changed) next = repriced.trades
        }
        setPool(poolView)
        publish(next)
        await persist(job.funderRevision, job.funderChecked)
        flashNotice(`Updated market caps for ${pairLabel}.`, "ok")
      }
    }

    if (job.repairGas && chain && chain.id !== "solana") {
      setGasBusy(true)
      setProgress(`Refreshing gas fees for ${countMissingGas(latest).toLocaleString("en-US")} transactions…`)
      const result = await repairTradeGas(latest, chain.rpcs, (progress) => {
        if (run.current !== job.token) return
        setProgress(
          `Refreshing gas fees… ${progress.done.toLocaleString("en-US")} / ${progress.total.toLocaleString("en-US")} receipts (pass ${progress.round})`,
        )
      })
      if (run.current !== job.token) return
      if (result.changed) {
        publish(result.trades)
        await persist(job.funderRevision, job.funderChecked)
      }
      setGasBusy(false)
      setProgress("")
      flashNotice(
        result.missing > 0
          ? `Updated gas for ${pairLabel}; ${result.missing.toLocaleString("en-US")} txs still lack receipts.`
          : `Updated gas fees for ${pairLabel}.`,
        result.missing > 0 ? "info" : "ok",
      )
    }

    if (!chain || job.funderTargets.length === 0) {
      await refreshSavedList().catch(() => null)
      return
    }

    const solana = chain.id === "solana"
    const earliestTradeSec = new Map<string, number>()
    if (solana) {
      for (const trade of latest) {
        if (!trade.maker) continue
        const ts = Math.floor(Date.parse(trade.timestamp) / 1000)
        if (!Number.isFinite(ts)) continue
        const key = makerFunderKey(chain.id, trade.maker)
        const prev = earliestTradeSec.get(key)
        if (prev === undefined || ts < prev) earliestTradeSec.set(key, ts)
      }
    }
    const found = new Map<string, Funder>()
    const failed = new Set<string>()
    const checked = new Set(
      (job.funderRevision === FUNDER_REVISION ? (job.funderChecked ?? []) : []).map((item) =>
        makerFunderKey(chain.id, item),
      ),
    )
    let updated = 0
    let unknown = 0
    const total = job.funderTargets.length
    let done = 0
    setFunding({ done, total })
    const batchSize = 8
    for (let index = 0; index < job.funderTargets.length; index += batchSize) {
      if (run.current !== job.token) return
      const batch = job.funderTargets.slice(index, index + batchSize)
      let batchFound = new Map<string, Funder>()
      try {
        const result = await resolveFunders(chain, batch, Date.now() + 60_000, solana ? earliestTradeSec : undefined)
        batchFound = result.found
        for (const [key, value] of result.found) found.set(key, value)
        for (const maker of result.failed) failed.add(maker)
      } catch {
        for (const maker of batch) failed.add(maker)
      }
      if (run.current !== job.token) return
      for (const maker of batch) {
        if (failed.has(maker)) continue
        checked.add(maker)
        if (batchFound.has(maker)) updated += 1
        else unknown += 1
      }
      const applied = applyFunderResults(chain.id, latest, batchFound)
      if (applied.changed) publish(applied.trades)
      const revision = failed.size === 0 && index + batch.length >= total ? FUNDER_REVISION : job.funderRevision
      await persist(revision, [...checked])
      done = Math.min(index + batch.length, total) - failed.size
      setFunding({ done: Math.max(done, updated + unknown), total })
    }
    if (run.current !== job.token) return
    setFunding(null)
    await refreshSavedList().catch(() => null)
    const unknownNote = unknown > 0 ? ` ${unknown.toLocaleString("en-US")} have no ETH credit.` : ""
    const retryNote = failed.size > 0 ? ` ${failed.size.toLocaleString("en-US")} will be offered again next open.` : ""
    flashNotice(
      updated > 0
        ? `Updated Funded by for ${updated.toLocaleString("en-US")} wallet${updated === 1 ? "" : "s"} on ${pairLabel}.${unknownNote}${retryNote}`
        : `Funded by check finished for ${pairLabel}.${unknownNote}${retryNote}`,
      failed.size > 0 ? "info" : "ok",
    )
  }

  async function openSaved(id: string) {
    setSavedOpen(false)
    setGasSavePrompt(false)
    const meta = savedList.find((item) => item.id === id)
    run.current += 1
    const token = run.current
    setPhase("loading")
    resetViewState()
    setProgress("Opening saved analysis…")
    try {
      const saved = await loadSavedAnalysis(id)
      if (saved) {
        setUrl(saved.url)
        setPool(saved.pool)
        setFacts(saved.facts)
        setWarning(saved.warning)
        setCapped(saved.capped)
        publishOpenTrades(saved.trades)
        setPhase("done")
        setProgress("")
        const pairLabel = `${saved.pool.baseSymbol} / ${saved.pool.quoteSymbol}`
        const chain = getChain(saved.pool.chainId)
        const funderTargets = chain
          ? makersToRefresh(chain.id, saved.trades, saved.funderRevision, saved.funderChecked, lookupFunders)
          : []
        const repairGas = lookupGas && tradesNeedGasRepair(saved.trades)
        const gasCount = repairGas ? countMissingGas(saved.trades) : 0
        flashNotice(`Opened saved ${pairLabel} from ${formatSavedAt(saved.savedAt)}.`, "ok")
        if (funderTargets.length > 0 || repairGas) {
          savedUpdateJob.current = {
            token,
            url: saved.url,
            pool: saved.pool,
            facts: saved.facts,
            warning: saved.warning,
            capped: saved.capped,
            savedAt: saved.savedAt,
            starred: meta?.starred,
            funderTargets,
            funderRevision: saved.funderRevision,
            funderChecked: saved.funderChecked,
            repairGas,
          }
          setSavedUpdateAsk({ pairLabel, funderCount: funderTargets.length, gasCount })
        }
        return
      }
      if (!meta?.url) throw new Error("That saved analysis is no longer available.")
      setUrl(meta.url)
      flashNotice(
        `Loading ${meta.baseSymbol} / ${meta.quoteSymbol} from chain (no local snapshot on this browser)…`,
        "info",
      )
      await load(meta.url)
    } catch (openError) {
      setPhase("error")
      setError(openError instanceof Error ? openError.message : "Could not open saved analysis.")
    }
  }

  function askDeleteSaved(item: SavedAnalysisMeta) {
    setDeleteResult(null)
    setDeleteTarget(item)
  }

  function closeDeleteModal() {
    if (deleteBusy) return
    setDeleteTarget(null)
    setDeleteResult(null)
  }

  async function confirmDeleteSaved() {
    if (!deleteTarget || deleteBusy) return
    const id = deleteTarget.id
    const label = `${deleteTarget.baseSymbol} / ${deleteTarget.quoteSymbol}`
    setDeleteBusy(true)
    setDeleteResult(null)
    try {
      dismissBookmark(id)
      await deleteSavedAnalysis(id)
      cacheBookmarkMetas(
        withoutDismissed(readCachedBookmarkMetas().filter((item) => item.id !== id)),
        { replace: true },
      )
      const local = await listSavedAnalyses().catch(() => [] as SavedAnalysisMeta[])
      setLocalSavedIds(new Set(local.map((item) => item.id)))
      setSavedList((current) => current.filter((item) => item.id !== id))
      if (hasSyncToken()) {
        try {
          const remote = await fetchRemoteBookmarks()
          const merged = withoutDismissed(mergeSavedMeta(local, remote.bookmarks).filter((item) => item.id !== id))
          await publishBookmarks(merged, undefined, { allowEmpty: true })
          setSavedList(merged)
          setSyncStatus(getSyncStatus())
          const message = `${label} was deleted from this browser and the shared list.`
          setDeleteResult({ ok: true, message })
          flashNotice(message, "ok")
        } catch (syncError) {
          const message = `${label} was removed from this browser, but the shared list could not be updated: ${
            syncError instanceof Error ? syncError.message : "unknown error"
          }`
          setDeleteResult({ ok: false, message })
          flashNotice(message, "error")
        }
      } else {
        const remote = await fetchRemoteBookmarks().catch(() => null)
        const stillShared = Boolean(remote?.bookmarks.some((item) => item.id === id))
        const message = stillShared
          ? `${label} was removed from this browser. Other PCs still show it until you enable sync and publish.`
          : `${label} was deleted from this browser.`
        setDeleteResult({ ok: true, message })
        flashNotice(message, "ok")
      }
    } catch (error) {
      const message = `Could not delete ${label}: ${error instanceof Error ? error.message : "unknown error"}`
      setDeleteResult({ ok: false, message })
      flashNotice(message, "error")
    } finally {
      setDeleteBusy(false)
    }
  }

  async function toggleStar(item: SavedAnalysisMeta) {
    const next = !item.starred
    setSavedList((current) =>
      [...current.map((row) => (row.id === item.id ? { ...row, starred: next } : row))].sort(compareSavedMeta),
    )
    try {
      if (localSavedIds.has(item.id)) await setAnalysisStarred(item.id, next)
      if (hasSyncToken()) {
        const local = await listSavedAnalyses().catch(() => [] as SavedAnalysisMeta[])
        const remote = await fetchRemoteBookmarks()
        const merged = mergeSavedMeta(local, remote.bookmarks).map((row) =>
          row.id === item.id ? { ...row, starred: next } : row,
        )
        await publishBookmarks(merged)
        setSavedList(merged.sort(compareSavedMeta))
      } else {
        await refreshSavedList()
      }
    } catch {
      await refreshSavedList()
    }
  }

  async function downloadVault() {
    try {
      const vault = await exportSavedVault()
      const blob = new Blob([`${JSON.stringify(vault)}\n`], { type: "application/json" })
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.download = `pairsheet-saved-pairs-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(href)
      flashNotice(`Exported ${vault.payloads.length.toLocaleString("en-US")} saved pair${vault.payloads.length === 1 ? "" : "s"}.`, "ok")
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : "Could not export saved pairs.", "error")
    }
  }

  async function onImportVault(file: File | null) {
    if (!file) return
    try {
      const text = await file.text()
      const vault = JSON.parse(text) as SavedVault
      const count = await importSavedVault(vault)
      const local = await listSavedAnalyses()
      for (const item of local) restoreBookmark(item.id)
      setLocalSavedIds(new Set(local.map((item) => item.id)))
      if (hasSyncToken()) await publishMergedBookmarks(local)
      else await refreshSavedList()
      flashNotice(`Imported ${count.toLocaleString("en-US")} saved pair${count === 1 ? "" : "s"} into this browser.`, "ok")
    } catch (error) {
      flashNotice(error instanceof Error ? error.message : "Could not import that file.", "error")
    } finally {
      if (importFileRef.current) importFileRef.current.value = ""
    }
  }

  async function saveSyncToken() {
    const token = syncTokenDraft.trim()
    setSyncMessage(null)
    if (!token) {
      clearSync()
      setSyncEnabled(false)
      setSyncStatus(getSyncStatus())
      setSyncMessage("Not synced Â· this browser only.")
      return
    }
    setSyncBusy(true)
    try {
      const check = await validateSyncToken(token)
      if (!check.ok) {
        setSyncEnabled(false)
        setSyncStatus(getSyncStatus())
        setSyncMessage(check.error)
        return
      }
      setSyncToken(token)
      // Token is kept in memory (+ IndexedDB when localStorage is blocked). Always publish with the
      // validated token so a storage quirk cannot abort a successful GitHub auth.
      setSyncEnabled(true)
      const local = await localBookmarksForPublish()
      const catalog = await publishMergedBookmarks(local, token)
      setShowSyncSetup(false)
      const status = getSyncStatus()
      setSyncStatus(status)
      if (!isSyncSuccessful(status) || catalog.bookmarks.length === 0) {
        setSyncMessage("Token saved, but the shared list is still empty. Click Publish now after saving pairs here.")
        flashNotice("Token saved. Publish again once this browser has saved pairs.", "info")
        return
      }
      setSyncMessage(
        `Synced ${catalog.bookmarks.length} pair(s) as ${check.login ?? "GitHub"}. Other browsers will see them after a refresh.`,
      )
      flashNotice(`Cloud sync is on Â· ${catalog.bookmarks.length} pair(s) on the shared list.`, "ok")
    } catch (error) {
      setSyncStatus(getSyncStatus())
      setSyncMessage(error instanceof Error ? error.message : "Could not publish bookmarks.")
    } finally {
      setSyncBusy(false)
      setSyncStatus(getSyncStatus())
      setSyncEnabled(hasSyncToken())
    }
  }

  async function publishNow() {
    if (!hasSyncToken()) {
      setShowSyncSetup(true)
      setSyncMessage("Paste a GitHub token first, then publish.")
      return
    }
    setSyncBusy(true)
    setSyncMessage(null)
    try {
      const local = await localBookmarksForPublish()
      const catalog = await publishMergedBookmarks(local)
      const status = getSyncStatus()
      setSyncStatus(status)
      if (!isSyncSuccessful(status) || catalog.bookmarks.length === 0) {
        setSyncMessage("Shared list is still empty after publish. Save pairs on this browser, then try again.")
        return
      }
      setSyncMessage(`Synced Â· ${catalog.bookmarks.length} pair(s) Â· ${formatSyncAgo(status.lastOkAt)}`)
      flashNotice(`Published ${catalog.bookmarks.length} saved pair(s) to the shared list.`, "ok")
    } catch (error) {
      setSyncStatus(getSyncStatus())
      setSyncMessage(error instanceof Error ? error.message : "Could not publish bookmarks.")
    } finally {
      setSyncBusy(false)
      setSyncEnabled(hasSyncToken())
    }
  }

  return (
    <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-10 2xl:px-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_0_6px_oklch(0.82_0.12_190/0.12)]">
            <LedgerMark />
          </span>
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">On-chain tape</p>
            <div className="flex items-center gap-1.5">
              <h1 className="font-heading text-3xl font-semibold tracking-tight">Pair Sheet</h1>
              <HelpDialogButton />
            </div>
          </div>
        </div>
        <LiveMarketWidgets />
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
        <div className="flex flex-col gap-2">
          <Input
            id="pair-url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.dextools.io/app/ether/pair-explorer/0x…"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-11 w-full font-mono text-sm"
            aria-invalid={phase === "error"}
          />
          <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-11 px-4"
            disabled={phase === "loading"}
            onClick={() => {
              setSyncEnabled(hasSyncToken())
              setSyncStatus(getSyncStatus())
              setSyncMessage(null)
              void refreshSavedList()
              setSavedOpen(true)
            }}
          >
            <FolderOpen />
            Open
            {savedList.length > 0 ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {savedList.length}
              </span>
            ) : null}
          </Button>
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="h-11 px-4"
            disabled={phase === "loading" || manualUpdating || liveMode === "updating" || !pool || rawTrades.length === 0}
            title={pool && rawTrades.length > 0 ? "Append swaps newer than this tape" : "Open a saved pair or load swaps first"}
            onClick={() => void catchUpLatest(true)}
          >
            {manualUpdating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {manualUpdating ? "Updating…" : "Update"}
          </Button>
          <Button type="submit" size="lg" className="h-11 px-4" disabled={phase === "loading" || url.trim() === ""}>
            {phase === "loading" ? <Loader2 className="animate-spin" /> : null}
            {phase === "loading" ? "Reading chain" : "Load swaps"}
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={liveEnabled}
            aria-label="Real-time updates"
            title={
              liveEnabled
                ? "Real-time updates on. New swaps are added about every 12 seconds."
                : "Real-time updates off. Use Update to fetch the latest swaps."
            }
            onClick={() => changeLiveEnabled(!liveEnabled)}
            className={`inline-flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium ring-1 ring-foreground/15 ${
              liveEnabled ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground"
            }`}
          >
            <span className={`relative h-5 w-9 shrink-0 rounded-full ${liveEnabled ? "bg-emerald-500" : "bg-foreground/20"}`}>
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${liveEnabled ? "left-4" : "left-0.5"}`}
              />
            </span>
            Live
          </button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          <p className="text-xs">
            Optional lookups (off by default on Load swaps). After the tape is ready, use{" "}
            <span className="text-foreground">Load</span> on a row to fetch that column — you will confirm first.
          </p>
          {(
            [
              {
                kind: "gas" as const,
                checked: lookupGas,
                onChange: changeLookupGas,
                busy: gasBusy,
                label: (
                  <>
                    <span className="text-foreground">Gas Price</span> and{" "}
                    <span className="text-foreground">Gas Fee Total</span>
                  </>
                ),
              },
              {
                kind: "holders" as const,
                checked: lookupHolders,
                onChange: changeLookupHolders,
                busy: holdersBusy,
                label: (
                  <>
                    <span className="text-foreground">Holders</span> at each transaction
                  </>
                ),
              },
              {
                kind: "funders" as const,
                checked: lookupFunders,
                onChange: changeLookupFunders,
                busy: funding !== null,
                label: (
                  <>
                    <span className="text-foreground">Funded by</span> for each maker
                  </>
                ),
              },
            ] as const
          ).map((row) => (
            <div key={row.kind} className="flex flex-wrap items-center gap-2 sm:gap-3">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 shrink-0 rounded border-border"
                  checked={row.checked}
                  disabled={phase === "loading"}
                  onChange={(event) => row.onChange(event.target.checked)}
                />
                <span className="min-w-0">Include on Load swaps Â· {row.label}</span>
              </label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={!tapeReady || extraBusy}
                onClick={() => setConfirmExtra(row.kind)}
              >
                {row.busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {row.busy ? "Loading…" : "Load"}
              </Button>
            </div>
          ))}
        </div>
      </form>

      {savedOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSavedOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-pairs-title"
            className="flex max-h-[min(40rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-xl ring-1 ring-foreground/10"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <h2 id="saved-pairs-title" className="text-base font-semibold tracking-tight">
                  Saved pairs
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {isSyncSuccessful(syncStatus)
                    ? "Synced across browsers via GitHub. Star a pair to pin it."
                    : "This browser keeps full snapshots. Enable sync or Export so Edge / other PCs can see them."}
                </p>
                <p
                  className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${
                    syncBusy
                      ? "bg-muted text-muted-foreground"
                      : isSyncSuccessful(syncStatus)
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                  }`}
                  role="status"
                >
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${
                      syncBusy
                        ? "bg-muted-foreground"
                        : isSyncSuccessful(syncStatus)
                          ? "bg-emerald-500"
                          : "bg-rose-500"
                    }`}
                  />
                  {syncBusy
                    ? "Syncing with GitHub…"
                    : isSyncSuccessful(syncStatus)
                      ? `Synced Â· ${syncStatus.lastCount} pair(s) Â· ${formatSyncAgo(syncStatus.lastOkAt)}`
                      : syncStatus.lastError
                        ? "Not synced Â· publish failed"
                        : "Not synced Â· this browser only"}
                </p>
              </div>
              <Button type="button" size="icon" variant="ghost" aria-label="Close saved pairs" onClick={() => setSavedOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
              <Button type="button" size="sm" variant="outline" onClick={() => void downloadVault()} disabled={localSavedIds.size === 0}>
                <Download className="size-3.5" />
                Export
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => importFileRef.current?.click()}>
                <Upload className="size-3.5" />
                Import
              </Button>
              <input
                ref={importFileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => void onImportVault(event.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={
                  isSyncSuccessful(syncStatus)
                    ? "border-emerald-500/40 text-emerald-400"
                    : syncEnabled
                      ? "border-rose-500/40 text-rose-400"
                      : undefined
                }
                onClick={() => {
                  setShowSyncSetup((value) => !value)
                  setSyncMessage(null)
                }}
              >
                <Cloud className="size-3.5" />
                {syncEnabled ? "Sync settings" : "Enable sync"}
              </Button>
              {syncEnabled ? (
                <Button type="button" size="sm" variant="ghost" disabled={syncBusy} onClick={() => void publishNow()}>
                  {syncBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Publish now
                </Button>
              ) : null}
            </div>

            {syncMessage || syncStatus.lastError ? (
              <div
                className={`border-b border-border px-4 py-2 text-xs ${
                  isSyncSuccessful(syncStatus) &&
                  syncMessage &&
                  !/fail|denied|rejected|error|could not|nothing to publish|no local/i.test(syncMessage)
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-rose-500/10 text-rose-400"
                }`}
                role="status"
              >
                {syncMessage ?? syncStatus.lastError}
              </div>
            ) : null}

            {showSyncSetup ? (
              <div className="space-y-2 border-b border-border px-4 py-3 text-sm">
                <p className="text-xs text-muted-foreground">
                  Create a <strong>new</strong> fine-grained GitHub PAT (revoke any token you pasted in chat). Grant Contents
                  Read and Write on <span className="font-mono">NeverSMILE0825/pairsheet</span>, paste it here once per
                  browser, then Save token &amp; publish. Other browsers only open the site to see the shared list.
                </p>
                <a className="text-xs text-primary hover:underline" href={syncTokenHelpUrl()} target="_blank" rel="noreferrer">
                  Create fine-grained token
                </a>
                <Input
                  type="password"
                  value={syncTokenDraft}
                  onChange={(event) => setSyncTokenDraft(event.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 font-mono text-xs"
                  aria-label="GitHub sync token"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={syncBusy || syncTokenDraft.trim() === ""} onClick={() => void saveSyncToken()}>
                    {syncBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    Save token &amp; publish
                  </Button>
                  {syncEnabled ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        clearSync()
                        setSyncTokenDraft("")
                        setSyncEnabled(false)
                        setSyncStatus(getSyncStatus())
                        setSyncMessage("Cloud sync turned off on this browser.")
                        flashNotice("Cloud sync turned off on this browser.", "info")
                      }}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {savedList.length === 0 ? (
                <p className="px-2 py-10 text-center text-sm text-muted-foreground">
                  No saved pairs yet. Load a tape, then use Save analysis — or Import a backup from another browser.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {savedList.map((item) => {
                    const local = localSavedIds.has(item.id)
                    return (
                      <li
                        key={item.id}
                        className="flex flex-col gap-2 rounded-xl bg-muted/40 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <button
                            type="button"
                            className={`mt-0.5 shrink-0 rounded-md p-1 ${
                              item.starred ? "text-amber-400 hover:text-amber-300" : "text-muted-foreground hover:text-foreground"
                            }`}
                            aria-label={
                              item.starred
                                ? `Unstar ${item.baseSymbol} / ${item.quoteSymbol}`
                                : `Star ${item.baseSymbol} / ${item.quoteSymbol}`
                            }
                            aria-pressed={Boolean(item.starred)}
                            onClick={() => void toggleStar(item)}
                          >
                            <Star className={`size-4 ${item.starred ? "fill-current" : ""}`} />
                          </button>
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {item.baseSymbol} / {item.quoteSymbol}
                              <span className="ml-2 text-xs font-normal text-muted-foreground">{item.chainName}</span>
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {item.tradeCount.toLocaleString("en-US")} txs Â· saved {formatSavedAt(item.savedAt)}
                              {local ? " Â· this browser" : " Â· shared list"}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-2 pl-8 sm:pl-0">
                          <Button
                            type="button"
                            size="sm"
                            disabled={phase === "loading"}
                            onClick={() => void openSaved(item.id)}
                          >
                            Open
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-rose-300 hover:text-rose-200"
                            aria-label={`Delete saved ${item.baseSymbol} / ${item.quoteSymbol}`}
                            disabled={phase === "loading" || deleteBusy}
                            onClick={() => askDeleteSaved(item)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {saveNotice ? (
        <p
          className={`rounded-xl px-4 py-3 text-sm ring-1 ${
            saveNoticeTone === "ok"
              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
              : saveNoticeTone === "error"
                ? "bg-rose-500/10 text-rose-300 ring-rose-500/30"
                : "bg-muted/60 text-muted-foreground ring-foreground/10"
          }`}
          role="status"
        >
          {saveNotice}
        </p>
      ) : null}

      {pool ? (
        <BehaviourReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          pool={pool}
          trades={trades}
        />
      ) : null}

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDeleteModal()
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-pair-title"
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl ring-1 ring-foreground/10"
          >
            <h2 id="delete-pair-title" className="text-base font-semibold tracking-tight">
              Delete saved pair?
            </h2>
            {!deleteResult ? (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  Remove <span className="font-medium text-foreground">{deleteTarget.baseSymbol} / {deleteTarget.quoteSymbol}</span>
                  {hasSyncToken()
                    ? " from this browser and the shared bookmark list? This cannot be undone."
                    : " from this browser? Other PCs keep it until you enable sync and publish."}
                </p>
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" disabled={deleteBusy} onClick={closeDeleteModal}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={deleteBusy}
                    onClick={() => void confirmDeleteSaved()}
                  >
                    {deleteBusy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    {deleteBusy ? "Deleting…" : "Delete pair"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p
                  className={`mt-2 text-sm ${deleteResult.ok ? "text-emerald-300" : "text-rose-300"}`}
                  role="alert"
                >
                  {deleteResult.message}
                </p>
                <div className="mt-4 flex justify-end">
                  <Button type="button" onClick={closeDeleteModal}>
                    OK
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {gasSavePrompt ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setGasSavePrompt(false)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="gas-save-title"
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl ring-1 ring-foreground/10"
          >
            <h2 id="gas-save-title" className="text-base font-semibold tracking-tight">
              Save updated gas fees?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This saved tape had missing or outdated gas columns. Pair Sheet recalculated them
              {pool ? ` for ${pool.baseSymbol} / ${pool.quoteSymbol}` : ""}. Save the updated analysis on this browser?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setGasSavePrompt(false)}>
                Not now
              </Button>
              <Button type="button" disabled={saveBusy || !pool || rawTrades.length === 0} onClick={() => void persistAnalysis()}>
                {saveBusy ? <Loader2 className="animate-spin" /> : null}
                Save updated analysis
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {savedUpdateAsk ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              savedUpdateJob.current = null
              setSavedUpdateAsk(null)
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-update-title"
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl ring-1 ring-foreground/10"
          >
            <h2 id="saved-update-title" className="text-base font-semibold tracking-tight">
              Update this saved pair?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {savedUpdateAsk.pairLabel} is already on screen from the saved tape.
              {savedUpdateAsk.funderCount > 0
                ? ` Funded by can refresh ${savedUpdateAsk.funderCount.toLocaleString("en-US")} wallet${savedUpdateAsk.funderCount === 1 ? "" : "s"}.`
                : ""}
              {savedUpdateAsk.gasCount > 0
                ? ` Gas can fill ${savedUpdateAsk.gasCount.toLocaleString("en-US")} receipt${savedUpdateAsk.gasCount === 1 ? "" : "s"}.`
                : ""}{" "}
              Update keeps this table open and replaces each value as soon as it arrives.
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  savedUpdateJob.current = null
                  setSavedUpdateAsk(null)
                }}
              >
                Keep saved data
              </Button>
              <Button type="button" onClick={() => void runSavedUpdate()}>
                Update
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {phase === "loading" || gasBusy ? (
        <p className="text-sm text-muted-foreground" role="status">
          {progress || (gasBusy ? "Filling gas fees…" : "")}
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

      {confirmExtra ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirmExtra(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="extra-lookup-title"
            className="w-full max-w-md rounded-2xl bg-card p-5 shadow-xl ring-1 ring-foreground/10"
          >
            <h2 id="extra-lookup-title" className="text-base font-semibold tracking-tight">
              {EXTRA_LOOKUP_COPY[confirmExtra].title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {EXTRA_LOOKUP_COPY[confirmExtra].body}
              {pool
                ? ` Currently loaded: ${pool.baseSymbol} / ${pool.quoteSymbol} Â· ${rawTrades.length.toLocaleString("en-US")} transactions.`
                : ""}
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmExtra(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const kind = confirmExtra
                  setConfirmExtra(null)
                  void runExtraLookup(kind)
                }}
              >
                {EXTRA_LOOKUP_COPY[confirmExtra].confirm}
              </Button>
            </div>
          </div>
        </div>
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
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11"
                onClick={() => void persistAnalysis()}
                disabled={rawTrades.length === 0 || saveBusy || phase === "loading"}
                title={
                  holdersBusy || funding
                    ? "Optional lookups still running; save keeps whatever gas, holders, and funders are filled so far."
                    : undefined
                }
              >
                {saveBusy ? <Loader2 className="animate-spin" /> : <Save />}
                {saveBusy ? "Saving…" : "Save analysis"}
              </Button>
              <Button type="button" size="lg" className="h-11" onClick={download} disabled={filtered.length === 0}>
                <Download />
                Download CSV
                {filtered.length > 0 ? ` Â· ${filtered.length.toLocaleString("en-US")}` : ""}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="h-11"
                onClick={() => setReportOpen(true)}
                disabled={rawTrades.length === 0}
              >
                <FileText />
                Generate Report
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat
              label="Transactions"
              value={stats.count.toLocaleString("en-US")}
              hint={liveMode === "updating" ? "Updating…" : liveMode === "live" ? "Live" : undefined}
            />
            <Stat label="Buys" value={stats.buys.toLocaleString("en-US")} tone="buy" />
            <Stat label="Sells" value={stats.sells.toLocaleString("en-US")} tone="sell" />
            <Stat label="Add / Remove" value={`${stats.adds.toLocaleString("en-US")} / ${stats.removes.toLocaleString("en-US")}`} />
            <Stat label="Quote volume" value={stats.volume} />
          </div>

          {pool && poolAnchor ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10 sm:flex-row sm:items-end sm:justify-between">
              <label className="min-w-0 flex-1">
                <span className="text-xs tracking-wide text-muted-foreground uppercase">
                  Pooled {pool.quoteSymbol}
                </span>
                <Input
                  value={pooledShown}
                  onChange={(event) => {
                    setPooledEdited(true)
                    setPooledInput(event.target.value)
                  }}
                  inputMode="decimal"
                  spellCheck={false}
                  className="mt-1 h-11 max-w-xs font-mono"
                  aria-label={`Pooled ${pool.quoteSymbol} for market cap`}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Market cap moves with the square of pooled {pool.quoteSymbol}. The current amount matches the latest row.
                </p>
              </label>
              <div className="min-w-0 sm:text-right">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">Estimated M. Cap</p>
                <p className={`mt-1 font-mono text-xl ${changeTone(poolAnchor.marketCapUsd, estimatedMcap)}`}>
                  {estimatedMcap ? formatUsd(estimatedMcap) : "—"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Latest row {formatPoolSize(trimDecimal(poolAnchor.quoteReserve))} {pool.quoteSymbol} →{" "}
                  {formatUsd(poolAnchor.marketCapUsd)}
                  {estimatedMcap && normalizePooledQuote(pooledShown) !== ""
                    ? ` · ${describeMcapMultiple(poolAnchor.marketCapUsd, estimatedMcap)}`
                    : ""}
                </p>
              </div>
            </div>
          ) : null}

          {warning ? <p className="text-sm text-muted-foreground">{warning}</p> : null}
          {capped ? (
            <p className="text-sm text-muted-foreground">
              Stopped at {MAX_TRADES.toLocaleString("en-US")} transactions. This pool has more history than one export pulls.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <span className="text-sm font-medium text-foreground">Table view</span>
              <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Table view">
                {(
                  [
                    ["transactions", "Transactions"],
                    ["minutes", "Deep Analysis"],
                    ["blacklist", "Blacklist"],
                  ] as const
                ).map(([view, label]) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    aria-selected={tableView === view}
                    className={`rounded-md px-4 py-2 text-sm font-semibold ${
                      tableView === view
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      setTableView(view)
                      setPage(0)
                    }}
                  >
                    {label}
                    {view === "blacklist" && blacklistIds.length > 0
                      ? ` · ${blacklistIds.length.toLocaleString("en-US")}`
                      : ""}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                disabled={blacklistIds.length === 0}
                onClick={emptyBlacklist}
              >
                Empty blacklist
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9"
                disabled={!pool || rawTrades.length === 0}
                aria-pressed={showTotalGas}
                onClick={() => setShowTotalGas((open) => !open)}
              >
                Total Gas
              </Button>
              {showTotalGas && gasSpend ? (
                <p className="font-mono text-sm text-foreground" role="status">
                  {gasSpend.txCount === 0
                    ? "No gas loaded yet. Turn on Gas and use Load."
                    : `${formatGasUsd(gasSpend.usd)} · ${trimDecimal(ethFromWei(gasSpend.wei))} ETH · ${gasSpend.txCount.toLocaleString("en-US")} txs${
                        gasSpend.missing > 0 ? ` · ${gasSpend.missing.toLocaleString("en-US")} still missing` : ""
                      }`}
                </p>
              ) : null}
              {tableView === "minutes" ? (
              <p className="text-sm text-muted-foreground">
                Deep Analysis Â· buy/sell counts, pool, holders, and gas per {intervalLabel} ({zoneName}).
              </p>
            ) : tableView === "blacklist" ? (
              <p className="text-sm text-muted-foreground">
                Checked swaps kept aside. Calculate Income here uses only this table.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Full swap tape with pool size, holders, gas, and funders.</p>
            )}
            </div>
          </div>

          {tableView === "minutes" ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <span className="text-sm font-medium text-foreground">Interval</span>
                <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Interval presets">
                  {INTERVAL_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={intervalPreset === preset.id && intervalMs === preset.ms}
                      className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
                        intervalPreset === preset.id && intervalMs === preset.ms
                          ? "bg-background text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                      onClick={() => applyIntervalMs(preset.ms, preset.id)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Custom</span>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={customIntervalValue}
                    onChange={(event) => setCustomIntervalValue(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") applyCustomInterval()
                    }}
                    aria-label="Custom interval value"
                    className="h-9 w-20"
                  />
                  <select
                    aria-label="Custom interval unit"
                    value={customIntervalUnit}
                    onChange={(event) => setCustomIntervalUnit(event.target.value as IntervalUnit)}
                    className="h-9 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="sec">sec</option>
                    <option value="min">min</option>
                    <option value="hour">hour</option>
                    <option value="d">d</option>
                  </select>
                  <Button type="button" size="sm" variant="outline" onClick={applyCustomInterval}>
                    Apply
                  </Button>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={minuteRows.length === 0}
                onClick={() => setChartOpen(true)}
              >
                Show Chart
              </Button>
            </div>
          ) : null}

          {tableView === "minutes" && intervalTooFine ? (
            <p className="text-sm text-amber-400">
              Interval {intervalLabel} would create about {estimatedBuckets.toLocaleString("en-US")} rows
              (max {MAX_INTERVAL_BUCKETS.toLocaleString("en-US")}). Choose a coarser interval.
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {tableView !== "minutes" ? (
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
              <span className="text-sm text-muted-foreground">Type filters apply on the Transactions view.</span>
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
            {tableView !== "minutes" ? (
              <>
                <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => setTeamLabelsOpen(true)}>
                  Team wallets
                  {teamLabels.length > 0 ? ` · ${teamLabels.length}` : ""}
                </Button>
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  Label
                  <select
                    aria-label="Team wallet label"
                    value={labelId}
                    onChange={(event) => {
                      setLabelId(event.target.value)
                      selectionAnchor.current = null
                      setPage(0)
                    }}
                    className="h-9 max-w-48 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                  >
                    <option value="">All wallets</option>
                    {teamLabels.map((label) => (
                      <option key={label.id} value={label.id}>
                        {label.name} ({label.addresses.length.toLocaleString("en-US")})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Label transaction filter">
                  <button
                    type="button"
                    aria-pressed={Boolean(activeLabel) && labelMode === "only"}
                    disabled={!activeLabel}
                    className={`rounded-md px-2.5 py-1 text-sm font-medium disabled:opacity-40 ${
                      activeLabel && labelMode === "only" ? "bg-background text-foreground" : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      setLabelMode("only")
                      selectionAnchor.current = null
                      setPage(0)
                    }}
                  >
                    Only labeled
                  </button>
                  <button
                    type="button"
                    aria-pressed={Boolean(activeLabel) && labelMode === "without"}
                    disabled={!activeLabel}
                    className={`rounded-md px-2.5 py-1 text-sm font-medium disabled:opacity-40 ${
                      activeLabel && labelMode === "without" ? "bg-background text-foreground" : "text-muted-foreground"
                    }`}
                    onClick={() => {
                      setLabelMode("without")
                      selectionAnchor.current = null
                      setPage(0)
                    }}
                  >
                    Without label
                  </button>
                </div>
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
                <Button
                  type="button"
                  size="sm"
                  variant={showMevOnly ? "default" : "outline"}
                  className="h-9 gap-1.5"
                  disabled={rawTrades.length === 0 || phase === "loading"}
                  onClick={() => {
                    if (showMevOnly) {
                      setShowMevOnly(false)
                      setPage(0)
                      return
                    }
                    detectMevBots()
                  }}
                  title="Show DEXTools-style front-running: same wallet buy+sell in the same second (or same token amount within 30s). Click again to clear."
                >
                  <MevBotIcon className="size-3.5" />
                  {showMevOnly
                    ? `MEV bots · ${mevCount.toLocaleString("en-US")}`
                    : "Detect MEV bots"}
                </Button>
              </>
            ) : null}
            {tableView !== "minutes" ? (
              <ColumnsMenu
                defs={TX_COLUMN_DEFS}
                visibility={txColumns}
                onChange={setTxColumn}
                onReset={resetTxColumns}
                resolveLabel={(id, fallback) => {
                  if (id === "priceQuote") return `Price (${pool?.quoteSymbol ?? "quote"})`
                  if (id === "baseAmount") return pool?.baseSymbol ?? "Base"
                  if (id === "quoteAmount") return pool?.quoteSymbol ?? "Quote"
                  if (id === "baseReserve") return `Pool ${pool?.baseSymbol ?? "base"}`
                  if (id === "quoteReserve") return `Pool ${pool?.quoteSymbol ?? "quote"}`
                  if (id === "timestamp") return `Date (${zoneName})`
                  return fallback
                }}
              />
            ) : (
              <ColumnsMenu
                defs={DA_COLUMN_DEFS}
                visibility={daColumns}
                onChange={setDaColumn}
                onReset={resetDaColumns}
                resolveLabel={(id, fallback) => {
                  if (id === "startQuoteReserve") return `Start Pool ${pool?.quoteSymbol ?? "quote"}`
                  if (id === "endQuoteReserve") return `End Pool ${pool?.quoteSymbol ?? "quote"}`
                  if (id === "startMs") return `Start Time (${zoneName})`
                  if (id === "endMs") return `End Time (${zoneName})`
                  return fallback
                }}
              />
            )}
            {activeLabel && labelNet !== null ? (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                <span className="font-medium text-foreground">{activeLabel.name}</span>
                {" · "}
                {labelMode === "only" ? "only labeled" : "without this label"}
                {" · "}
                {activeLabel.addresses.length.toLocaleString("en-US")} wallets
                {" · "}
                {activeTape.length.toLocaleString("en-US")} txs
                {" · net "}
                <span className={labelNet.startsWith("-") ? "font-medium text-rose-400" : "font-medium text-emerald-400"}>
                  {labelNet.startsWith("-") ? "" : "+"}
                  {formatQuoteAmount(labelNet)} {pool?.quoteSymbol ?? ""}
                </span>
              </p>
            ) : null}
          </div>

          {tableView !== "minutes" ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" size="lg" className="h-10" onClick={calculateIncome} disabled={activeSelected.size === 0}>
                <Calculator />
                Calculate Income
              </Button>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                {activeSelected.size === 0
                  ? tableView === "blacklist"
                    ? "Tick blacklist rows, then calculate. Trash removes that row."
                    : "Tick rows to calculate income. >> in Others blacklists that row. Shift+click selects a range."
                  : `${activeSelected.size.toLocaleString("en-US")} transaction${activeSelected.size === 1 ? "" : "s"} selected`}
              </p>
              {activeTape.length > pageRows.length && !allMatchingSelected ? (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-sm text-foreground hover:bg-accent"
                  onClick={selectAllMatching}
                >
                  Select all {activeTape.length.toLocaleString("en-US")} matching
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
              <Button
                type="button"
                variant={showSelectedOnly ? "default" : "outline"}
                size="sm"
                className="h-8"
                disabled={activeSelected.size === 0 && !showSelectedOnly}
                aria-pressed={showSelectedOnly}
                onClick={() => {
                  setShowSelectedOnly((current) => !current)
                  setPage(0)
                }}
                title={
                  showSelectedOnly
                    ? "Show the full filtered tape again"
                    : "Show only checked rows in the table"
                }
              >
                {showSelectedOnly
                  ? `Show all${activeTape.length > 0 ? ` · ${activeTape.length.toLocaleString("en-US")}` : ""}`
                  : `Show selected${activeSelected.size > 0 ? ` · ${activeSelected.size.toLocaleString("en-US")}` : ""}`}
              </Button>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <div
                  className="flex flex-wrap items-center gap-1 rounded-xl bg-muted/50 px-2 py-1.5 ring-1 ring-foreground/10"
                  role="group"
                  aria-label="Extract from pool start"
                >
                  <span className="px-1 text-xs text-muted-foreground">First</span>
                  {LAUNCH_PRESETS.map((preset) => {
                    const active =
                      launchOrigin !== null &&
                      period?.startMs === launchOrigin &&
                      period.endMs === launchOrigin + preset.ms
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        disabled={trades.length === 0}
                        title={`Transactions from pool start through the first ${preset.label}`}
                        className={`rounded-md px-2 py-1 text-xs font-medium disabled:opacity-40 ${
                          active ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                        onClick={() => extractLaunchOffset(0, preset.ms)}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-muted/50 px-2.5 py-1.5 ring-1 ring-foreground/10">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Start
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Start hour from pool start"
                      value={launchFrom}
                      onChange={(event) => {
                        setLaunchFrom(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))
                        setPeriodError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") extractCustomLaunch()
                      }}
                      placeholder="2"
                      className="h-8 w-14 rounded-lg border border-input bg-background px-2 font-mono text-sm text-foreground"
                    />
                    h
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    End
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="End hour from pool start"
                      value={launchTo}
                      onChange={(event) => {
                        setLaunchTo(event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"))
                        setPeriodError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") extractCustomLaunch()
                      }}
                      placeholder="5"
                      className="h-8 w-14 rounded-lg border border-input bg-background px-2 font-mono text-sm text-foreground"
                    />
                    h
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={extractCustomLaunch}
                    disabled={trades.length === 0}
                    title="Keep transactions from the start hour through the end hour after pool start. 2 and 5 keeps hour 2 through hour 5."
                  >
                    Extract
                  </Button>
                </div>
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
                {activeSelected.size > 0 || showSelectedOnly ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm text-foreground hover:bg-accent"
                    onClick={() => {
                      changeSelection((draft) => draft.clear())
                      selectionAnchor.current = null
                      setShowSelectedOnly(false)
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
                  {launchLabel ? <span className="text-foreground">{launchLabel}. </span> : null}
                  Showing {filtered.length.toLocaleString("en-US")} transaction{filtered.length === 1 ? "" : "s"} from{" "}
                  <span className="font-mono text-foreground">{formatParts(dateToParts(new Date(period.startMs), zone))}</span>
                  {" — "}
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

          {tableView !== "minutes" && income ? (
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
            <div className={TABLE_SCROLL}>
              <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: tableMinWidth(daColCount) }}>
                <caption className="sr-only">
                  Deep Analysis ({intervalLabel}) for {pool.baseSymbol} / {pool.quoteSymbol}
                </caption>
                <thead className={TABLE_HEAD}>
                  <tr>
                    {showDa("no") ? <MinuteSortHeader label="No" column="no" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("startMs") ? <MinuteSortHeader label={`Start Time (${zoneName})`} column="startMs" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} /> : null}
                    {showDa("endMs") ? <MinuteSortHeader label={`End Time (${zoneName})`} column="endMs" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} /> : null}
                    {showDa("buyCount") ? <MinuteSortHeader label="Buy Count" column="buyCount" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("sellCount") ? <MinuteSortHeader label="Sell Count" column="sellCount" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("avgBuySpeedSec") ? <MinuteSortHeader label="Average Buy Speed" column="avgBuySpeedSec" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("avgSellSpeedSec") ? <MinuteSortHeader label="Average Sell Speed" column="avgSellSpeedSec" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("startQuoteReserve") ? <MinuteSortHeader label={`Start Pool ${pool.quoteSymbol}`} column="startQuoteReserve" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("endQuoteReserve") ? <MinuteSortHeader label={`End Pool ${pool.quoteSymbol}`} column="endQuoteReserve" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("startMarketCapUsd") ? <MinuteSortHeader label="Start M. Cap" column="startMarketCapUsd" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("endMarketCapUsd") ? <MinuteSortHeader label="End M. Cap" column="endMarketCapUsd" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("startPriceUsd") ? <MinuteSortHeader label="Start Price" column="startPriceUsd" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("endPriceUsd") ? <MinuteSortHeader label="End Price" column="endPriceUsd" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("startHolders") ? <MinuteSortHeader label="Start Holders" column="startHolders" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("endHolders") ? <MinuteSortHeader label="End Holders" column="endHolders" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                    {showDa("endGasPriceGwei") ? <MinuteSortHeader label="Gas Price" column="endGasPriceGwei" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" title="Effective gas price (gwei) on the last trade in the bucket — base fee + priority tip from the receipt, not the network gas-tracker average" /> : null}
                    {showDa("endGasFeeTotalEth") ? <MinuteSortHeader label="Gas Fee Total" column="endGasFeeTotalEth" sortKey={minuteSortKey} desc={minuteSortDesc} onSort={toggleMinuteSort} align="right" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {minutePageRows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(1, daColCount)} className="px-4 py-16 text-center text-muted-foreground">
                        {intervalTooFine ? "Interval too fine for this range." : "No Deep Analysis rows to show yet."}
                      </td>
                    </tr>
                  ) : (
                    minutePageRows.map((row) => (
                      <tr key={row.startMs} className="hover:bg-muted/40 [&>td]:border-t [&>td]:border-border/80">
                        {showDa("no") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                            {row.no.toLocaleString("en-US")}
                          </td>
                        ) : null}
                        {showDa("startMs") ? (
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatBucketLabel(row.start, intervalMs)}</td>
                        ) : null}
                        {showDa("endMs") ? (
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{formatBucketLabel(row.end, intervalMs)}</td>
                        ) : null}
                        {showDa("buyCount") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-emerald-400">
                            {row.buyCount.toLocaleString("en-US")}
                          </td>
                        ) : null}
                        {showDa("sellCount") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-rose-400">
                            {row.sellCount.toLocaleString("en-US")}
                          </td>
                        ) : null}
                        {showDa("avgBuySpeedSec") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                            title={formatSpeedTitle(row.avgBuySpeedSec, row.buyCount, "buy", row.avgBuyQuote)}
                          >
                            {formatSpeed(row.avgBuySpeedSec, row.buyCount, row.avgBuyQuote)}
                          </td>
                        ) : null}
                        {showDa("avgSellSpeedSec") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                            title={formatSpeedTitle(row.avgSellSpeedSec, row.sellCount, "sell", row.avgSellQuote)}
                          >
                            {formatSpeed(row.avgSellSpeedSec, row.sellCount, row.avgSellQuote)}
                          </td>
                        ) : null}
                        {showDa("startQuoteReserve") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs" title={row.startQuoteReserve ?? undefined}>
                            {row.startQuoteReserve ? formatPoolSize(row.startQuoteReserve) : "—"}
                          </td>
                        ) : null}
                        {showDa("endQuoteReserve") ? (
                          <td
                            className={`px-3 py-2 text-right font-mono text-xs ${changeTone(row.startQuoteReserve, row.endQuoteReserve)}`}
                            title={row.endQuoteReserve ?? undefined}
                          >
                            {row.endQuoteReserve ? (
                              <span className="inline-flex items-center justify-end gap-1.5">
                                {formatPoolSize(row.endQuoteReserve)}
                                <TradeSizeIcon
                                  usd={quoteAmountToUsd(
                                    quoteAbsDelta(row.startQuoteReserve, row.endQuoteReserve),
                                    quoteUsdPrice,
                                  )}
                                />
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        ) : null}
                        {showDa("startMarketCapUsd") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs">
                            {row.startMarketCapUsd ? formatUsdInteger(row.startMarketCapUsd) : "—"}
                          </td>
                        ) : null}
                        {showDa("endMarketCapUsd") ? (
                          <td className={`px-3 py-2 text-right font-mono text-xs ${changeTone(row.startMarketCapUsd, row.endMarketCapUsd)}`}>
                            {row.endMarketCapUsd ? formatUsdInteger(row.endMarketCapUsd) : "—"}
                          </td>
                        ) : null}
                        {showDa("startPriceUsd") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            {row.startPriceUsd ? <TinyAmount value={row.startPriceUsd} prefix="$" /> : "—"}
                          </td>
                        ) : null}
                        {showDa("endPriceUsd") ? (
                          <td className={`px-3 py-2 text-right font-mono text-sm ${changeTone(row.startPriceUsd, row.endPriceUsd)}`}>
                            {row.endPriceUsd ? <TinyAmount value={row.endPriceUsd} prefix="$" /> : "—"}
                          </td>
                        ) : null}
                        {showDa("startHolders") ? (
                          <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                            {row.startHolders !== null ? row.startHolders.toLocaleString("en-US") : holdersBusy ? "…" : "—"}
                          </td>
                        ) : null}
                        {showDa("endHolders") ? (
                          <td className={`px-3 py-2 text-right font-mono text-xs tabular-nums ${changeTone(row.startHolders, row.endHolders)}`}>
                            {row.endHolders !== null ? row.endHolders.toLocaleString("en-US") : holdersBusy ? "…" : "—"}
                          </td>
                        ) : null}
                        {showDa("endGasPriceGwei") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                            title={row.endGasPriceGwei ? `${displayGwei(row.endGasPriceGwei)} gwei at end of interval` : "Gas price unavailable"}
                          >
                            {displayGwei(row.endGasPriceGwei) ? `${displayGwei(row.endGasPriceGwei)} gwei` : "—"}
                          </td>
                        ) : null}
                        {showDa("endGasFeeTotalEth") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-xs tabular-nums"
                            title={
                              row.endGasFeeTotalEth
                                ? `${row.endGasFeeTotalEth} ETH cumulative gas through end of interval`
                                : "Gas fee total unavailable"
                            }
                          >
                            {row.endGasFeeTotalEth ? `${row.endGasFeeTotalEth} ETH` : "—"}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : (
          <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            <div className={TABLE_SCROLL}>
              <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: tableMinWidth(txColCount + 1) }}>
                <caption className="sr-only">
                  Swaps for {pool.baseSymbol} / {pool.quoteSymbol}
                </caption>
                <thead className={TABLE_HEAD}>
                  <tr>
                    <th className="w-10 bg-muted px-3 py-2" aria-sort={sortKey === "selected" ? (sortDesc ? "descending" : "ascending") : "none"}>
                      <div className="flex flex-col items-center gap-1">
                        <input
                          type="checkbox"
                          aria-label="Select all transactions on this page"
                          title={
                            allVisibleSelected
                              ? "Clear checkboxes on this page"
                              : "Check every transaction on this page"
                          }
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
                          className="inline-flex items-center text-muted-foreground hover:text-foreground"
                          aria-label="Sort by selected"
                          title="Sort by checked state"
                          onClick={() => toggleSort("selected")}
                        >
                          {sortKey === "selected" ? sortDesc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" />}
                        </button>
                      </div>
                    </th>
                    {showTx("txNo") ? <SortHeader label="No" column="txNo" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("timestamp") ? <SortHeader label={`Date (${zoneName})`} column="timestamp" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} /> : null}
                    {showTx("type") ? <SortHeader label="Type" column="type" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} /> : null}
                    {showTx("priceUsd") ? <SortHeader label="Price (USD)" column="priceUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("marketCapUsd") ? <SortHeader label="M. Cap" column="marketCapUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("totalUsd") ? <SortHeader label="Total" column="totalUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("priceQuote") ? <SortHeader label={`Price (${pool.quoteSymbol})`} column="priceQuote" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("baseAmount") ? <SortHeader label={pool.baseSymbol} column="baseAmount" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("quoteAmount") ? <SortHeader label={pool.quoteSymbol} column="quoteAmount" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("baseReserve") ? <SortHeader label={`Pool ${pool.baseSymbol}`} column="baseReserve" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("quoteReserve") ? <SortHeader label={`Pool ${pool.quoteSymbol}`} column="quoteReserve" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("holders") ? <SortHeader label="Holders" column="holders" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" /> : null}
                    {showTx("gasPriceGwei") ? <SortHeader label="Gas Price" column="gasPriceGwei" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" title="Effective gas price paid by this tx (gwei) = base fee + priority tip from the receipt. Bots often tip far above the Etherscan gas-tracker average." /> : null}
                    {showTx("gasUsd") ? <SortHeader label="Gas" column="gasUsd" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" title="This transaction’s fee in USD: gas used × effective gas price, times the ETH price. Same figure GMGN shows in its Gas column." /> : null}
                    {showTx("gasFeeTotalEth") ? <SortHeader label="Gas Fee Total" column="gasFeeTotalEth" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} align="right" title="Running sum of unique-tx gas costs (ETH) from the oldest loaded trade through this row" /> : null}
                    {showTx("maker") ? (
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
                    ) : null}
                    {showTx("fundedBy") ? <SortHeader label="Funded by" column="fundedBy" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} /> : null}
                    {showTx("others") ? <SortHeader label="Others" column="others" sortKey={sortKey} desc={sortDesc} onSort={toggleSort} /> : null}
                  </tr>
                </thead>
                <tbody>
                  {activeTape.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(1, txColCount + 1)} className="px-4 py-16 text-center text-muted-foreground">
                        {phase === "loading"
                          ? "Reading pool logs…"
                          : viewingBlacklist && blacklistIds.length === 0
                            ? "Blacklist is empty. On Transactions, click >> on a row."
                            : trades.length === 0
                              ? "No Uniswap-style transactions were found on this pool."
                              : "Nothing matches this filter."}
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((trade) => (
                      <tr
                        key={trade.id}
                        className={`hover:bg-muted/40 [&>td]:border-t [&>td]:border-border/80 ${activeSelected.has(trade.id) ? "bg-primary/10" : ""}`}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Select transaction No ${trade.txNo}`}
                            title="Click to toggle. Shift+click to select a range."
                            className="size-4 cursor-pointer accent-[var(--primary)]"
                            checked={activeSelected.has(trade.id)}
                            onChange={(event) => {
                              // Shift+click is handled in onClick (range select).
                              if (event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey) return
                              selectTrade(trade, false)
                            }}
                            onClick={(event) => {
                              if (!event.shiftKey) return
                              event.preventDefault()
                              selectTrade(trade, true)
                            }}
                          />
                        </td>
                        {showTx("txNo") ? (
                          <td
                            className="cursor-pointer px-3 py-2 text-right font-mono text-sm text-muted-foreground tabular-nums hover:text-foreground"
                            title="Transaction number (oldest = 1). Click to check/uncheck this row."
                            onClick={(event) => selectTrade(trade, event.shiftKey)}
                          >
                            {trade.txNo.toLocaleString("en-US")}
                          </td>
                        ) : null}
                        {showTx("timestamp") ? (
                          <td className="px-3 py-2 font-mono text-sm whitespace-nowrap">{formatTradeDate(trade.timestamp, zone)}</td>
                        ) : null}
                        {showTx("type") ? (
                          <td className="px-3 py-2">
                            <span className={`font-semibold ${TYPE_TONE[trade.type]}`}>
                              {trade.type}
                            </span>
                          </td>
                        ) : null}
                        {showTx("priceUsd") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            {trade.priceUsd ? <TinyAmount value={trade.priceUsd} prefix="$" /> : "—"}
                          </td>
                        ) : null}
                        {showTx("marketCapUsd") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm" title={trade.marketCapUsd ?? "Market cap unavailable"}>
                            {trade.marketCapUsd ? formatUsd(trade.marketCapUsd) : "—"}
                          </td>
                        ) : null}
                        {showTx("totalUsd") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            <span className="inline-flex items-center justify-end gap-1.5">
                              <UsdAmount amount={trade.totalUsd} />
                              <TradeSizeIcon usd={trade.totalUsd} />
                            </span>
                          </td>
                        ) : null}
                        {showTx("priceQuote") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            {trade.priceQuote ? <TinyAmount value={trade.priceQuote} /> : "—"}
                          </td>
                        ) : null}
                        {showTx("baseAmount") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm" title={formatGroupedAmount(trade.baseAmount)}>
                            {formatIntegerAmount(trade.baseAmount)}
                          </td>
                        ) : null}
                        {showTx("quoteAmount") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm">
                            <span className="inline-flex items-center justify-end gap-1">
                              {formatQuoteAmount(trade.quoteAmount)}
                              {trade.makerTags.includes("bot") ? (
                                <MevBotIcon drainEth={mevDrainById.get(trade.id)} className="size-3.5" />
                              ) : null}
                            </span>
                          </td>
                        ) : null}
                        {showTx("baseReserve") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm" title={trade.baseReserve ?? "Pool size unavailable"}>
                            {trade.baseReserve ? formatIntegerAmount(trade.baseReserve) : "—"}
                          </td>
                        ) : null}
                        {showTx("quoteReserve") ? (
                          <td className="px-3 py-2 text-right font-mono text-sm" title={trade.quoteReserve ?? "Pool size unavailable"}>
                            {trade.quoteReserve ? formatQuoteAmount(trade.quoteReserve) : "—"}
                          </td>
                        ) : null}
                        {showTx("holders") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-sm tabular-nums"
                            title={trade.holders !== null ? `${trade.holders.toLocaleString("en-US")} holders after this trade` : "Holder count unavailable"}
                          >
                            {trade.holders !== null ? trade.holders.toLocaleString("en-US") : holdersBusy ? "…" : "—"}
                          </td>
                        ) : null}
                        {showTx("gasPriceGwei") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-sm tabular-nums"
                            title={
                              displayGwei(trade.gasPriceGwei)
                                ? `${displayGwei(trade.gasPriceGwei)} gwei effective gas price (receipt base + priority). Not the network gas-tracker average.`
                                : "Gas price unavailable"
                            }
                          >
                            {displayGwei(trade.gasPriceGwei) ? `${displayGwei(trade.gasPriceGwei)} gwei` : "—"}
                          </td>
                        ) : null}
                        {showTx("gasUsd") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-sm tabular-nums"
                            title={
                              trade.gasFeeWei && /^\d+$/.test(trade.gasFeeWei)
                                ? `${ethFromWei(BigInt(trade.gasFeeWei))} ETH exact fee for this transaction (gas used × effective gas price).`
                                : "Gas fee unavailable until receipts are loaded"
                            }
                          >
                            {(() => {
                              const usd = pool ? rowGasUsd(trade, pool.quoteSymbol, ethUsd) : null
                              if (usd) return formatGasUsd(usd)
                              if (trade.gasFeeWei && pool?.chainId === "ether" && ethUsd == null) return "…"
                              return "—"
                            })()}
                          </td>
                        ) : null}
                        {showTx("gasFeeTotalEth") ? (
                          <td
                            className="px-3 py-2 text-right font-mono text-sm tabular-nums"
                            title={
                              trade.gasFeeTotalEth
                                ? `${trade.gasFeeTotalEth} ETH cumulative gas through this row (unique tx hashes only)`
                                : "Gas fee total unavailable"
                            }
                          >
                            {trade.gasFeeTotalEth ? `${trade.gasFeeTotalEth} ETH` : "—"}
                          </td>
                        ) : null}
                        {showTx("maker") ? (
                          <td className="px-3 py-2 whitespace-nowrap">
                            {trade.maker ? (
                              <>
                                <a
                                  className="font-mono text-sm hover:text-primary"
                                  href={`${pool.explorerAddress}/${trade.maker}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {shortAddress(trade.maker)}
                                </a>
                                {(labelsByMaker.get(normalizeAddress(trade.maker)) ?? []).map((labelName) => (
                                  <span
                                    key={labelName}
                                    className="ml-1.5 rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-300 uppercase"
                                  >
                                    {labelName}
                                  </span>
                                ))}
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
                        ) : null}
                        {showTx("fundedBy") ? (
                          <td className="px-3 py-2">
                            {trade.fundedBy && trade.fundedByAddress ? (
                              <a
                                className="text-sm font-medium text-rose-300 hover:text-rose-200"
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
                        ) : null}
                        {showTx("others") ? (
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              {trade.makerTags.includes("bot") ? (
                                <MevBotIcon drainEth={mevDrainById.get(trade.id)} className="size-4" />
                              ) : null}
                              {trade.makerTags.includes("team") ? (
                                <span
                                  className="text-amber-400"
                                  title="Team wallet: deployed this token or added the pool’s first liquidity."
                                >
                                  <Users className="size-4" aria-label="Team wallet" />
                                </span>
                              ) : null}
                              {viewingBlacklist ? (
                                <button
                                  type="button"
                                  className="text-rose-300 hover:text-rose-200"
                                  title="Remove this transaction from the blacklist"
                                  aria-label="Remove this transaction from the blacklist"
                                  onClick={() => removeTradeFromBlacklist(trade.id)}
                                >
                                  <Trash2 className="size-4" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="rounded px-1.5 py-0.5 font-mono text-xs font-semibold text-primary hover:bg-primary/15"
                                  title="Add this transaction to the blacklist"
                                  aria-label="Add this transaction to the blacklist"
                                  onClick={() => addTradeToBlacklist(trade.id)}
                                >
                                  &gt;&gt;
                                </button>
                              )}
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
                        ) : null}
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
              Showing {firstShown.toLocaleString("en-US")}—{lastShown.toLocaleString("en-US")} of{" "}
              {listLength.toLocaleString("en-US")}
              {tableView === "minutes"
                ? ` intervals (${intervalLabel})`
                : tableView === "blacklist"
                  ? " blacklist"
                  : ""}
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
        </section>
      ) : phase === "idle" || phase === "error" ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Step n="1" title="Paste the pair" body="Use the pair-explorer URL from DEXTools, including the chain and pool address." />
          <Step n="2" title="Read the tape" body="Buys, sells, adds and removes are decoded from the pool’s logs, with the wallet that sent each transaction and the pool size after it." />
          <Step n="3" title="Save the CSV" body="Date, type, USD price, total, both token amounts, pool size, holders, maker, who funded that wallet, and transaction hash." />
        </section>
      ) : null}

      <TeamLabelsDialog
        open={teamLabelsOpen}
        labels={teamLabels}
        onClose={() => setTeamLabelsOpen(false)}
        onChange={changeTeamLabels}
      />

      {pool ? (
        <IntervalChartDialog
          open={chartOpen}
          onClose={() => setChartOpen(false)}
          trades={minuteSource}
          zone={zone}
          initialIntervalMs={intervalMs}
          quoteSymbol={pool.quoteSymbol}
        />
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

/** V4: ledger pool balances + backfill INIT price / one-sided ADD totals. */
function polishTape(pool: PoolView, trades: Trade[]): Trade[] {
  const v4 = isPoolId(pool.address) || /uniswap\s*v4|(^|[^0-9])v4([^0-9]|$)/i.test(pool.dex)
  if (!v4) return trades
  return finalizeV4Tape(trades, pool.baseTotalSupply)
}

/** USD with enlarged zero-count for sub-$1 amounts that need compact notation. */
function UsdAmount({ amount }: { amount: string | null }) {
  if (!amount) return "—"
  const value = Number(amount)
  if (!Number.isFinite(value)) return "—"
  if (value === 0) return "$0"
  if (Math.abs(value) >= 1) return formatUsd(amount)
  return <TinyAmount value={value} prefix="$" />
}

function arrangeTape(
  rows: Trade[],
  picked: Set<string>,
  opts: {
    query: string
    filter: SideFilter
    funder: string
    period: PeriodFilter | null
    showSelectedOnly: boolean
    showMevOnly: boolean
    sortKey: SortKey
    sortDesc: boolean
    labelAddresses: Set<string> | null
    labelMode: LabelMode | null
  },
): Trade[] {
  const needle = opts.query.trim().toLowerCase()
  const matched = rows.filter((trade) => {
    if (opts.showSelectedOnly && !picked.has(trade.id)) return false
    if (opts.showMevOnly && !trade.makerTags.includes("bot")) return false
    if (opts.filter !== "ALL" && trade.type !== opts.filter) return false
    if (opts.funder === "__none__" && trade.fundedByAddress) return false
    if (opts.funder && opts.funder !== "__none__" && trade.fundedByAddress !== opts.funder) return false
    if (opts.labelAddresses && opts.labelMode && !makerInLabel(trade.maker, opts.labelAddresses, opts.labelMode)) return false
    if (opts.period) {
      const time = Date.parse(trade.timestamp)
      if (!Number.isFinite(time) || time < opts.period.startMs || time > opts.period.endMs) return false
    }
    if (!needle) return true
    return (
      trade.maker.includes(needle) ||
      trade.txHash.includes(needle) ||
      (trade.fundedBy ?? "").toLowerCase().includes(needle) ||
      (trade.fundedByAddress ?? "").includes(needle)
    )
  })
  const direction = opts.sortDesc ? -1 : 1
  return [...matched].sort((a, b) => {
    if (opts.sortKey === "selected") {
      const diff = Number(picked.has(a.id)) - Number(picked.has(b.id))
      return diff * direction || compareTrades(b, a, "timestamp")
    }
    if (opts.sortKey === "others") {
      return (tagWeight(a) - tagWeight(b)) * direction || compareTrades(b, a, "timestamp")
    }
    if (opts.sortKey === "makerTxCount") {
      const diff = a.makerTxCount - b.makerTxCount
      return diff * direction || a.maker.localeCompare(b.maker) || compareTrades(b, a, "timestamp")
    }
    const missingA = isMissing(a, opts.sortKey)
    const missingB = isMissing(b, opts.sortKey)
    if (missingA !== missingB) return missingA ? 1 : -1
    return compareTrades(a, b, opts.sortKey) * direction
  })
}

function tagWeight(trade: Trade): number {
  return (trade.makerTags.includes("bot") ? 2 : 0) + (trade.makerTags.includes("team") ? 1 : 0)
}

function isMissing(trade: Trade, key: SortKey): boolean {
  if (key === "selected" || key === "others" || key === "makerTxCount" || key === "txNo") return false
  if (key === "fundedBy") return !trade.fundedBy
  if (key === "holders") return trade.holders === null
  if (key === "gasPriceGwei") return trade.gasPriceGwei === null
  if (key === "gasUsd") return !trade.gasFeeWei
  if (key === "gasFeeTotalEth") return trade.gasFeeTotalEth === null
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
  if (key === "gasUsd") return compareDecimal(a.gasFeeWei ?? "0", b.gasFeeWei ?? "0")
  return compareDecimal(a[key] ?? "0", b[key] ?? "0")
}

function isMinuteMissing(row: MinuteRow, key: MinuteSortKey): boolean {
  if (key === "no" || key === "startMs" || key === "endMs" || key === "buyCount" || key === "sellCount") return false
  return row[key] === null
}

function compareMinuteRows(a: MinuteRow, b: MinuteRow, key: MinuteSortKey): number {
  if (key === "no" || key === "startMs" || key === "endMs" || key === "buyCount" || key === "sellCount") {
    return a[key] - b[key]
  }
  if (key === "avgBuySpeedSec" || key === "avgSellSpeedSec" || key === "startHolders" || key === "endHolders") {
    return (a[key] ?? -1) - (b[key] ?? -1)
  }
  return compareDecimal(a[key] ?? "0", b[key] ?? "0")
}

function SortHeader({
  label,
  column,
  sortKey,
  desc,
  onSort,
  align = "left",
  title,
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  desc: boolean
  onSort: (column: SortKey) => void
  align?: "left" | "right"
  title?: string
}) {
  const active = sortKey === column
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      title={title}
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

function MinuteSortHeader({
  label,
  column,
  sortKey,
  desc,
  onSort,
  align = "left",
  title,
}: {
  label: string
  column: MinuteSortKey
  sortKey: MinuteSortKey
  desc: boolean
  onSort: (column: MinuteSortKey) => void
  align?: "left" | "right"
  title?: string
}) {
  const active = sortKey === column
  return (
    <th
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
      aria-sort={active ? (desc ? "descending" : "ascending") : "none"}
      title={title}
    >
      <button
        type="button"
        className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
        onClick={() => onSort(column)}
      >
        {label}
        {active ? desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  )
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: "buy" | "sell"
  hint?: string
}) {
  const color = tone === "buy" ? "text-emerald-400" : tone === "sell" ? "text-rose-400" : "text-foreground"
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 font-mono text-xl ${color}`}>{value}</p>
      {hint ? (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-400">
          <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
          {hint}
        </p>
      ) : null}
    </div>
  )
}

/** Keep an existing local snapshot current after the live tail appends swaps. */
async function persistCaughtUpTape(
  pool: PoolView,
  trades: Trade[],
  api: { facts: WalletFacts; warning: string | null; capped: boolean },
) {
  try {
    const existing = await loadSavedAnalysis(analysisId(pool))
    if (!existing) return
    await saveAnalysis({
      url: existing.url,
      pool: {
        ...existing.pool,
        baseTotalSupply: pool.baseTotalSupply ?? existing.pool.baseTotalSupply,
      },
      trades,
      facts: api.facts,
      warning: existing.warning,
      capped: existing.capped,
    })
  } catch {
    return
  }
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

