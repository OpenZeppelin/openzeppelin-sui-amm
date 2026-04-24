"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import Sidebar from "../components/layout/Sidebar"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

const REDIRECT_STATUSES = new Set([
  "not-found",
  "wallet-required",
  "missing-config"
])

export default function TerminalLayout({
  children
}: {
  children: ReactNode
}) {
  const router = useRouter()
  const { resolution } = useTraderAccountContext()

  useEffect(() => {
    if (REDIRECT_STATUSES.has(resolution.status)) {
      router.replace("/")
    }
  }, [resolution.status, router])

  if (resolution.status !== "ready") {
    return null
  }

  return (
    <div className="flex w-full max-w-7xl flex-row items-start gap-6 px-3 py-6">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  )
}
