"use client"

import {
  formatCoinBalance,
  getStructLabel
} from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import Loading from "../../components/Loading"
import TradeHistoryCard from "../../components/TradeHistoryCard"
import { useExecutorEventLog } from "../../hooks/useExecutorEventLog"
import useResolvedPackageId from "../../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../../providers/TraderAccountProvider"

// DeepBook prices are scaled by 1e9: rawPrice = quote_atoms * 1e9 / base_atoms.
const PRICE_SCALE = 1_000_000_000n

const findLatestMidRawPrice = (
  events: ReturnType<typeof useExecutorEventLog>
): bigint | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== "QuoteUpdated") continue
    const raw = (event.data as { price?: unknown }).price
    if (typeof raw !== "string" && typeof raw !== "number") continue
    try {
      return BigInt(String(raw))
    } catch {
      continue
    }
  }
  return undefined
}

const baseAtomsToQuote = (atoms: bigint, midRawPrice: bigint): bigint =>
  (atoms * midRawPrice) / PRICE_SCALE

const formatSignedAtoms = (atoms: bigint, decimals: number) => {
  const sign = atoms > 0n ? "+" : atoms < 0n ? "-" : ""
  const magnitude = atoms < 0n ? -atoms : atoms
  return (
    sign +
    formatCoinBalance({
      balance: magnitude.toString(),
      decimals
    })
  )
}

const toneOf = (value: bigint): "positive" | "negative" | "neutral" =>
  value > 0n ? "positive" : value < 0n ? "negative" : "neutral"

const Tile = ({
  label,
  value,
  hint,
  tone
}: {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "positive" | "negative"
}) => {
  const valueColor =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-200"
      : tone === "negative"
        ? "text-rose-700 dark:text-rose-200"
        : "text-sds-dark dark:text-sds-light"

  return (
    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_28px_-24px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/70">
        {label}
      </div>
      <div className={`mt-2 font-mono text-xl font-semibold ${valueColor}`}>
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
          {hint}
        </div>
      ) : undefined}
    </div>
  )
}

const SideSection = ({
  label,
  symbol,
  decimals,
  current,
  deposited,
  withdrawn
}: {
  label: string
  symbol: string
  decimals: number
  current: string
  deposited: string
  withdrawn: string
}) => {
  const currentBn = BigInt(current)
  const depositedBn = BigInt(deposited)
  const withdrawnBn = BigInt(withdrawn)
  const netDeposited = depositedBn - withdrawnBn
  const tradingPnl = currentBn - netDeposited
  const tradingPnlAbs = tradingPnl < 0n ? -tradingPnl : tradingPnl
  const pnlSign = tradingPnl > 0n ? "+" : tradingPnl < 0n ? "-" : ""
  const tradingPnlDisplay =
    pnlSign +
    formatCoinBalance({
      balance: tradingPnlAbs.toString(),
      decimals
    })

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
        {label}{" "}
        <span className="text-slate-500 dark:text-slate-200/70">
          ({symbol})
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          label="Current balance"
          value={formatCoinBalance({ balance: current, decimals })}
          hint="In BalanceManager"
        />
        <Tile
          label="Trading PnL"
          value={tradingPnlDisplay}
          hint="current − (deposited − withdrawn)"
          tone={
            tradingPnl > 0n
              ? "positive"
              : tradingPnl < 0n
                ? "negative"
                : "neutral"
          }
        />
      </div>
    </section>
  )
}

const TotalSection = ({
  symbol,
  decimals,
  currentAtoms,
  pnlAtoms,
  midAvailable
}: {
  symbol: string
  decimals: number
  currentAtoms: bigint | undefined
  pnlAtoms: bigint | undefined
  midAvailable: boolean
}) => {
  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
        Total{" "}
        <span className="text-slate-500 dark:text-slate-200/70">
          ({symbol})
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          label="Current balance"
          value={
            currentAtoms !== undefined
              ? formatCoinBalance({
                  balance: currentAtoms.toString(),
                  decimals
                })
              : "—"
          }
          hint={
            midAvailable
              ? "Quote balance + base × latest mid"
              : "Awaiting QuoteUpdated for mid price"
          }
        />
        <Tile
          label="Trading PnL"
          value={
            pnlAtoms !== undefined ? formatSignedAtoms(pnlAtoms, decimals) : "—"
          }
          hint={
            midAvailable
              ? "Sum of per-side PnL valued at latest mid"
              : "Awaiting QuoteUpdated for mid price"
          }
          tone={pnlAtoms !== undefined ? toneOf(pnlAtoms) : "neutral"}
        />
      </div>
    </section>
  )
}

