"use client"

import { ENetwork } from "@sui-amm/tooling-core/types"
import { useMemo } from "react"
import { isLocalhostHost } from "../helpers/host"

const resolveHostname = () => {
  if (typeof window === "undefined") return undefined
  return window.location.hostname
}

const useHostNetworkPolicy = () => {
  const hostname = useMemo(() => resolveHostname(), [])
  // `isLocalhostHost` recognizes loopback (`localhost`, `127.0.0.1`, `::1`),
  // but not LAN IPs that resolve to the same dev server (e.g. testing the UI
  // from a phone on the same Wi-Fi). Anchor "dev mode" on NODE_ENV instead so
  // the LAN-IP case picks up the localnet defaults too; the static export
  // build (`output: "export"`) flips NODE_ENV to "production", which keeps the
  // deployed dapp pinned to testnet as before.
  const isDevHost =
    isLocalhostHost(hostname) || process.env.NODE_ENV === "development"

  return {
    isLocalhost: isDevHost,
    allowNetworkSwitching: isDevHost,
    defaultNetwork: isDevHost ? ENetwork.LOCALNET : ENetwork.TESTNET
  }
}

export default useHostNetworkPolicy
