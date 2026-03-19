import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { ObjectArtifact } from "@sui-amm/tooling-core/object"
import {
  resolveSplitCoinResult,
  newTransaction
} from "@sui-amm/tooling-core/transactions"
import { parsePositiveU64 } from "@sui-amm/tooling-core/utils/utility"
import { depositTraderAccount } from "@sui-amm/domain-core/ptb/deepbook"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import {
  DEFAULT_TX_GAS_BUDGET,
  NORMALIZED_SUI_COIN_TYPE,
  SUI_COIN_TYPE
} from "@sui-amm/tooling-node/constants"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import { findCreatedArtifactBySuffix } from "@sui-amm/tooling-node/transactions"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"
import { planSuiPaymentSplitTransaction } from "@sui-amm/tooling-core/coin"
import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import {
  getOwnedTraderAccountOverview,
  resolveOwnedTraderAccountId
} from "./trader-account.ts"
import {
  buildSummaryLabel,
  toTransactionSummaryView,
  type TransactionSummaryView
} from "./transaction-summary.ts"
import { extractCoinAssetTypeFromCoinObjectType } from "./coin-type.ts"

const FUND_TRADER_ACCOUNT_LABEL = "fund-trader-account"
const PREPARE_SUI_GAS_LABEL = "prepare-sui-gas-coin"
const NORMALIZED_SUI_COIN_OBJECT_TYPE_SUFFIX = `::coin::Coin<${NORMALIZED_SUI_COIN_TYPE}>`

type GasPaymentReference = {
  objectId: string
  version: string | number
  digest: string
}

const resolveFundingAmount = (amount: string): bigint =>
  parsePositiveU64(amount, "Funding amount")

const assertSignerOwnsFundingCoin = ({
  coinObjectId,
  signerAddress,
  coinOwnerAddress
}: {
  coinObjectId: string
  signerAddress: string
  coinOwnerAddress: string
}) => {
  if (coinOwnerAddress === signerAddress) return

  throw new Error(
    `Funding coin ${coinObjectId} is not owned by signer ${signerAddress} (owner ${coinOwnerAddress}).`
  )
}

const isSuiCoinObjectType = (coinType: string) =>
  coinType.endsWith(NORMALIZED_SUI_COIN_OBJECT_TYPE_SUFFIX)

const resolveGasBudget = ({
  tooling
}: {
  tooling: Pick<Tooling, "suiConfig">
}) => tooling.suiConfig.network.gasBudget ?? DEFAULT_TX_GAS_BUDGET

const resolveGasPaymentReferenceFromArtifact = (
  createdObjectArtifact: ObjectArtifact | undefined
): GasPaymentReference => {
  const objectId = createdObjectArtifact?.objectId
  const version = createdObjectArtifact?.version
  const digest = createdObjectArtifact?.digest

  if (!objectId || version === undefined || !digest) {
    throw new Error(
      "Expected the SUI gas split transaction to create a reusable gas coin."
    )
  }

  return {
    objectId: normalizeSuiObjectId(objectId),
    version,
    digest
  }
}

