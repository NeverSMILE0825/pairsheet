# Pair Sheet

Paste a [DEXTools](https://www.dextools.io) pair-explorer link and download every buy, sell, liquidity add and remove on that pool as CSV, with the pool size after each transaction and the wallet that funded each maker.

Example:

`https://www.dextools.io/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737`

The app reads `Swap`, `Mint` (liquidity added) and `Burn` (liquidity removed) events from the pool contract (Uniswap v2 and v3 style), resolves the wallet that sent each transaction, and prices the quote token with historical data from DefiLlama. Amounts in the file are the on-chain values. USD figures follow the quote token’s price at the time of the swap, so they can differ slightly from the number shown on DEXTools.

## CSV columns

`tx_no`, `date_utc`, `date_local`, `timezone`, `type` (`BUY`, `SELL`, `ADD` or `REMOVE`), `price_usd`, `total_usd`, `price_in_quote`, `base_symbol`, `base_amount`, `quote_symbol`, `quote_amount`, `pool_base_after`, `pool_quote_after`, `maker`, `maker_tx_count`, `maker_tags`, `tx_to`, `funded_by`, `funded_by_address`, `tx_hash`, `block_number`, `log_index`, `chain`, `pool_address`

`tx_no` is the chronological index of that trade among the loaded history (oldest = 1). It stays with the row when you sort or filter the table, and the same value is written to the CSV.

`funded_by` is the public name of the address that first sent native currency to the maker, the same “Funded by” field Etherscan shows. A known label such as Disperse.app is used when one exists. Otherwise the column shows the contract name, ENS name, or a shortened address. The table has the same Funded by column, and the dropdown above it filters the tape and the CSV to one funder.

Swaps load first, then the page looks up funders in small batches, so a slow or rate-limited explorer never fails the whole load. Wallets the explorer could not answer are retried a few times, and Download CSV unlocks when the lookup finishes.

`date_utc` is always UTC (ISO 8601). `date_local` is the same moment in the time zone picked in the app (`timezone` column). The table shows times in your browser's local time zone by default; pick another one from the **Time zone** menu above the table and the choice is remembered in the browser. `ADD` and `REMOVE` are liquidity events: the two amounts are the tokens deposited or withdrawn, and `total_usd` is the quote-token side. Burns that move nothing (V3 fee pokes) are skipped. `BUY` means the pool sent the base token out (the trader bought it). The side is taken from the base token GeckoTerminal shows for the pool, usually the non-wrapped asset.

## Run locally

```bash
npm install
npm run dev
```

The dev server in this environment is started on port **41731**:

```bash
npm run dev -- --port 41731
```

Open [http://127.0.0.1:41731](http://127.0.0.1:41731).

```bash
npm test
npm run lint
```

## Supported chains

Full history is available where a public log index exists:

Ethereum, Polygon, Base, Arbitrum, Optimism, Avalanche, Blast, zkSync, Celo, Unichain, World Chain, Metis, and Chiliz.

BNB Chain, Linea, Scroll, Gnosis, and Mantle are recognized in DEXTools URLs, but this app does not have a public full-history index for them yet. Solana and other non-EVM DEXTools chains are not exported.

Exports stop at 50,000 transactions and say so when a pool is larger. Explorer APIs that only return 10,000 logs per query are walked in block windows so larger EVM pools still load past that ceiling.

**Solana:** DEXTools Solana pair links are supported. Swaps are reconstructed from pool token-balance changes on each pool transaction (works across PumpSwap, Raydium, and similar AMMs). Funded-by / bot-tag lookups are EVM-only for now. Public Solana RPCs are rate-limited, so very busy pools load in pages and may take longer.

**Uniswap V4:** DEXTools V4 links use a 32-byte pool id (not a pair contract). Pair Sheet reads `Swap` events from the Uniswap V4 PoolManager filtered by that pool id. Liquidity add/remove and per-swap pool-size columns are not available for V4 yet (swaps, makers, funding, and CSV export are). Native ETH quote sides are priced via the chain’s wrapped native token.

## How a link is read

`https://www.dextools.io/app/{chain}/pair-explorer/{pool}`

A locale segment is fine: `/app/en/ether/pair-explorer/0x…`.

## Calculate Income

Tick the checkbox on any rows (or the header box to tick everything currently shown), then press **Calculate Income**. Only buys and sells are counted (add/remove rows are listed as skipped). The panel shows the exact sum of the quote token (WETH on this pool) across the selected transactions, split into bought and sold, plus net (sold minus bought) and the USD value at trade time. Selections survive filter changes; changing the selection clears the old result so it never shows a stale number.

**Faster selection:** click one row, then **Shift+click** another to select every row between them in the current table order. Or enter **From No** / **To No** (chronological transaction numbers) and press **Select**.

## Extract by time

Use **Start time** and **End time** above the table (year, month, day, hour, minute, second in the chosen time zone), then press **Extract**. The table and Download CSV show only trades in that inclusive range. **Clear period** removes the time filter.

## Pool size after each swap

Every row shows how much of each token the pool held right after that transaction (the "Pool FWOG" and "Pool WETH" columns, and `pool_base_after` / `pool_quote_after` in the CSV). The cells are rounded; hover for the exact value.

- Uniswap V2 style pools emit a `Sync(reserve0, reserve1)` event immediately before every `Swap`, `Mint` and `Burn`, so the value is the exact reserve after that trade.
- Uniswap V3 style pools emit no reserves, so the value is the pool's token balances at the end of the swap's block (read with archive `eth_call`s). Several swaps in one block share the same value.
- If a chain's public RPCs cannot serve the data, the cell shows a dash and the CSV cell is empty. Swap data is unaffected.

## Maker transaction count and Bot / Team icons

- The number next to each maker is how many transactions (swaps and liquidity events) that wallet made in this pool, counted from the rows loaded. Click it to show only that wallet. In the CSV it is `maker_tx_count`.
- The **Others** column shows icons, also written to `maker_tags` in the CSV (`bot`, `team`, or `bot;team`):
  - Bot / Smart contract: the transaction was sent straight to the pool, or through a contract whose source code is not published on the explorer. Public DEX routers are verified, private MEV and sniper contracts almost never are. `tx_to` in the CSV is the contract that received the transaction.
  - Team wallet: the wallet that deployed the base token, or the wallet that added the pool's first liquidity.
- These tags are heuristics built from public explorer data. DEXTools uses its own labelling, so a few wallets can be tagged differently. The most frequent 120 contracts are checked per export; less common ones are left untagged.
