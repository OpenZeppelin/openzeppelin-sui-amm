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
  const isLocalhost = isLocalhostHost(hostname)

  return {
    isLocalhost,
    allowNetworkSwitching: isLocalhost,
    defaultNetwork: isLocalhost ? ENetwork.LOCALNET : ENetwork.TESTNET
  }
}

export default useHostNetworkPolicy
