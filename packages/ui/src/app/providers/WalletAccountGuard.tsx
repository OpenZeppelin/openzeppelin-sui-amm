"use client"

import { useReconnectOnFocus } from "../hooks/useReconnectOnFocus"
import { useWalletAccountChangeDisconnect } from "../hooks/useWalletAccountChangeDisconnect"

const WalletAccountGuard = () => {
  useWalletAccountChangeDisconnect()
  useReconnectOnFocus()
  return <></>
}

export default WalletAccountGuard
