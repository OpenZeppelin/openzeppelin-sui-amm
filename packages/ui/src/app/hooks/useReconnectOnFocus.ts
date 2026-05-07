"use client"

import {
  useConnectWallet,
  useCurrentWallet,
  useWallets
} from "@mysten/dapp-kit"
import { useEffect, useRef } from "react"

// Suppress repeated re-attempts when the tab flips visibility rapidly (focus
// stealing, alt-tab spam). 5s is plenty: idle-locks fire on the order of
// minutes, so a single retry per visibility regain is enough.
const RECONNECT_THROTTLE_MS = 5_000

/**
 * dapp-kit's `walletAutoConnect` only runs on first mount, so a wallet that
 * idle-locks (Slush / Sui Wallet auto-lock after ~10 min) leaves the dapp in a
 * "no current account" state until a manual reload. This hook listens for the
 * tab regaining visibility and re-attempts a silent connect to the same wallet
 * that was last successfully connected during this session.
 *
 * The retry is silent — `silent: true` tells the wallet to grant accounts
 * without a popup if it still trusts this origin. Wallets that don't honor
 * `silent` will surface a prompt, which is the same outcome the user would get
 * by clicking Connect again.
 */
export const useReconnectOnFocus = () => {
  const { currentWallet, isConnected } = useCurrentWallet()
  const wallets = useWallets()
  const { mutate: connectWallet } = useConnectWallet()
  const lastWalletNameRef = useRef<string | undefined>(undefined)
  const lastAttemptAtRef = useRef(0)

  // Remember the most-recent wallet that was actually connected, so we can
  // target the same one on retry. Tracked via a ref instead of dapp-kit's
  // localStorage stash to avoid coupling to internal storage keys.
  useEffect(() => {
    if (isConnected && currentWallet?.name) {
      lastWalletNameRef.current = currentWallet.name
    }
  }, [isConnected, currentWallet?.name])

  useEffect(() => {
    if (typeof document === "undefined") return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      if (isConnected) return
      const lastName = lastWalletNameRef.current
      if (!lastName) return
      const now = Date.now()
      if (now - lastAttemptAtRef.current < RECONNECT_THROTTLE_MS) return
      lastAttemptAtRef.current = now
      const target = wallets.find((wallet) => wallet.name === lastName)
      if (!target) return
      connectWallet({ wallet: target, silent: true })
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [connectWallet, isConnected, wallets])
}
