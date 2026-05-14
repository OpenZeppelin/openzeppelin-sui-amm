"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import Sidebar from "../components/layout/Sidebar"
import { useReconnectOnFocus } from "../hooks/useReconnectOnFocus"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"

// Only `not-found` is a stable "go to setup" signal. `wallet-required` and
// `missing-config` both fire transiently during hydration (wallet adapter
// reconnect, deployment-artifact fetch), so redirecting on them bounces the
// user off a deep-linked terminal page on every refresh.
const REDIRECT_STATUSES = new Set(["not-found"])

const StatusCard = ({
  title,
  body,
  ctaHref,
  ctaLabel
}: {
  title: string
  body: ReactNode
  ctaHref?: string
  ctaLabel?: string
}) => (
  <div className="mx-auto mt-12 w-full max-w-lg rounded-2xl border border-slate-200/70 bg-white/90 p-6 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
    <h2 className="text-lg font-semibold text-sds-dark dark:text-sds-light">
      {title}
    </h2>
    <div className="mt-2 text-sm text-slate-600 dark:text-slate-200/80">
      {body}
    </div>
    {ctaHref && ctaLabel ? (
      <Link
        href={ctaHref}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-sds-blue underline-offset-4 hover:underline dark:text-sds-blue"
      >
        {ctaLabel}
      </Link>
    ) : null}
  </div>
)

export default function TerminalLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { resolution } = useTraderAccountContext()

  // Scoped to the terminal routes only: the setup page handles the first wallet
  // connect and shouldn't have a background visibility-change reconnect racing
  // with the user's initial click.
  useReconnectOnFocus()

  useEffect(() => {
    if (REDIRECT_STATUSES.has(resolution.status)) {
      router.replace("/")
    }
  }, [resolution.status, router])

  // Transient resolution states (initial hydration, in-flight RPC) intentionally
  // render nothing so the page doesn't flash a misleading message. Settled
  // non-ready states fall through to inline CTAs below — blanking the page on
  // those leaves deep-linked terminal routes with no recovery path.
  if (resolution.status === "idle" || resolution.status === "loading") {
    return null
  }

  // Settled non-ready, non-redirect states: render an inline CTA. These can
  // briefly appear during hydration; in practice the flash is short and
  // strictly better than a permanently blank screen for the persistent case.
  if (resolution.status !== "ready") {
    let card: ReactNode
    if (resolution.status === "wallet-required") {
      card = (
        <StatusCard
          title="Connect a wallet"
          body="The terminal pages read live state from the connected wallet's executor. Use the wallet button in the header to connect."
        />
      )
    } else if (resolution.status === "missing-config") {
      card = (
        <StatusCard
          title="No AMM deployment configured"
          body={
            <>
              The current network has no <code>openzeppelin_market_maker</code>{" "}
              package recorded. Switch network or, on localnet, run{" "}
              <code>
                pnpm --filter dapp move:publish --package-path prop-amm
              </code>{" "}
              and reload.
            </>
          }
          ctaHref="/"
          ctaLabel="Back to setup"
        />
      )
    } else if (resolution.status === "error") {
      card = (
        <StatusCard
          title="Couldn't load executor"
          body={
            <>
              {resolution.error ?? "Unknown error resolving the executor."}{" "}
              Reload the page to retry.
            </>
          }
          ctaHref="/"
          ctaLabel="Back to setup"
        />
      )
    } else {
      // `not-found` — the redirect effect above sends us to "/", just don't
      // flash anything in the meantime.
      card = null
    }

    return (
      <div className="flex w-[80rem] max-w-full flex-row items-start gap-6 px-3 py-6">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col gap-6">{card}</div>
      </div>
    )
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
