"use client"

import {
  formatCoinBalance,
  getStructLabel
} from "@sui-amm/tooling-core/utils/formatters"
import Button from "../../components/Button"
import {
  modalFieldDescriptionClassName,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "../../components/ModalPrimitives"
import {
  useFundingState,
  type CoinSide,
  type FundingMode
} from "../../hooks/useFundingState"

const SideRadio = ({
  value,
  currentValue,
  onChange,
  label,
  symbol,
  balanceDisplay
}: {
  value: CoinSide
  currentValue: CoinSide
  onChange: (next: CoinSide) => void
  label: string
  symbol?: string
  balanceDisplay?: string
}) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200/70 bg-white/70 p-3 transition hover:border-sds-blue/40 dark:border-slate-50/15 dark:bg-slate-950/40">
    <input
      type="radio"
      checked={currentValue === value}
      onChange={() => onChange(value)}
      className="mt-1 accent-sds-blue"
    />
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
        {label}
        {symbol ? (
          <span className="ml-2 normal-case tracking-normal text-slate-500 dark:text-slate-200/70">
            {symbol}
          </span>
        ) : undefined}
      </span>
      {balanceDisplay ? (
        <span className="font-mono text-[0.65rem] text-slate-500 dark:text-slate-200/70">
          Deposited: {balanceDisplay}
        </span>
      ) : undefined}
    </div>
  </label>
)

const FundingCard = ({
  mode,
  title,
  description,
  submitLabel
}: {
  mode: FundingMode
  title: string
  description: string
  submitLabel: string
}) => {
  const {
    formState,
    amountError,
    transactionState,
    canSubmit,
    handleInputChange,
    handleSubmit,
    traderAccount
  } = useFundingState(mode)

  const isProcessing = transactionState.status === "processing"

  const baseSymbol = traderAccount
    ? getStructLabel(traderAccount.baseCoinType)
    : undefined
  const quoteSymbol = traderAccount
    ? getStructLabel(traderAccount.quoteCoinType)
    : undefined
  const activeSymbol =
    formState.coinSide === "base" ? baseSymbol : quoteSymbol

  const baseBalanceDisplay = traderAccount
    ? `${formatCoinBalance({ balance: traderAccount.baseBalance, decimals: traderAccount.baseDecimals })} ${baseSymbol ?? ""}`.trim()
    : undefined
  const quoteBalanceDisplay = traderAccount
    ? `${formatCoinBalance({ balance: traderAccount.quoteBalance, decimals: traderAccount.quoteDecimals })} ${quoteSymbol ?? ""}`.trim()
    : undefined

  return (
    <section className="rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          {title}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          {description}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <div className={`${modalFieldTitleClassName} text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60`}>
            Coin side
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <SideRadio
              value="base"
              currentValue={formState.coinSide}
              onChange={(next) => handleInputChange("coinSide", next)}
              label="Base"
              symbol={baseSymbol}
              balanceDisplay={baseBalanceDisplay}
            />
            <SideRadio
              value="quote"
              currentValue={formState.coinSide}
              onChange={(next) => handleInputChange("coinSide", next)}
              label="Quote"
              symbol={quoteSymbol}
              balanceDisplay={quoteBalanceDisplay}
            />
          </div>
        </div>

        <label className={modalFieldLabelClassName}>
          <span className={modalFieldTitleClassName}>
            Amount{activeSymbol ? ` (${activeSymbol})` : ""}
          </span>
          <span className={modalFieldDescriptionClassName}>
            Decimal value. Converted to u64 atoms using the cached decimals
            from the executor&apos;s Market.
          </span>
          <input
            value={formState.amount}
            onChange={(event) => handleInputChange("amount", event.target.value)}
            disabled={isProcessing}
            className={modalFieldInputClassName}
            placeholder="0.5"
            inputMode="decimal"
          />
          {amountError ? (
            <span className={modalFieldErrorTextClassName}>{amountError}</span>
          ) : undefined}
        </label>

        {mode === "withdraw" ? (
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 px-3 py-2 text-[0.7rem] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Withdraw requires the executor to be paused. This call wraps
            pause → withdraw → unpause atomically when the executor is
            currently active.
          </div>
        ) : undefined}

        {transactionState.status === "error" ? (
          <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 px-3 py-2 text-[0.7rem] text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <div className="font-semibold">Transaction failed</div>
            <div className="mt-1">{transactionState.error}</div>
            {transactionState.details ? (
              <details className="mt-2">
                <summary className="cursor-pointer font-semibold">
                  Raw error JSON
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded border border-rose-200/60 bg-white/80 p-2 text-[0.6rem] dark:border-rose-500/30 dark:bg-slate-950/60">
                  {transactionState.details}
                </pre>
              </details>
            ) : undefined}
          </div>
        ) : undefined}

        {transactionState.status === "success" ? (
          <div className="rounded-xl border border-emerald-300/70 bg-emerald-50/70 px-3 py-2 text-[0.7rem] text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
            <div className="font-semibold">Submitted</div>
            <div className="mt-1 font-mono">digest: {transactionState.digest}</div>
          </div>
        ) : undefined}

        <div className="flex justify-end">
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isProcessing ? "Processing..." : submitLabel}
          </Button>
        </div>
      </div>
    </section>
  )
}

export default function FundingPage() {
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-sds-dark dark:text-sds-light">
          Funding
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-200/70">
          Deposit and withdraw balances for the executor&apos;s BalanceManager.
          All calls are gated by your AdminCap.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <FundingCard
          mode="deposit"
          title="Deposit"
          description="Add base or quote assets to the executor's BalanceManager. SUI deposits split from your gas coin; other coins split from the richest owned Coin<T>."
          submitLabel="Deposit"
        />
        <FundingCard
          mode="withdraw"
          title="Withdraw"
          description="Pull funds back to your wallet. The PTB pauses, withdraws, and unpauses atomically if the executor is active."
          submitLabel="Withdraw"
        />
      </div>
    </>
  )
}
