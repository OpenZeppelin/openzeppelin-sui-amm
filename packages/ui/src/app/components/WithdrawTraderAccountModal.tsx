"use client"

import { useCallback } from "react"
import { getStructLabel, shortenId } from "../helpers/format"
import {
  type TraderAccountCoinBalanceOption,
  type TraderAccountWithdrawSummary,
  useWithdrawTraderAccountModalState
} from "../hooks/useWithdrawTraderAccountModalState"
import Button from "./Button"
import CopyableId from "./CopyableId"
import {
  ModalBody,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalHeader,
  ModalSection,
  ModalStatusHeader,
  ModalSuccessFooter,
  modalFieldErrorTextClassName,
  modalFieldInputClassName,
  modalFieldInputErrorClassName,
  modalFieldLabelClassName,
  modalFieldTitleClassName
} from "./ModalPrimitives"
import { SummaryIdRow, SummaryValueCard } from "./SummaryPrimitives"
import TransactionRecap from "./TransactionRecap"
import TransactionStateModal from "./TransactionStateModal"

const inputClassName = (error?: string) =>
  [modalFieldInputClassName, error ? modalFieldInputErrorClassName : ""]
    .filter(Boolean)
    .join(" ")

const resolveCoinOptionLabel = (
  traderAccountCoinBalance: TraderAccountCoinBalanceOption
) =>
  `${getStructLabel(traderAccountCoinBalance.coinType)} (${traderAccountCoinBalance.totalBalance.toString()} base units)`

const WithdrawSummarySection = ({
  summary,
  explorerUrl
}: {
  summary: TraderAccountWithdrawSummary
  explorerUrl?: string
}) => (
  <ModalSection
    title="Withdrawal summary"
    subtitle="Latest withdrawn transfer details"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <SummaryValueCard
        label="Coin"
        value={getStructLabel(summary.coinType)}
        detail={summary.coinType}
      />
      <SummaryValueCard
        label="Amount"
        value={summary.amount}
        detail="Base units"
      />
      <SummaryValueCard
        label="Receiver"
        value={shortenId(summary.ownerAddress)}
        detail={summary.ownerAddress}
      />
    </div>
    <SummaryIdRow>
      <CopyableId
        value={summary.ownerAddress}
        label="Receiver"
        showExplorer={false}
      />
      <CopyableId
        value={summary.traderAccountId}
        label="Trader account"
        explorerUrl={explorerUrl}
      />
      <CopyableId
        value={summary.balanceManagerId}
        label="Balance manager"
        explorerUrl={explorerUrl}
      />
    </SummaryIdRow>
  </ModalSection>
)

