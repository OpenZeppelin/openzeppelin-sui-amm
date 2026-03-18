import type { IdentifierString } from "@mysten/wallet-standard"
import { walletSupportsChain } from "./localnet"

export type WalletNetworkPreflight = {
  expectedChain: IdentifierString
  accountChains: string[]
  chainMismatch: boolean
  localnetSupported: boolean
}

export const resolveWalletNetworkPreflight = ({
  network,
  accountChainsInput,
  walletChainSupport
}: {
  network: string
  accountChainsInput?: readonly string[] | null
  walletChainSupport: Parameters<typeof walletSupportsChain>[0]
}): WalletNetworkPreflight => {
  const expectedChain = `sui:${network}` as IdentifierString
  const accountChains = accountChainsInput ? [...accountChainsInput] : []
  const chainMismatch =
    accountChains.length > 0 && !accountChains.includes(expectedChain)
  const localnetSupported = walletSupportsChain(walletChainSupport, expectedChain)

  return {
    expectedChain,
    accountChains,
    chainMismatch,
    localnetSupported
  }
}

export const buildWalletPreflightContext = ({
  appNetwork,
  expectedChain,
  walletName,
  walletVersion,
  accountAddress,
  accountChains,
  chainMismatch,
  localnetSupported
}: {
  appNetwork: string
  expectedChain: IdentifierString
  walletName?: string
  walletVersion?: string
  accountAddress?: string
  accountChains: string[]
  chainMismatch: boolean
  localnetSupported: boolean
}) => ({
  appNetwork,
  expectedChain,
  walletName,
  walletVersion,
  accountAddress,
  accountChains,
  chainMismatch,
  localnetSupported
})
