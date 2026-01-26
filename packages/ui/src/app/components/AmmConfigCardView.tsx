"use client"

import type { ReactNode } from "react"
import type {
  TAmmConfigCardContent,
  TAmmConfigCardViewModel
} from "../types/TAmmConfigCard"
import CopyableId from "./CopyableId"
import Loading from "./Loading"

const ConfigTile = ({
  label,
  children
}: {
  label: string
  children: ReactNode
}) => {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
        {label}
      </div>
      <div className="mt-2 text-sm text-sds-dark dark:text-sds-light">
        {children}
      </div>
    </div>
  )
}

const renderContent = (content: TAmmConfigCardContent) => {
  switch (content.state) {
    case "loading":
      return <Loading />
    case "missing-id":
    case "error":
      return (
        <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
          {content.message}
        </div>
      )
    case "ready": {
      const { details } = content
      return (
        <div className="grid gap-4 md:grid-cols-2">
          <ConfigTile label="Base spread (bps)">
            <span className="text-lg font-semibold text-sds-dark dark:text-sds-light">
              {details.baseSpreadBps}
            </span>
          </ConfigTile>
          <ConfigTile label="Volatility multiplier (bps)">
            <span className="text-lg font-semibold text-sds-dark dark:text-sds-light">
              {details.volatilityMultiplierBps}
            </span>
          </ConfigTile>
          <ConfigTile label="Laser">
            <span className={details.laserBadge.className}>
              {details.laserBadge.label}
            </span>
          </ConfigTile>
          <ConfigTile label="Trading status">
            <span className={details.tradingBadge.className}>
              {details.tradingBadge.label}
            </span>
          </ConfigTile>
          <div className="md:col-span-2">
            <ConfigTile label="Pyth price feed id">
              {details.pythPriceFeedIdHex ? (
                <CopyableId
                  value={details.pythPriceFeedIdHex}
                  label="Feed"
                  showExplorer={false}
                  className="w-full"
                />
              ) : (
                "Unknown"
              )}
            </ConfigTile>
          </div>
        </div>
      )
    }
    default:
      return (
        <div className="rounded-xl border border-dashed border-slate-300/60 p-4 text-sm text-slate-500 dark:border-slate-100/20 dark:text-slate-200/70">
          No AMM config loaded yet.
        </div>
      )
  }
}

const AmmConfigCardView = ({
  title,
  description,
  networkLabel,
  explorerUrl,
  ammConfigId,
  content
}: TAmmConfigCardViewModel) => {
  return (
    <section className="w-full max-w-4xl px-4">
      <div className="rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md transition dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              {title}
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              {description}
            </p>
          </div>
          <div className="ml-auto flex items-center">
            <span className="bg-sds-blue/15 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-sds-dark dark:text-sds-light">
              {networkLabel}
            </span>
          </div>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
            {ammConfigId ? (
              <CopyableId
                value={ammConfigId}
                label="AMM config"
                explorerUrl={explorerUrl}
              />
            ) : (
              <span className="text-rose-500">Missing AMM config ID</span>
            )}
          </div>
          {renderContent(content)}
        </div>
      </div>
    </section>
  )
}

export default AmmConfigCardView