const WithdrawSuccessView = ({
  summary,
  explorerUrl,
  onClose,
  onReset
}: {
  summary: TraderAccountWithdrawSummary
  explorerUrl?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Trader account withdrawn"
      subtitle={shortenId(summary.traderAccountId)}
      description="The withdrawal transaction has been confirmed on-chain."
      onClose={onClose}
    />
    <ModalBody>
      <WithdrawSummarySection summary={summary} explorerUrl={explorerUrl} />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalSuccessFooter
      actionLabel="Withdraw again"
      onAction={onReset}
      onClose={onClose}
    />
  </>
)

const WithdrawErrorView = ({
  error,
  details,
  onClose,
  onReset
}: {
  error: string
  details?: string
  onClose: () => void
  onReset: () => void
}) => (
  <>
    <ModalStatusHeader
      status="error"
      title="Withdrawal failed"
      subtitle="Resolve the issue and try again."
      description="The transaction was not completed."
      onClose={onClose}
    />
    <ModalBody>
      <ModalErrorNotice error={error} details={details} />
    </ModalBody>
    <ModalErrorFooter onRetry={onReset} onClose={onClose} />
  </>
)

const WithdrawTraderAccountModal = ({
  open,
  traderAccountId,
  balanceManagerId,
  balanceManagerBalancesBagId,
  explorerUrl,
  onClose,
  onWithdrawn
}: {
  open: boolean
  traderAccountId?: string
  balanceManagerId?: string
  balanceManagerBalancesBagId?: string
  explorerUrl?: string
  onClose: () => void
  onWithdrawn?: () => void
}) => {
  const {
    formState,
    fieldErrors,
    traderAccountCoinBalancesState,
    selectedTraderAccountCoinBalance,
    transactionState,
    transactionSummary,
    isSuccessState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleWithdrawTraderAccount,
    resetForm
  } = useWithdrawTraderAccountModalState({
    open,
    traderAccountId,
    balanceManagerId,
    balanceManagerBalancesBagId
  })

  const handleClose = useCallback(() => {
    if (isSuccessState) {
      onWithdrawn?.()
    }
    onClose()
  }, [isSuccessState, onClose, onWithdrawn])

  return (
    <TransactionStateModal
      open={open}
      onClose={handleClose}
      status={transactionState.status}
      summary={isSuccessState ? transactionSummary : undefined}
      error={
        transactionState.status === "error" ? transactionState.error : undefined
      }
      details={
        transactionState.status === "error"
          ? transactionState.details
          : undefined
      }
      renderSuccess={(summary) => (
        <WithdrawSuccessView
          summary={summary}
          explorerUrl={explorerUrl}
          onClose={handleClose}
          onReset={resetForm}
        />
      )}
      renderError={(error, details) => (
        <WithdrawErrorView
          error={error}
          details={details}
          onClose={handleClose}
          onReset={resetForm}
        />
      )}
    >
      <ModalHeader
        eyebrow="Trader account"
        title="Withdraw from trader account"
        description="Choose a funded trader account coin and withdrawal amount to receive in your wallet."
        onClose={handleClose}
      />
      <ModalBody>
        {traderAccountId && balanceManagerId ? (
          <ModalSection
            title="Source account"
            subtitle="Funds are withdrawn from this trader account balance manager."
          >
            <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
              <CopyableId
                value={traderAccountId}
                label="Trader account"
                explorerUrl={explorerUrl}
              />
              <CopyableId
                value={balanceManagerId}
                label="Balance manager"
                explorerUrl={explorerUrl}
              />
            </div>
          </ModalSection>
        ) : (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            Trader account information is not available.
          </div>
        )}

        <ModalSection
          title="Withdrawal details"
          subtitle="Withdrawal uses base units and submits a single on-chain transaction."
        >
          <label className={modalFieldLabelClassName}>
            <span className={modalFieldTitleClassName}>Coin</span>
            {traderAccountCoinBalancesState.status === "loading" ? (
              <span className="mt-2 text-[0.65rem] normal-case tracking-normal text-slate-500 dark:text-slate-200/70">
                Loading trader account balances...
              </span>
            ) : traderAccountCoinBalancesState.status === "error" ? (
              <span className="mt-2 text-[0.65rem] normal-case tracking-normal text-rose-600 dark:text-rose-200">
                {traderAccountCoinBalancesState.error}
              </span>
            ) : traderAccountCoinBalancesState.status === "success" &&
              traderAccountCoinBalancesState.balances.length === 0 ? (
              <span className="mt-2 text-[0.65rem] normal-case tracking-normal text-amber-600 dark:text-amber-200">
                This trader account has no funded balances available for
                withdrawal.
              </span>
            ) : (
              <select
                className={inputClassName(
                  shouldShowFieldError("coinType", fieldErrors.coinType)
                    ? fieldErrors.coinType
                    : undefined
                )}
                value={formState.coinType}
                onChange={(event) =>
                  handleInputChange("coinType", event.target.value)
                }
                onBlur={() => markFieldBlur("coinType")}
              >
                {traderAccountCoinBalancesState.status === "success"
                  ? traderAccountCoinBalancesState.balances.map(
                      (traderAccountCoinBalance) => (
                        <option
                          key={traderAccountCoinBalance.coinType}
                          value={traderAccountCoinBalance.coinType}
                        >
                          {resolveCoinOptionLabel(traderAccountCoinBalance)}
                        </option>
                      )
                    )
                  : null}
              </select>
            )}
            {shouldShowFieldError("coinType", fieldErrors.coinType) ? (
              <span className={modalFieldErrorTextClassName}>
                {fieldErrors.coinType}
              </span>
            ) : undefined}
          </label>

          <label className={modalFieldLabelClassName}>
            <span className={modalFieldTitleClassName}>Amount</span>
            <input
              value={formState.amount}
              onChange={(event) =>
                handleInputChange("amount", event.target.value)
              }
              onBlur={() => markFieldBlur("amount")}
              className={inputClassName(
                shouldShowFieldError("amount", fieldErrors.amount)
                  ? fieldErrors.amount
                  : undefined
              )}
              placeholder="1000000000"
            />
            {shouldShowFieldError("amount", fieldErrors.amount) ? (
              <span className={modalFieldErrorTextClassName}>
                {fieldErrors.amount}
              </span>
            ) : undefined}
          </label>

          {selectedTraderAccountCoinBalance ? (
            <div className="rounded-xl border border-slate-200/70 bg-white/80 px-3 py-3 text-xs dark:border-slate-50/15 dark:bg-slate-950/60">
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                Selected trader account balance
              </div>
              <div className="mt-1 font-semibold text-sds-dark dark:text-sds-light">
                {selectedTraderAccountCoinBalance.totalBalance.toString()} base
                units
              </div>
            </div>
          ) : null}
        </ModalSection>
      </ModalBody>

      <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            {transactionState.status === "processing"
              ? "Waiting for wallet confirmation..."
              : "Ready to submit withdrawal transaction."}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleWithdrawTraderAccount} disabled={!canSubmit}>
              {transactionState.status === "processing"
                ? "Processing..."
                : "Withdraw fund"}
            </Button>
          </div>
        </div>
      </div>
    </TransactionStateModal>
  )
}

export default WithdrawTraderAccountModal
