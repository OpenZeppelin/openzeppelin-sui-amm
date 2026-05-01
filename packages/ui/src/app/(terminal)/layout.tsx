"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import Sidebar from "../components/layout/Sidebar"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

// Only `not-found` is a stable "go to setup" signal. `wallet-required` and
// `missing-config` both fire transiently during hydration (wallet adapter
// reconnect, deployment-artifact fetch), so redirecting on them bounces the
// user off a deep-linked terminal page on every refresh.
const REDIRECT_STATUSES = new Set(["not-found"])

export default function TerminalLayout({ children }: { children: ReactNode }) {
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
    // `w-[80rem] max-w-full` pins the terminal wrapper to a fixed 1280 px on
    // wide viewports (still shrinking responsively below that) regardless of
    // the page's intrinsic content width. Without this, `w-full` resolved
    // against `<main>`'s auto width — and a narrower page (Configuration)
    // produced a narrower wrapper, shrinking the right column and shifting
    // the Sidebar.
    <div className="flex w-[80rem] max-w-full flex-row items-start gap-6 px-3 py-6">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  )
}
