/**
 * In-app Help copy. Update this file whenever a user-facing feature changes so
 * the Help dialog always matches the live product (see .cursor/rules/help-content.mdc).
 */
export const HELP_UPDATED_AT = "2026-11-02"

export type HelpExample = {
  title: string
  body: string
}

export type HelpSection = {
  id: string
  title: string
  summary: string
  bullets: string[]
  examples?: HelpExample[]
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "start",
    title: "Load a pair",
    summary: "Paste a DEXTools pair-explorer URL and read the full on-chain tape.",
    bullets: [
      "Supported: Ethereum and major EVM L2s, plus Solana pools that DEXTools indexes.",
      "Pair Sheet walks Swap / Mint / Burn (and Uniswap V4 equivalents) from the pool contract.",
      "Busy pools past ~10k events keep loading: explorer getLogs caps each window at 10k, so Pair Sheet advances fromBlock and continues until the tape is complete (progress shows “Still reading the chain…”).",
      "Under the URL: checkboxes (off by default) include Gas, Holders, or Funded by on the next Load swaps. Each row also has a Load button to fetch that data after the tape is ready.",
      "Clicking Load asks for confirmation, then fills that column on the current tape. You can Save as soon as swaps finish — even if optional columns are still empty.",
    ],
    examples: [
      {
        title: "Example URL",
        body: "https://www.dextools.io/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737",
      },
      {
        title: "Pools with 10k+ trades",
        body: "A pair like GTA6/ETH with ~14k DEXTools trades used to stop near 10,002 (10k swaps + init/add). Load swaps now walks past that ceiling automatically — wait until progress stops saying “Still reading the chain…”.",
      },
      {
        title: "Load holders later",
        body: "Load swaps with all options unchecked, Save if you want, then click Load next to Holders, confirm the dialog, and wait for the column to fill.",
      },
    ],
  },
  {
    id: "transactions",
    title: "Transactions table",
    summary: "One row per buy, sell, add, remove, or init — oldest is No. 1.",
    bullets: [
      "Price (USD) / Total use DefiLlama historical quote prices × the quote-token amount (or, for one-sided Uniswap V4 adds, base × the pool’s init price). Small USD differences vs DEXTools come from their ETH/USD feed, not from token amounts.",
      "Very small prices show as 0.0₈123 — the yellow bold subscript digit is how many zeros sit after the decimal (slightly larger than plain Unicode subscripts so it stays readable).",
      "M. Cap is unit price × token supply when supply is known.",
      "Add / Remove in the header counts only ADD and REMOVE rows — Init is separate (same as DEXTools’ INIT vs ADD).",
      "Uniswap V4: Init is the Initialize event (price from sqrtPriceX96, amounts 0). Add/Remove token amounts use liquidity math (ticks + sqrtPrice) so a one-sided add shows 0 quote — matching DEXTools — instead of counting bundled swap transfers in the same tx.",
      "Quote column (WETH/ETH) always shows 4 decimals (0.5 → 0.5000); zero stays 0. Pool quote uses the same formatting.",
      "MEV / bot: Detect MEV bots (left of Columns) filters to DEXTools-style front-running. A red robot sits after the quote (ETH/WETH) amount when the same maker buys and sells in the same second — or with the same token amount within 30 seconds. Tooltip shows drained ETH (|buy quote − sell quote|). Ordinary round-trips minutes apart are not marked.",
      "Pool columns are actual token balances after that event (V2 Sync, V3 balances, V4 running ADD/BUY/SELL ledger). V4 never shows virtual L/√P reserves — those looked like ~1 ETH on GINNAN even when no ETH was added.",
      "Holders = unique wallets with a non-zero base-token balance right after that row (pool + burn addresses excluded). Only filled when “Look up Holders” is checked.",
      "Gas Price = effective gas price in gwei (3 decimals) from the receipt. Gas Fee Total = running ETH spend of unique txs through this row (4 decimals). Only filled when “Look up Gas Price / Gas Fee Total” is checked.",
      "Etherscan’s gas tracker shows the network base-fee average. Individual swaps — especially MEV / sniper bots — often tip far higher, so Gas Price can be 1 gwei or 28 gwei in the same minute.",
      "When gas lookup is on, Pair Sheet retries missing receipts after load and, for older saves, can recalculate gas and ask whether to save the update.",
      "Maker shows the wallet; the number is how many of this pool’s loaded txs that wallet made. Team icons mark the token deployer / first-LP wallet; the red robot marks front-running MEV legs.",
      "Funded by is the address that first sent native currency into the maker (only filled when “Look up Funded by” is checked on load).",
    ],
    examples: [
      {
        title: "Reading Gas Fee Total",
        body: "If row No. 1 cost 0.0010 ETH gas and row No. 2 cost 0.0005 ETH, Gas Fee Total on row 2 shows 0.0015 ETH. Two events in the same txHash only add once.",
      },
      {
        title: "V4 Init + first Add",
        body: "GINNAN/ETH pool creation emits Init (price ≈ $0.0₅2320, amounts 0) and Add (1,000,000,000 GINNAN, 0 ETH, Total ≈ $2,320) in the same second. Add / Remove shows 1 / 0 — Init is not an Add.",
      },
      {
        title: "V4 Pool ETH after the first buy",
        body: "After a one-sided Add of only GINNAN, Pool ETH is 0. The first buy of 0.0464 ETH makes Pool ETH ≈ 0.0464 — not ~1.05 from virtual liquidity math.",
      },
      {
        title: "High Gas Price vs gas tracker",
        body: "On Oct 26 16:12:59 EDT a GINNAN sell paid 28.562 gwei effective while the block base fee was ~0.046 gwei — the sender set a 28.562 gwei priority tip. Pair Sheet shows the receipt value; the gas tracker only plots base-fee averages.",
      },
      {
        title: "Holders after a buy",
        body: "A new wallet buys the base token from the pool → Holders increases by 1. The pool itself is not counted as a holder.",
      },
      {
        title: "MEV front-running (DEXTools-style)",
        body: "Same second: wallet 0xea2… buys 0.2786 ETH then sells 0.2803 ETH → both legs get the red robot after ETH, drained ≈ 0.0017. A buy and sell of the same token amount five minutes apart (e.g. GTA6 rows 8 and 16) is not front-running.",
      },
    ],
  },
  {
    id: "intervals",
    title: "Deep Analysis & chart",
    summary: "Group the tape into time buckets (12s → 1 day) for counts, pool, holders, and gas.",
    bullets: [
      "Table view → Deep Analysis: Buy/Sell counts and average speeds per bucket, shown as 20s (0.031) — seconds between trades and mean quote size (3 decimals) from the same amounts as the Transactions table.",
      "Start / End pool quote, mcap, price, and holders show how the bucket opened and closed.",
      "Gas Price / Gas Fee Total are the effective gwei and cumulative ETH spend at the end of each bucket.",
      "Chart Y-axis includes Gas Price and Gas Fee Total, plus Buy+Sell, pool, mcap, price, and holders.",
    ],
    examples: [
      {
        title: "12-second buckets",
        body: "Set interval to 12 seconds to match a fast DEXTools tape. Empty buckets between the first and last trade stay in the list so gaps are visible.",
      },
      {
        title: "Average Buy Speed 20s (0.031)",
        body: "In a 1-minute bucket with 3 buys of 0.02, 0.03, and 0.043 quote, speed is 60/3 = 20s and mean quote is 0.031 (3 decimals). Those quote sizes are the same values shown in the Transactions table.",
      },
    ],
  },
  {
    id: "filters",
    title: "Filters, columns, timezone",
    summary: "Focus the tape and shrink horizontal scroll.",
    bullets: [
      "Type chips (All / Buys / Sells / Adds / Removes / Init) and Funded by filter the view.",
      "Search matches maker, funder, or tx hash.",
      "Columns opens a checklist for Transactions or Deep Analysis — hide unused fields to reduce sideways scrolling. Choices are remembered on this browser.",
      "Timezone changes how dates render in the table; CSV always includes UTC and local.",
      "Row checkboxes toggle selection (Shift+click a range). The header checkbox checks or clears only the current page. Click a No cell to toggle that row too.",
      "Show selected filters the table to checked rows only; Show all (or Clear selection) restores the full list.",
    ],
    examples: [
      {
        title: "Fewer columns",
        body: "Open Columns → uncheck Pool base, Pool quote, and Others if you only need price, total, gas, and maker. Click Show all to restore.",
      },
      {
        title: "Review a few ticks",
        body: "Check several rows → Show selected → Calculate Income on just those. Clear selection when you are done.",
      },
    ],
  },
  {
    id: "save-sync",
    title: "Save, Open, Export, sync",
    summary: "Keep full snapshots on this browser; share the pair list across PCs via GitHub.",
    bullets: [
      "Save analysis stores the full tape (trades, facts, holders) in this browser’s IndexedDB.",
      "Open lists local snapshots plus the shared GitHub bookmark list. Shared rows reload from chain if this PC has no snapshot.",
      "Export / Import a JSON vault to move full snapshots between browsers without GitHub.",
      "Enable sync with a fine-grained GitHub PAT (Contents: Read and Write on NeverSMILE0825/pairsheet). Publish now writes public/data/bookmarks.json.",
      "Each publish creates a Git commit only when the shared list actually changed. Messages name the change (e.g. Add GINNAN/ETH…, Remove…, Update… trades). Identical Publish now / Save syncs do not spam empty commits.",
      "Other PCs only need to open the site and click Open to see the shared list — no token required to read.",
    ],
    examples: [
      {
        title: "Cross-PC flow",
        body: "PC A: Save analysis → Enable sync → Publish now (badge shows Synced · N pair(s)). PC B: open pairsheet → Open → shared list → Open a pair to reload from chain.",
      },
      {
        title: "Commit names",
        body: "Saving GINNAN again after a new load commits “Update GINNAN/ETH (4,476 trades) on shared bookmarks”. Pressing Publish when nothing changed leaves git history alone.",
      },
    ],
  },
  {
    id: "market",
    title: "Live ETH & gas",
    summary: "Header widgets show spot ETH/USD and Ethereum gas estimates.",
    bullets: [
      "ETH price comes from Coinbase (fallback CoinGecko). Click for 24h / 1h detail.",
      "Gas Standard / Fast / Rapid are estimated from recent feeHistory (base fee + tip).",
      "These live widgets are independent of each row’s Gas Price column (which uses that tx’s receipt).",
    ],
  },
  {
    id: "report",
    title: "Generate Report",
    summary: "Plain-English buy/sell behaviour: volumes, pauses, and how pace changed over time.",
    bullets: [
      "After the tape loads, Generate Report opens a modal with counts, quote totals, USD, median clip size, largest clips, and pace for first 15m → 1h → 6h → 12h → 24h → 48h → full tape.",
      "Pauses lists the longest quiet stretches between consecutive buys/sells — when each started (offset from launch + UTC) and how long it lasted.",
      "How buy / sell speed changed uses non-overlapping rings (launch→15m, 15m→1h, …) with buys/h, sells/h, median waits, and whether each ring sped up or slowed vs the prior one.",
      "Windows are cumulative from the first event timestamp. Figures round to 2 decimals. Uses the full loaded tape (filters do not change the report).",
    ],
    examples: [
      {
        title: "First 15 minutes",
        body: "A launch with 50 buys / 7 sells and ~9.92 ETH bought vs ~2.88 ETH sold reads as an early buy rush; later windows show when quote volume balances and when large sell outliers appear.",
      },
      {
        title: "Pause + speed",
        body: "If swaps go quiet for 2 hours after a buy at +1h 40m from launch, Pauses shows that gap. The 1h→6h ring then reports fewer buys/h than launch→15m (“slowed to ~0.2×”).",
      },
    ],
  },
  {
    id: "csv",
    title: "CSV export",
    summary: "Download every filtered row, not only the current page.",
    bullets: [
      "Includes tx number, UTC + local time, type, prices, amounts, pool sizes, holders, maker tags, funder, gas_price_gwei, gas_fee_eth, gas_fee_total_eth, and tx hash.",
      "Use filters first if you only want buys, or a single maker.",
    ],
  },
]

export function helpSectionById(id: string): HelpSection | undefined {
  return HELP_SECTIONS.find((section) => section.id === id)
}
