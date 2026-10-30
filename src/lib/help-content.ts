/**
 * In-app Help copy. Update this file whenever a user-facing feature changes so
 * the Help dialog always matches the live product (see .cursor/rules/help-content.mdc).
 */
export const HELP_UPDATED_AT = "2026-10-30"

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
      "Under the URL, optional checkboxes (all off by default): Gas Price / Gas Fee Total, Holders, and Funded by. Unchecked steps are skipped so loads stay fast.",
      "You can Save analysis as soon as the swap tape finishes — even while optional lookups are still running or left empty.",
    ],
    examples: [
      {
        title: "Example URL",
        body: "https://www.dextools.io/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737",
      },
      {
        title: "Fast save",
        body: "Leave Gas, Holders, and Funded by unchecked, load the pair, then Save as soon as transactions appear. Check only the columns you need for that snapshot.",
      },
    ],
  },
  {
    id: "transactions",
    title: "Transactions table",
    summary: "One row per buy, sell, add, remove, or init — oldest is No. 1.",
    bullets: [
      "Price (USD) / Total use DefiLlama historical quote prices × the quote-token amount.",
      "M. Cap is unit price × token supply when supply is known.",
      "Pool columns are the pool balances right after that event (hover for the exact value).",
      "Holders = unique wallets with a non-zero base-token balance right after that row (pool + burn addresses excluded). Only filled when “Look up Holders” is checked.",
      "Gas Price = effective gas price in gwei (3 decimals) from the receipt. Gas Fee Total = running ETH spend of unique txs through this row (4 decimals). Only filled when “Look up Gas Price / Gas Fee Total” is checked.",
      "Etherscan’s gas tracker shows the network base-fee average. Individual swaps — especially MEV / sniper bots — often tip far higher, so Gas Price can be 1 gwei or 28 gwei in the same minute.",
      "When gas lookup is on, Pair Sheet retries missing receipts after load and, for older saves, can recalculate gas and ask whether to save the update.",
      "Maker shows the wallet; the number is how many of this pool’s loaded txs that wallet made. Bot / Team icons mark contract routers and deployer / first-LP wallets.",
      "Funded by is the address that first sent native currency into the maker (only filled when “Look up Funded by” is checked on load).",
    ],
    examples: [
      {
        title: "Reading Gas Fee Total",
        body: "If row No. 1 cost 0.0010 ETH gas and row No. 2 cost 0.0005 ETH, Gas Fee Total on row 2 shows 0.0015 ETH. Two events in the same txHash only add once.",
      },
      {
        title: "High Gas Price vs gas tracker",
        body: "On Oct 26 16:12:59 EDT a GINNAN sell paid 28.562 gwei effective while the block base fee was ~0.046 gwei — the sender set a 28.562 gwei priority tip. Pair Sheet shows the receipt value; the gas tracker only plots base-fee averages.",
      },
      {
        title: "Holders after a buy",
        body: "A new wallet buys the base token from the pool → Holders increases by 1. The pool itself is not counted as a holder.",
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
      "Checkboxes + Shift-click select a range for CSV download of the selection.",
    ],
    examples: [
      {
        title: "Fewer columns",
        body: "Open Columns → uncheck Pool base, Pool quote, and Others if you only need price, total, gas, and maker. Click Show all to restore.",
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
      "Other PCs only need to open the site and click Open to see the shared list — no token required to read.",
    ],
    examples: [
      {
        title: "Cross-PC flow",
        body: "PC A: Save analysis → Enable sync → Publish now (badge shows Synced · N pair(s)). PC B: open pairsheet → Open → shared list → Open a pair to reload from chain.",
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
