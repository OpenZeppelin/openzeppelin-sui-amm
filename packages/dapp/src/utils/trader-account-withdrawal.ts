import { normalizeSuiAddress } from "@mysten/sui/utils"
import {
  getBalanceManagerAssetBalances,
  type TraderAccountAssetBalance,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { withdrawTraderAccount } from "@sui-amm/domain-core/ptb/deepbook"
import { normalizeCoinType } from "@sui-amm/tooling-core/coin"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"
import { parsePositiveU64 } from "@sui-amm/tooling-core/utils/utility"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import {
  getOwnedTraderAccountOverview,
  resolveOwnedTraderAccountId
} from "./trader-account.ts"
import {
  buildSummaryLabel,
  toTransactionSummaryView,
  type TransactionSummaryView
} from "./transaction-summary.ts"
import { resolveCoinAssetTypeFromInput } from "./coin-type.ts"

const WITHDRAW_TRADER_ACCOUNT_LABEL = "withdraw-trader-account"

const resolveWithdrawalAmount = (amount: string): bigint =>
  parsePositiveU64(amount, "Withdrawal amount")

const resolveWithdrawalCoinType = (coinType: string): string => {
  return resolveCoinAssetTypeFromInput({
    coinTypeInput: coinType,
    valueLabel: "Withdrawal coin type"
  })
}

const resolveRecipientAddress = ({
  recipientAddress,
  signerAddress
}: {
  recipientAddress?: string
  signerAddress: string
}) => normalizeSuiAddress(recipientAddress ?? signerAddress)

const resolveBalanceForCoinType = ({
  assetBalances,
  coinType
}: {
  assetBalances: TraderAccountAssetBalance[]
  coinType: string
}) =>
  assetBalances.find(
    (assetBalance) =>
      normalizeCoinType(assetBalance.coinType) === normalizeCoinType(coinType)
  )?.balance ?? 0n

const assertSufficientTraderAccountBalance = async ({
  tooling,
  traderAccount,
  withdrawalCoinType,
  withdrawalAmount
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccount: TraderAccountOverview
  withdrawalCoinType: string
  withdrawalAmount: bigint
}) => {
  const assetBalances = await getBalanceManagerAssetBalances(
    traderAccount.balanceManagerId,
    tooling.suiClient
  )
  const availableBalance = resolveBalanceForCoinType({
    assetBalances,
    coinType: withdrawalCoinType
  })
  if (availableBalance >= withdrawalAmount) return

  throw new Error(
    `Trader account ${traderAccount.traderAccountId} has insufficient ${withdrawalCoinType} balance in balance manager ${traderAccount.balanceManagerId}: requested ${withdrawalAmount.toString()}, available ${availableBalance.toString()}. Fund the trader account before withdrawing.`
  )
}

const buildWithdrawTraderAccountTransaction = ({
  ammPackageId,
  traderAccount,
  balanceManager,
  withdrawalAmount,
  withdrawalCoinType,
  recipientAddress
}: {
  ammPackageId: string
  traderAccount: TraderAccountOverview
  balanceManager: WrappedSuiSharedObject
  withdrawalAmount: bigint
  withdrawalCoinType: string
  recipientAddress: string
}) => {
  const transaction = newTransaction()
  const withdrawnCoin = withdrawTraderAccount({
    transaction,
    ammPackageId,
    traderAccountId: traderAccount.traderAccountId,
    balanceManager,
    withdrawAmount: withdrawalAmount,
    coinAssetType: withdrawalCoinType
  })

  transaction.transferObjects(
    [withdrawnCoin],
    transaction.pure.address(recipientAddress)
  )

  return transaction
}

export type WithdrawTraderAccountResult = {
  status: "withdrawn" | "dry-run"
  traderAccount: TraderAccountOverview
  coinType: string
  amount: string
  recipientAddress: string
  transactionSummaries: {
    withdrawTraderAccount?: TransactionSummary
  }
}

export type WithdrawTraderAccountResultView = Omit<
  WithdrawTraderAccountResult,
  "transactionSummaries"
> & {
  transactionSummaries: {
    withdrawTraderAccount?: TransactionSummaryView
  }
}

export const toWithdrawTraderAccountResultView = (
  withdrawalResult: WithdrawTraderAccountResult
): WithdrawTraderAccountResultView => ({
  ...withdrawalResult,
  transactionSummaries: {
    withdrawTraderAccount: toTransactionSummaryView(
      withdrawalResult.transactionSummaries.withdrawTraderAccount
    )
  }
})

export const withdrawFromExistingTraderAccount = async ({
  tooling,
  ammPackageId,
  traderAccountId,
  coinType,
  amount,
  recipientAddress,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "getMutableSharedObject"
    | "loadedEd25519KeyPair"
    | "suiClient"
  >
  ammPackageId: string
  traderAccountId?: string
  coinType: string
  amount: string
  recipientAddress?: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<WithdrawTraderAccountResult> => {
  const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
  const resolvedRecipientAddress = resolveRecipientAddress({
    recipientAddress,
    signerAddress
  })
  const withdrawalAmount = resolveWithdrawalAmount(amount)
  const withdrawalCoinType = resolveWithdrawalCoinType(coinType)

  const resolvedTraderAccountId = await resolveOwnedTraderAccountId({
    tooling,
    traderAccountId,
    ownerAddress: signerAddress,
    ammPackageId
  })

  if (!resolvedTraderAccountId) {
    throw new Error(
      "No owned trader account was found for the active signer. Create one or provide --trader-account-id."
    )
  }

  const traderAccount = await getOwnedTraderAccountOverview({
    tooling,
    traderAccountId: resolvedTraderAccountId,
    ownerAddress: signerAddress,
    ammPackageId,
    operation: "Trader account withdrawal lookup"
  })
  await assertSufficientTraderAccountBalance({
    tooling,
    traderAccount,
    withdrawalCoinType,
    withdrawalAmount
  })
  const balanceManager = await tooling.getMutableSharedObject({
    objectId: traderAccount.balanceManagerId
  })

  const withdrawalTransaction = buildWithdrawTraderAccountTransaction({
    ammPackageId,
    traderAccount,
    balanceManager,
    withdrawalAmount,
    withdrawalCoinType,
    recipientAddress: resolvedRecipientAddress
  })
  const withdrawalExecution = await tooling.executeTransactionWithSummary({
    transaction: withdrawalTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: WITHDRAW_TRADER_ACCOUNT_LABEL,
    devInspect,
    dryRun
  })

  return {
    status: dryRun ? "dry-run" : "withdrawn",
    traderAccount,
    coinType: withdrawalCoinType,
    amount: withdrawalAmount.toString(),
    recipientAddress: resolvedRecipientAddress,
    transactionSummaries: {
      withdrawTraderAccount:
        withdrawalExecution.summary ??
        buildSummaryLabel(WITHDRAW_TRADER_ACCOUNT_LABEL)
    }
  }
}
