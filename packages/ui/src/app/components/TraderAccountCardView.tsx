"use client"

import type { ReactNode } from "react"
import type {
  TTraderAccountAssetBalancesContent,
  TTraderAccountCardContent,
  TTraderAccountCardViewModel
} from "../types/TTraderAccountCard"
import Button from "./Button"
import CopyableId from "./CopyableId"
import Loading from "./Loading"

const InfoTile = ({
  label,
  children,
  className
}: {
  label: string
  children: ReactNode
  className?: string
}) => {
  return (
    <div
      className={[
        "rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70",
        className
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
        {label}
      </div>
      <div className="mt-2 text-sm text-sds-dark dark:text-sds-light">
        {children}
      </div>
    </div>
  )
}

const assertUnreachable = (value: never): never => {
  throw new Error(
    `Unhandled trader account content state: ${JSON.stringify(value)}`
  )
}

const renderAssetBalances = (
  assetBalances: TTraderAccountAssetBalancesContent
) => {
  if (assetBalances.state === "loading") {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-200/70">
        Loading balances...
      </div>
    )
  }

  if (assetBalances.state === "error") {
    return (
      <div className="text-xs text-rose-600 dark:text-rose-200">
        {assetBalances.message}
      </div>
    )
  }

  if (assetBalances.balances.length === 0) {
    return (
      <div className="text-xs text-slate-500 dark:text-slate-200/70">
        No balances funded yet.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {assetBalances.balances.map((assetBalance) => (
        <div
          key={assetBalance.coinType}
          className="flex flex-col gap-1 rounded-lg border border-slate-200/70 bg-white/70 px-3 py-2 text-xs shadow-[0_10px_24px_-22px_rgba(15,23,42,0.45)] dark:border-slate-50/15 dark:bg-slate-950/50"
        >
          <div className="text-[0.65rem] uppercase tracking-[0.14em] text-slate-500 dark:text-slate-200/60">
            {assetBalance.coinType}
          </div>
          <div className="font-semibold text-sds-dark dark:text-sds-light">
            {assetBalance.balance}
          </div>
        </div>
      ))}
    </div>
  )
}

const renderContent = ({
  content,
  explorerUrl,
  onOpenFundModal
}: {
  content: TTraderAccountCardContent
  explorerUrl?: string
  onOpenFundModal?: () => void
}) => {
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
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <InfoTile label="Owner address">
              <CopyableId
                value={details.ownerAddress}
                label="Owner"
                showExplorer={false}
                className="w-full"
              />
            </InfoTile>
            <InfoTile label="Balance manager">
              <CopyableId
                value={details.balanceManagerId}
                label="Manager"
                explorerUrl={explorerUrl}
                className="w-full"
              />
            </InfoTile>
            <InfoTile label="Trade cap">
              {details.tradeCapId ? (
                <CopyableId
                  value={details.tradeCapId}
                  label="Trade"
                  explorerUrl={explorerUrl}
                  className="w-full"
                />
              ) : (
                "Unknown"
              )}
            </InfoTile>
            <InfoTile label="Deposit cap">
              {details.depositCapId ? (
                <CopyableId
                  value={details.depositCapId}
                  label="Deposit"
                  explorerUrl={explorerUrl}
                  className="w-full"
                />
              ) : (
                "Unknown"
              )}
            </InfoTile>
            <InfoTile label="Withdraw cap">
              {details.withdrawCapId ? (
                <CopyableId
                  value={details.withdrawCapId}
                  label="Withdraw"
                  explorerUrl={explorerUrl}
                  className="w-full"
                />
              ) : (
                "Unknown"
              )}
            </InfoTile>
            <InfoTile label="Active orders table">
              {details.activeOrdersTableId ? (
                <CopyableId
                  value={details.activeOrdersTableId}
                  label="Orders"
                  explorerUrl={explorerUrl}
                  className="w-full"
                />
              ) : (
                "Unknown"
              )}
            </InfoTile>
            {onOpenFundModal ? (
            <div className="flex">
              <Button
                variant="secondary"
                size="compact"
                onClick={onOpenFundModal}
              >
                Add fund
              </Button>
            </div>
          ) : null}
            <InfoTile label="Asset balances" className="md:col-span-2">
              {renderAssetBalances(details.assetBalances)}
            </InfoTile>
          </div>
        </div>
      )
    }
  }

  return assertUnreachable(content)
}

const TraderAccountCardView = ({
  title,
  description,
  explorerUrl,
  traderAccountId,
  content,
  headerAction,
  onOpenFundModal
}: TTraderAccountCardViewModel & {
  onOpenFundModal?: () => void
}) => {
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
          {headerAction ? (
            <div className="ml-auto">
              <Button
                variant="secondary"
                size="compact"
                disabled={headerAction.disabled}
                tooltip={headerAction.tooltip}
                onClick={headerAction.onClick}
              >
                {headerAction.label}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
            {traderAccountId ? (
              <CopyableId
                value={traderAccountId}
                label="Trader account"
                explorerUrl={explorerUrl}
              />
            ) : (
              <span className="text-slate-400 dark:text-slate-200/60">
                No trader account detected
              </span>
            )}
          </div>
          {renderContent({ content, explorerUrl, onOpenFundModal })}
        </div>
      </div>
    </section>
  )
}

export default TraderAccountCardView
