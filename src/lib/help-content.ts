/**
 * In-app Help copy. Update this file whenever a user-facing feature changes so
 * the Help dialog always matches the live product (see .cursor/rules/help-content.mdc).
 */
export const HELP_UPDATED_AT = "2026-11-09"

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
      "Uniswap V4 is loaded from the pool id in the link. If a price index has not listed that pool yet, Pair Sheet reads the PoolManager Initialize event for the two tokens and still loads the tape. A regular pair whose index is missing falls back to the pool contract, then DexScreener.",
      "Busy pools keep loading past the first pages. The explorer errors around 2,000 logs, and sometimes on a wide block range, so Pair Sheet continues from the newest block already read and retries a smaller range until the tape is complete (progress shows “Still reading the chain…”).",
      "Under the URL: checkboxes (off by default) include Gas, Holders, or Funded by on the next Load swaps. Each row also has a Load button to fetch that data after the tape is ready.",
      "Clicking Load asks for confirmation, then fills that column on the current tape. You can Save as soon as swaps finish — even if optional columns are still empty.",
      "Update, beside Load swaps, appends swaps newer than the open tape. Open a saved pair, then click Update to pull the latest rows without reading the whole history again.",
      "Live, beside Load swaps, turns real-time updates on or off. On: Pair Sheet checks the chain about every 12 seconds and appends new swaps. Off: the tape stays still until you press Update. This browser remembers the choice. The Transactions card shows Live, or Updating… while a check is running. If this browser already saved the pair, the longer tape is written back locally.",
    ],
    examples: [
      {
        title: "Example URL",
        body: "https://www.dextools.io/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737",
      },
      {
        title: "New Uniswap V4 pool",
        body: "A V4 link whose pool id is not on GeckoTerminal yet still loads. Pair Sheet reads that pool’s Initialize log, names the two tokens, then walks swaps on the PoolManager. You do not wait for the price index to list it.",
      },
      {
        title: "Saved tape on an active pair",
        body: "GTA6 saved at 14,045 txs while DEXTools now shows 16.31K. Open the snapshot and click Update, or leave Live on so the count climbs on its own. The local save is updated. Load swaps is only needed for a first-time read or a full reload.",
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
      "M. Cap is unit price × the base token’s total supply (Gecko normalized_total_supply / on-chain totalSupply). Pool FDV ÷ price is only a last-resort fallback — Gecko’s pool FDV is often wrong on Uniswap V4 and would inflate Max/Min (e.g. GROKLET Max ~$12M instead of ~$508K).",
      "Pooled ETH (or the quote token) estimates market cap at another pool size. It uses the latest row as the anchor: that row’s pooled amount shows that row’s M. Cap, and a different amount scales with the square. Double the pooled ETH and the estimate is 4× the latest M. Cap.",
      "Add / Remove in the header counts only ADD and REMOVE rows — Init is separate (same as DEXTools’ INIT vs ADD).",
      "Uniswap V4: Init is the Initialize event (price from sqrtPriceX96, amounts 0). Add/Remove token amounts use liquidity math (ticks + sqrtPrice) so a one-sided add shows 0 quote — matching DEXTools — instead of counting bundled swap transfers in the same tx.",
      "Quote column (WETH/ETH) always shows 4 decimals (0.5 → 0.5000); zero stays 0. Pool quote uses the same formatting.",
      "MEV / bot: Detect MEV bots (left of Columns) filters to DEXTools-style front-running. A red robot sits after the quote (ETH/WETH) amount when the same maker buys and sells in the same second — or with the same token amount within 30 seconds. Tooltip shows drained ETH (|buy quote − sell quote|). Ordinary round-trips minutes apart are not marked.",
      "Pool columns are actual token balances after that event (V2 Sync, V3 balances, V4 running ADD/BUY/SELL ledger). V4 never shows virtual L/√P reserves — those looked like ~1 ETH on GINNAN even when no ETH was added.",
      "Holders = unique wallets with a non-zero base-token balance right after that row (pair contract, Uniswap V4 PoolManager, and burn addresses excluded). Only filled when “Look up Holders” is checked. Counts jump between consecutive swaps when many wallets are drained or transferred in the blocks between those rows — that is on-chain state, not a chart bug.",
      "Gas Price = effective gas price in gwei (3 decimals) from the receipt. Gas, between Gas Price and Gas Fee Total, is that transaction’s fee in USD (gas used × effective gas price × ETH price) — the same figure GMGN shows. Gas Fee Total = running ETH spend of unique txs through this row (4 decimals). Only filled when “Look up Gas Price / Gas Fee Total” is checked.",
      "Total Gas, on the table-view bar, adds every loaded transaction once and shows the pair’s spend in USD and ETH. Two pool events in one transaction count as one fee.",
      "Etherscan’s gas tracker shows the network base-fee average. Individual swaps — especially MEV / sniper bots — often tip far higher, so Gas Price can be 1 gwei or 28 gwei in the same minute.",
      "When gas lookup is on, Pair Sheet retries missing receipts after load and, for older saves, can recalculate gas and ask whether to save the update.",
      "Maker shows the wallet; the number is how many of this pool’s loaded txs that wallet made. Team icons mark the token deployer / first-LP wallet; the red robot marks front-running MEV legs.",
      "Funded by is the address that first sent native currency into the maker — the earliest successful normal transfer or internal transfer, including ETH attached when a contract was created. A later top-up is not used. Opening a saved pair asks before refreshing Funded by or gas. Keep saved data leaves the tape as stored. Update shows that tape immediately and replaces each row as its new value arrives, then stores it. Load Funded by still runs the check on demand.",
      "Others includes >>. Click >> on a row to copy that transaction into the Blacklist tab (same columns). No checkbox is required. The list is kept on this browser for that pair.",
      "Blacklist sits next to Deep Analysis. Each row has a trash icon that removes that row immediately, with no checkbox. Empty blacklist clears the table immediately.",
      "Calculate Income uses the checked rows of the table you are viewing — the full tape, or only the blacklist.",
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
        title: "Gas column vs GMGN",
        body: "A swap that used 189,000 gas at 0.045 gwei paid 0.000008505 ETH. At $2,117 per ETH the Gas column shows $0.018. Total Gas adds each transaction once, so the pair’s whole tape is one number in USD and ETH.",
      },
      {
        title: "High Gas Price vs gas tracker",
        body: "On Oct 26 16:12:59 EDT a GINNAN sell paid 28.562 gwei effective while the block base fee was ~0.046 gwei — the sender set a 28.562 gwei priority tip. Pair Sheet shows the receipt value; the gas tracker only plots base-fee averages.",
      },
      {
        title: "Funded by on a busy wallet",
        body: "A maker can have 100k swaps and still show Unknown if its first ETH arrived as an internal transfer years ago. Opening that saved pair asks first. Keep saved data shows the stored tape. Update leaves that tape on screen and fills each wallet as its funder arrives. The next open does not repeat wallets that already have no ETH credit.",
      },
      {
        title: "Blacklist then income",
        body: "Click >> on each team sell (no need to check the row first), open Blacklist, check those rows, and Calculate Income. That total is only the blacklist. The trash icon drops one row. Empty blacklist clears every saved row at once.",
      },
      {
        title: "Holders after a buy",
        body: "A new wallet buys the base token from the pool → Holders increases by 1. The pair / V4 PoolManager is not counted as a holder.",
      },
      {
        title: "Holders cliff between two swaps",
        body: "GROKLET No. 2613 → 2614: Holders can fall from ~400 to ~5 in one row because ERC-20 Transfers between those blocks wiped most wallets. DEXTools’ end state (~4 holders) matches the late rows; Pair Sheet only samples holder count at swap times.",
      },
      {
        title: "M. Cap at another pooled ETH",
        body: "The latest row has 4.2 ETH in the pool and M. Cap $200,000. Type 8.4. Estimated M. Cap is $800,000 (4×). Type 4.2 again and it matches the latest row.",
      },
      {
        title: "M. Cap vs DEXTools",
        body: "GROKLET price × 1B supply → Max M. Cap ≈ $508K. Using Gecko pool FDV÷price (~25B “supply”) wrongly pushed Max near $12.58M; Pair Sheet prefers the token’s real total supply.",
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
      "The first bucket starts at the pool Init time for every interval (12s, 1min, 1h, 1d, or custom). Each following row begins one interval later. A tape with no Init row starts at the earliest trade.",
      "Start / End pool quote, mcap, price, and holders show how the bucket opened and closed.",
      "Gas Price / Gas Fee Total are the effective gwei and cumulative ETH spend at the end of each bucket.",
      "Chart Y-axis includes Gas Price and Gas Fee Total, plus Buy+Sell, pool, mcap, price, and holders.",
    ],
    examples: [
      {
        title: "12-second buckets",
        body: "Init at 20:23:41 and interval 1h: the first row is 20:23:41–21:23:41, then 21:23:41–22:23:41. It does not snap back to 20:00. The same anchor is used for 12s, 1min, and 1d. Empty buckets between the first and last trade stay in the list.",
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
      "The table scrolls inside its own frame, vertically and horizontally, the same way. Column headers stay pinned. Page controls stay under the frame.",
      "Timezone defaults to US Eastern (America/New_York — EST/EDT). Changing it updates table dates; CSV always includes UTC and local.",
      "Row checkboxes toggle selection (Shift+click a range). The header checkbox checks or clears only the current page. Click a No cell to toggle that row too.",
      "Show selected filters the table to checked rows only; Show all (or Clear selection) restores the full list.",
      "First 5min, 15min, 1h, 2h, 3h, 6h, 12h, and 24h keep only rows from the pool Init through that much time. A tape with no Init uses the earliest trade. Custom Start and End are hours from that same instant: 2 and 5 keeps rows from 2 hours after the start through 5 hours after the start. Clear period restores the full tape. Start time / End time still pick an exact clock range.",
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
      {
        title: "First hours after launch",
        body: "Click 1h to keep rows from Init through one hour later. Start 2 and End 5, then Extract, keeps rows from 2 hours after Init through 5 hours after Init — not the 2nd through 5th clock hour of the day.",
      },
    ],
  },
  {
    id: "save-sync",
    title: "Save, Open, Export, sync",
    summary: "Keep full snapshots on this browser; share the pair list across PCs via GitHub.",
    bullets: [
      "Save analysis stores the full tape (trades, facts, holders) in this browser’s IndexedDB. There is no 10-pair (or any) count limit on bookmarks or the shared list.",
      "If this browser runs out of storage, Pair Sheet drops older full tapes first (starred last) but keeps every bookmark row. Open still lists them; missing tapes reload from chain.",
      "Open lists local snapshots plus the shared GitHub bookmark list. Shared rows reload from chain if this PC has no snapshot.",
      "Opening a saved tape rechecks the base token’s total supply. If stored market caps were built from a bad supply (Gecko pool FDV), Pair Sheet recomputes every M. Cap and writes the corrected snapshot back on this browser.",
      "Delete (trash) asks for confirmation, then removes that pair from this browser. Reopening Saved pairs does not bring it back, including a row that only existed on the shared list. With sync on, the shared list drops it too. Without sync, other PCs still show it until you enable sync and publish.",
      "Export / Import a JSON vault to move full snapshots between browsers without GitHub.",
      "Enable sync with a fine-grained GitHub PAT (Contents: Read and Write on NeverSMILE0825/pairsheet). Publish now writes public/data/bookmarks.json.",
      "Each publish creates a Git commit only when the shared list actually changed. Messages name the change (e.g. Add GINNAN/ETH…, Remove…, Update… trades). Identical Publish now / Save syncs do not spam empty commits.",
      "Other PCs only need to open the site and click Open to see the shared list — no token required to read.",
    ],
    examples: [
      {
        title: "Saved GROKLET market caps",
        body: "A snapshot saved while supply came from pool FDV shows Max near $12.58M. Open that pair after updating Pair Sheet: M. Cap is rewritten as price × 1B supply (Max ≈ $508K) and the corrected tape is stored again.",
      },
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
      "All report timestamps are US Eastern (EST/EDT). Copy in the dialog header puts the full plain-text report on the clipboard.",
      "Pauses lists the longest quiet stretches between consecutive buys/sells — when each started (offset from launch + Eastern time) and how long it lasted.",
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