export default function PerformancePage() {
  const { overview, resolution } = useTraderAccountContext()
  const traderAccount = overview.traderAccount
  const packageId = useResolvedPackageId()
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 200
  })
  const midRawPrice = useMemo(() => findLatestMidRawPrice(events), [events])

  if (overview.status === "idle" || overview.status === "loading") {
    return <Loading />
  }

  if (overview.status === "error" || !traderAccount) {
    return (
      <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-4 text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10">
        {overview.error ?? "Unable to load performance data."}
      </div>
    )
  }

  const baseSymbol = getStructLabel(traderAccount.baseCoinType)
  const quoteSymbol = getStructLabel(traderAccount.quoteCoinType)

  const baseBalanceBn = BigInt(traderAccount.baseBalance)
  const quoteBalanceBn = BigInt(traderAccount.quoteBalance)
  const baseNetDepositBn =
    BigInt(traderAccount.baseDeposited) - BigInt(traderAccount.baseWithdrawn)
  const quoteNetDepositBn =
    BigInt(traderAccount.quoteDeposited) - BigInt(traderAccount.quoteWithdrawn)
  const basePnlBn = baseBalanceBn - baseNetDepositBn
  const quotePnlBn = quoteBalanceBn - quoteNetDepositBn

  const totalCurrentAtoms =
    midRawPrice !== undefined
      ? quoteBalanceBn + baseAtomsToQuote(baseBalanceBn, midRawPrice)
      : undefined
  const totalPnlAtoms =
    midRawPrice !== undefined
      ? quotePnlBn + baseAtomsToQuote(basePnlBn, midRawPrice)
      : undefined

  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
          Performance
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-200/70">
          Per-side accounting from the on-chain{" "}
          <code className="font-mono">Info</code> struct. Trading PnL = current
          balance minus net deposited; positive means the executor earned more
          than was deposited net of withdrawals.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="border-sds-blue/30 bg-sds-blue/5 dark:border-sds-blue/30 dark:bg-sds-blue/10 rounded-2xl border p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)]">
          <div className="text-[0.6rem] uppercase tracking-[0.18em] text-sds-blue">
            Base volume traded
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-sds-dark dark:text-sds-light">
            {formatCoinBalance({
              balance: traderAccount.volumeBase,
              decimals: traderAccount.baseDecimals
            })}{" "}
            <span className="text-base font-medium text-slate-500 dark:text-slate-200/70">
              {baseSymbol}
            </span>
          </div>
          <div className="mt-1 text-[0.65rem] text-slate-500 dark:text-slate-200/60">
            Cumulative within current DeepBook epoch (resets per epoch).
          </div>
        </section>
        <TotalSection
          symbol={quoteSymbol}
          decimals={traderAccount.quoteDecimals}
          currentAtoms={totalCurrentAtoms}
          pnlAtoms={totalPnlAtoms}
          midAvailable={midRawPrice !== undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SideSection
          label="Base"
          symbol={baseSymbol}
          decimals={traderAccount.baseDecimals}
          current={traderAccount.baseBalance}
          deposited={traderAccount.baseDeposited}
          withdrawn={traderAccount.baseWithdrawn}
        />
        <SideSection
          label="Quote"
          symbol={quoteSymbol}
          decimals={traderAccount.quoteDecimals}
          current={traderAccount.quoteBalance}
          deposited={traderAccount.quoteDeposited}
          withdrawn={traderAccount.quoteWithdrawn}
        />
      </div>

      <TradeHistoryCard />
    </>
  )
}
