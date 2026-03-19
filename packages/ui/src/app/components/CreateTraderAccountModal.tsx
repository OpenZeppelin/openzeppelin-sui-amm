"use client"

import { shortenId } from "../helpers/format"
import type { TraderAccountCreateSummary } from "../helpers/traderAccountCreateSummary"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import Button from "./Button"
import CopyableId from "./CopyableId"
import {
  ModalBody,
  ModalCloseFooter,
  ModalErrorFooter,
  ModalErrorNotice,
  ModalHeader,
  ModalSection,
  ModalStatusHeader,
  modalFieldWarningTextClassName
} from "./ModalPrimitives"
import { SummaryIdRow, SummaryValueCard } from "./SummaryPrimitives"
import TransactionRecap from "./TransactionRecap"
import TransactionStateModal from "./TransactionStateModal"

const resolveCompactSummaryValue = (value?: string) =>
  value ? shortenId(value) : "Not captured"

const TraderAccountCreateSummarySection = ({
  summary,
  explorerUrl
}: {
  summary: TraderAccountCreateSummary
  explorerUrl?: string
}) => (
  <ModalSection
    title="Creation summary"
    subtitle="Objects created by the latest trader account transaction"
  >
    <div className="grid gap-3 text-xs sm:grid-cols-2">
      <SummaryValueCard
        label="Owner"
        value={shortenId(summary.ownerAddress)}
        detail={summary.ownerAddress}
      />
      <SummaryValueCard
        label="Balance manager"
        value={resolveCompactSummaryValue(summary.balanceManagerId)}
        detail={summary.balanceManagerId}
      />
      <SummaryValueCard
        label="Trade cap"
        value={resolveCompactSummaryValue(summary.tradeCapId)}
        detail={summary.tradeCapId}
      />
      <SummaryValueCard
        label="Deposit cap"
        value={resolveCompactSummaryValue(summary.depositCapId)}
        detail={summary.depositCapId}
      />
      <SummaryValueCard
        label="Withdraw cap"
        value={resolveCompactSummaryValue(summary.withdrawCapId)}
        detail={summary.withdrawCapId}
      />
      <SummaryValueCard
        label="Trader account"
        value={shortenId(summary.traderAccountId)}
        detail={summary.traderAccountId}
      />
    </div>
    <SummaryIdRow>
      <CopyableId
        value={summary.ownerAddress}
        label="Owner"
        showExplorer={false}
      />
      <CopyableId
        value={summary.traderAccountId}
        label="Trader account"
        explorerUrl={explorerUrl}
      />
      {summary.balanceManagerId ? (
        <CopyableId
          value={summary.balanceManagerId}
          label="Balance manager"
          explorerUrl={explorerUrl}
        />
      ) : undefined}
      {summary.tradeCapId ? (
        <CopyableId
          value={summary.tradeCapId}
          label="Trade cap"
          explorerUrl={explorerUrl}
        />
      ) : undefined}
      {summary.depositCapId ? (
        <CopyableId
          value={summary.depositCapId}
          label="Deposit cap"
          explorerUrl={explorerUrl}
        />
      ) : undefined}
      {summary.withdrawCapId ? (
        <CopyableId
          value={summary.withdrawCapId}
          label="Withdraw cap"
          explorerUrl={explorerUrl}
        />
      ) : undefined}
    </SummaryIdRow>
  </ModalSection>
)

const CreateTraderAccountSuccessView = ({
  summary,
  explorerUrl,
  onClose
}: {
  summary: TraderAccountCreateSummary
  explorerUrl?: string
  onClose: () => void
}) => (
  <>
    <ModalStatusHeader
      status="success"
      title="Trader account created"
      subtitle={shortenId(summary.traderAccountId)}
      description="The account was created and its balance manager was registered in DeepBook."
      onClose={onClose}
    />
    <ModalBody>
      <TraderAccountCreateSummarySection
        summary={summary}
        explorerUrl={explorerUrl}
      />
      <TransactionRecap
        transactionBlock={summary.transactionBlock}
        digest={summary.digest}
        explorerUrl={explorerUrl}
      />
    </ModalBody>
    <ModalCloseFooter
      message="Trader account creation confirmed."
      onClose={onClose}
    />
  </>
)

const CreateTraderAccountErrorView = ({
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
      title="Trader account creation failed"
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

const CreateTraderAccountModal = ({
  open,
  explorerUrl,
  onClose
}: {
  open: boolean
  explorerUrl?: string
  onClose: () => void
}) => {
  const { createAction } = useTraderAccountContext()
  const {
    canCreate,
    disabledReason,
    transactionState,
    createTraderAccount,
    resetTransactionState
  } = createAction

  const isProcessing = transactionState.status === "processing"

  return (
    <TransactionStateModal
      open={open}
      onClose={onClose}
      status={transactionState.status}
      summary={
        transactionState.status === "success"
          ? transactionState.summary
          : undefined
      }
      error={
        transactionState.status === "error" ? transactionState.error : undefined
      }
      details={
        transactionState.status === "error"
          ? transactionState.details
          : undefined
      }
      renderSuccess={(summary) => (
        <CreateTraderAccountSuccessView
          summary={summary}
          explorerUrl={explorerUrl}
          onClose={onClose}
        />
      )}
      renderError={(error, details) => (
        <CreateTraderAccountErrorView
          error={error}
          details={details}
          onClose={onClose}
          onReset={resetTransactionState}
        />
      )}
    >
      <ModalHeader
        eyebrow="Trader account"
        title="Create trader account"
        description="Create a trader account, balance manager, and owner capabilities with one on-chain transaction."
        onClose={onClose}
      />
      <ModalBody>
        <ModalSection
          title="Transaction plan"
          subtitle="This operation creates the trader account and registers its balance manager."
        >
          <div className="rounded-xl border border-slate-200/70 bg-white/75 p-3 text-xs text-slate-600 dark:border-slate-50/15 dark:bg-slate-950/60 dark:text-slate-200/70">
            The flow creates the trader account object, stores owner caps, and
            registers the linked balance manager in the DeepBook registry.
          </div>
          {disabledReason ? (
            <div className={modalFieldWarningTextClassName}>
              {disabledReason}
            </div>
          ) : undefined}
        </ModalSection>
      </ModalBody>
      <div className="border-t border-slate-200/70 px-6 py-4 dark:border-slate-50/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
            {isProcessing ? "Submitting transaction..." : "Ready to submit"}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void createTraderAccount()}
              disabled={!canCreate}
            >
              {isProcessing ? "Creating..." : "Create trader account"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </TransactionStateModal>
  )
}

export default CreateTraderAccountModal
