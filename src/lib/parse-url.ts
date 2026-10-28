import { getChain, type ChainConfig } from "./chains"

export const EXAMPLE_URL =
  "https://www.dextools.io/app/ether/pair-explorer/0x961bde5165b921561e6e97fee8c2dfbdaf49c737"

// EVM: 20-byte pair or 32-byte Uniswap V4 pool id. Solana: base58 pool address.
const PAIR_URL =
  /^https?:\/\/(?:www\.)?dextools\.io\/app\/(?:[a-z]{2}\/)?([a-z0-9]+)\/pair-explorer\/(0x[a-fA-F0-9]{40}|0x[a-fA-F0-9]{64}|[1-9A-HJ-NP-Za-km-z]{32,44})\/?(?:[?#].*)?$/i

export type ParsedPairUrl = {
  chain: ChainConfig
  address: string
  url: string
}

export function parseDextoolsUrl(input: string): ParsedPairUrl {
  const trimmed = input.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.replace(/^\/\//, "")
  const candidate = /^https?:\/\//i.test(withProtocol)
    ? withProtocol
    : `https://${withProtocol}`

  const match = PAIR_URL.exec(candidate)
  if (!match) {
    throw new Error(
      "Paste a DEXTools pair-explorer link, like https://www.dextools.io/app/ether/pair-explorer/0x… or a Solana pool link.",
    )
  }

  const chainId = match[1].toLowerCase()
  const rawAddress = match[2]
  const chain = getChain(chainId)
  if (!chain) {
    throw new Error(
      `DEXTools chain “${chainId}” is not supported. Use an EVM pair (Ethereum, Base, …) or Solana.`,
    )
  }

  const address = chain.id === "solana" ? rawAddress : rawAddress.toLowerCase()

  return {
    chain,
    address,
    url: `https://www.dextools.io/app/${chain.id}/pair-explorer/${address}`,
  }
}