const resolveDistinctSuiGasPaymentReference = async ({
  tooling,
  ownerAddress,
  excludedCoinObjectId
}: {
  tooling: Pick<Tooling, "suiClient">
  ownerAddress: string
  excludedCoinObjectId: string
}): Promise<GasPaymentReference> => {
  const normalizedExcludedCoinObjectId =
    normalizeSuiObjectId(excludedCoinObjectId)
  let cursor: string | undefined = undefined

  do {
    const page = await tooling.suiClient.getCoins({
      owner: ownerAddress,
      coinType: SUI_COIN_TYPE,
      limit: 50,
      cursor
    })

    const distinctGasCoin = page.data.find(
      (coin) =>
        normalizeSuiObjectId(coin.coinObjectId) !==
        normalizedExcludedCoinObjectId
    )

    if (distinctGasCoin) {
      return {
        objectId: normalizeSuiObjectId(distinctGasCoin.coinObjectId),
        version: distinctGasCoin.version,
        digest: distinctGasCoin.digest
      }
    }

    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  throw new Error(
    `Funding with SUI coin ${normalizedExcludedCoinObjectId} requires a second SUI coin object for gas, but none was found.`
  )
}

const buildFundTraderAccountTransaction = ({
  ammPackageId,
  traderAccountId,
  ammAdminCapId,
  fundingCoinObjectId,
  fundingAmount,
  coinAssetType,
  signerAddress,
  gasPaymentReference
}: {
  ammPackageId: string
  traderAccountId: string
  ammAdminCapId: string
  fundingCoinObjectId: string
  fundingAmount: bigint
  coinAssetType: string
  signerAddress: string
  gasPaymentReference?: GasPaymentReference
}) => {
  const transaction = newTransaction()
  const fundingCoin = transaction.object(fundingCoinObjectId)
  const splitFundingCoinResult = transaction.splitCoins(fundingCoin, [
    transaction.pure.u64(fundingAmount)
  ])
  const fundingCoinArgument = resolveSplitCoinResult(splitFundingCoinResult, 0)

  depositTraderAccount({
    transaction,
    ammPackageId,
    traderAccountId,
    ammAdminCapId,
    fundingCoin: fundingCoinArgument,
    coinAssetType
  })

  if (gasPaymentReference) {
    transaction.setGasOwner(signerAddress)
    transaction.setGasPayment([gasPaymentReference])
  }

  return transaction
}

const prepareSuiGasPaymentReference = async ({
  tooling,
  signerAddress,
  fundingCoinObjectId,
  fundingAmount,
  dryRun,
  devInspect
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "loadedEd25519KeyPair"
    | "suiClient"
    | "suiConfig"
  >
  signerAddress: string
  fundingCoinObjectId: string
  fundingAmount: bigint
  dryRun?: boolean
  devInspect?: boolean
}): Promise<
  | {
      status: "ready"
      gasPaymentReference: GasPaymentReference
      prepareSuiGasSummary?: TransactionSummary
    }
  | {
      status: "dry-run-sui-prepare-only"
      note: string
      prepareSuiGasSummary: TransactionSummary
    }
> => {
  const gasBudget = resolveGasBudget({ tooling })
  const splitPlan = await planSuiPaymentSplitTransaction(
    {
      owner: signerAddress,
      paymentMinimum: fundingAmount,
      gasBudget: BigInt(gasBudget),
      paymentCoinObjectId: fundingCoinObjectId
    },
    { suiClient: tooling.suiClient }
  )

  if (!splitPlan.needsSplit) {
    return {
      status: "ready",
      gasPaymentReference: await resolveDistinctSuiGasPaymentReference({
        tooling,
        ownerAddress: signerAddress,
        excludedCoinObjectId: fundingCoinObjectId
      })
    }
  }

  if (!splitPlan.transaction)
    throw new Error(
      "Expected a SUI gas split transaction to be available when a split is required."
    )

  if (dryRun) {
    return {
      status: "dry-run-sui-prepare-only",
      note: "Dry-run detected that the selected SUI funding coin also needs to be split to produce a separate gas coin. Re-run without --dry-run to execute the preparation step and funding flow.",
      prepareSuiGasSummary: buildSummaryLabel(PREPARE_SUI_GAS_LABEL)
    }
  }

  const splitResult = await tooling.executeTransactionWithSummary({
    transaction: splitPlan.transaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: PREPARE_SUI_GAS_LABEL,
    devInspect
  })

  const gasPaymentReference = resolveGasPaymentReferenceFromArtifact(
    findCreatedArtifactBySuffix(
      splitResult.execution?.objectArtifacts.created,
      NORMALIZED_SUI_COIN_OBJECT_TYPE_SUFFIX
    )
  )

  return {
    status: "ready",
    gasPaymentReference,
    prepareSuiGasSummary:
      splitResult.summary ?? buildSummaryLabel(PREPARE_SUI_GAS_LABEL)
  }
}

export type FundTraderAccountResult = {
  status: "funded" | "dry-run" | "dry-run-sui-prepare-only"
  traderAccount: TraderAccountOverview
  coinObjectId: string
  coinType: string
  amount: string
  note?: string
  transactionSummaries: {
    prepareSuiGas?: TransactionSummary
    fundTraderAccount?: TransactionSummary
  }
}

export type FundTraderAccountResultView = Omit<
  FundTraderAccountResult,
  "transactionSummaries"
> & {
  transactionSummaries: {
    prepareSuiGas?: TransactionSummaryView
    fundTraderAccount?: TransactionSummaryView
  }
}

export const toFundTraderAccountResultView = (
  fundingResult: FundTraderAccountResult
): FundTraderAccountResultView => ({
  ...fundingResult,
  transactionSummaries: {
    prepareSuiGas: toTransactionSummaryView(
      fundingResult.transactionSummaries.prepareSuiGas
    ),
    fundTraderAccount: toTransactionSummaryView(
      fundingResult.transactionSummaries.fundTraderAccount
    )
  }
})

export const fundExistingTraderAccount = async ({
  tooling,
  ammPackageId,
  ammAdminCapId,
  coinObjectId,
  amount,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    | "executeTransactionWithSummary"
    | "loadedEd25519KeyPair"
    | "resolveCoinOwnership"
    | "suiClient"
    | "suiConfig"
  >
  ammPackageId: string
  ammAdminCapId: string
  coinObjectId: string
  amount: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<FundTraderAccountResult> => {
  const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
  const fundingAmount = resolveFundingAmount(amount)
  const normalizedCoinObjectId = normalizeSuiObjectId(coinObjectId)
  const resolvedTraderAccountId = await resolveOwnedTraderAccountId({
    tooling,
    ownerAddress: signerAddress,
    ammPackageId
  })

  if (!resolvedTraderAccountId) {
    throw new Error(
      "No owned trader account was found for the active signer. Create one first."
    )
  }

  const [coinOwnership, traderAccount] = await Promise.all([
    tooling.resolveCoinOwnership({ coinObjectId: normalizedCoinObjectId }),
    getOwnedTraderAccountOverview({
      tooling,
      traderAccountId: resolvedTraderAccountId,
      ownerAddress: signerAddress,
      ammPackageId,
      operation: "Trader account funding lookup"
    })
  ])

  assertSignerOwnsFundingCoin({
    coinObjectId: normalizedCoinObjectId,
    signerAddress,
    coinOwnerAddress: coinOwnership.ownerAddress
  })

  let prepareSuiGasSummary: TransactionSummary | undefined
  let gasPaymentReference: GasPaymentReference | undefined
  if (isSuiCoinObjectType(coinOwnership.coinType)) {
    const gasPreparation = await prepareSuiGasPaymentReference({
      tooling,
      signerAddress,
      fundingCoinObjectId: normalizedCoinObjectId,
      fundingAmount,
      dryRun,
      devInspect
    })

    prepareSuiGasSummary = gasPreparation.prepareSuiGasSummary
    if (gasPreparation.status === "dry-run-sui-prepare-only") {
      return {
        status: "dry-run-sui-prepare-only",
        traderAccount,
        coinObjectId: normalizedCoinObjectId,
        coinType: coinOwnership.coinType,
        amount: fundingAmount.toString(),
        note: gasPreparation.note,
        transactionSummaries: {
          prepareSuiGas: prepareSuiGasSummary
        }
      }
    }

    gasPaymentReference = gasPreparation.gasPaymentReference
  }

  const fundTraderAccountTransaction = buildFundTraderAccountTransaction({
    ammPackageId,
    traderAccountId: traderAccount.traderAccountId,
    ammAdminCapId,
    fundingCoinObjectId: normalizedCoinObjectId,
    fundingAmount,
    coinAssetType: extractCoinAssetTypeFromCoinObjectType({
      coinObjectType: coinOwnership.coinType,
      valueLabel: "Coin object type"
    }),
    signerAddress,
    gasPaymentReference
  })

  const fundingResult = await tooling.executeTransactionWithSummary({
    transaction: fundTraderAccountTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: FUND_TRADER_ACCOUNT_LABEL,
    devInspect,
    dryRun
  })

  return {
    status: dryRun ? "dry-run" : "funded",
    traderAccount,
    coinObjectId: normalizedCoinObjectId,
    coinType: coinOwnership.coinType,
    amount: fundingAmount.toString(),
    transactionSummaries: {
      prepareSuiGas: prepareSuiGasSummary,
      fundTraderAccount:
        fundingResult.summary ?? buildSummaryLabel(FUND_TRADER_ACCOUNT_LABEL)
    }
  }
}
