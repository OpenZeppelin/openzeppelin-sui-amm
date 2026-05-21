"use client"

import "@mysten/dapp-kit/dist/index.css"
import "@radix-ui/themes/styles.css"
import "@suiware/kit/main.css"
import { SuiClientProvider, WalletProvider } from "@mysten/dapp-kit"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { ThemeProvider as NextThemeProvider } from "next-themes"
import { Suspense, useMemo, useState, type ReactNode } from "react"
import useNetworkConfig from "~~/hooks/useNetworkConfig"
import { APP_NAME } from "../config/main"
import { getThemeSettings } from "../helpers/theme"
import useHostNetworkPolicy from "../hooks/useHostNetworkPolicy"
import NetworkUrlSync from "./NetworkUrlSync"
import ThemeProvider from "./ThemeProvider"
import WalletAccountGuard from "./WalletAccountGuard"

const themeSettings = getThemeSettings()

// Slush wallet uses `metadata.walletName === "Slush"` regardless of the `name`
// passed to `registerSlushWallet`, so this is a stable identifier.
const SLUSH_WALLET_NAME = "Slush"

// Default dapp-kit persistence key for last-connected wallet info.
const DAPP_KIT_STORAGE_KEY = "sui-dapp-kit:wallet-connection-info"

// One shared QueryClient for the whole app, mirroring the previous SuiProvider
// behavior (which instantiated a QueryClient at module-load time).
const queryClient = new QueryClient()

// Slush only supports mainnet/testnet. If a Slush session is stashed in
// localStorage from a previous mainnet/testnet visit, dapp-kit's autoConnect
// will try to resume it on localnet and hang in `connecting`, leaving the
// ConnectButton unclickable. Clear the stale stash before WalletProvider
// initializes so autoConnect short-circuits, while keeping Slush in the
// wallet picker for any manual connect attempt.
const clearStaleSlushStashIfLocalnet = (network: string) => {
  if (typeof window === "undefined") return
  if (network !== ENetwork.LOCALNET) return
  try {
    const raw = window.localStorage.getItem(DAPP_KIT_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      state?: { lastConnectedWalletName?: unknown }
    }
    if (parsed.state?.lastConnectedWalletName === SLUSH_WALLET_NAME) {
      window.localStorage.removeItem(DAPP_KIT_STORAGE_KEY)
    }
  } catch {
    // Stash unreadable / not JSON; nothing to clean up.
  }
}

export default function ClientProviders({ children }: { children: ReactNode }) {
  const { networkConfig } = useNetworkConfig()
  const { defaultNetwork } = useHostNetworkPolicy()

  // Run the localStorage cleanup synchronously during the first render so it
  // executes before WalletProvider's `useRef`-bound store reads the stash. A
  // `useEffect` would fire AFTER children mount, by which point autoConnect
  // has already started.
  useState(() => {
    clearStaleSlushStashIfLocalnet(defaultNetwork)
    return true
  })

  const slushWallet = useMemo(() => ({ name: APP_NAME }), [])

  return (
    <NextThemeProvider attribute="class">
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SuiClientProvider
            networks={networkConfig}
            defaultNetwork={defaultNetwork as never}
          >
            <WalletProvider
              autoConnect
              slushWallet={slushWallet}
              theme={themeSettings}
            >
              <Suspense fallback={null}>
                <NetworkUrlSync />
              </Suspense>
              <WalletAccountGuard />
              {children}
            </WalletProvider>
          </SuiClientProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </NextThemeProvider>
  )
}
