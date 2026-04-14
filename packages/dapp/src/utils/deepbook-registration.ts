import {
  findOwnedTraderAccountIds,
  getTraderAccountOverview,
  resolveTraderAccountType,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { buildCreateTraderAccountTransaction } from "@sui-amm/domain-core/ptb/deepbook"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"
import type { TransactionSummary } from "@sui-amm/tooling-node/transactions-summary"

const CREATE_MARKET_MAKER_LABEL = "create-market-maker"

const buildSummaryLabel = (label: string): TransactionSummary => ({
  label,
  objectChanges: [],
  balanceChanges: []
})

export type ResolveOrCreateTraderAccountResult = {
  status: "existing" | "created" | "dry-run-created"
  traderAccount?: TraderAccountOverview
  note?: string
  transactionSummaries: {
    createTraderAccount?: TransactionSummary
  }
}

type ResolveCreateDependencies = () => Promise<{
  adminCapId: string
}>

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const buildModelError = ({
  operation,
  traderAccountId,
  expectedOwner,
  expectedPackageId,
  error
}: {
  operation: string
  traderAccountId: string
  expectedOwner: string
  expectedPackageId: string
  error: unknown
}) =>
  new Error(
    `${operation} failed for traderAccountId ${traderAccountId} (expected owner ${expectedOwner}, expected package ${expectedPackageId}, expected type ${resolveTraderAccountType(
      expectedPackageId
    )}). Cause: ${getErrorMessage(error)}`
  )

const loadTraderAccountOverview = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId: string
  ownerAddress: string
  ammPackageId: string
}): Promise<TraderAccountOverview> => {
  let traderAccount: TraderAccountOverview
  try {
    traderAccount = await getTraderAccountOverview(
      traderAccountId,
      tooling.suiClient
    )
  } catch (error) {
    throw buildModelError({
      operation: "Market maker lookup",
      traderAccountId,
      expectedOwner: ownerAddress,
      expectedPackageId: ammPackageId,
      error
    })
  }

  if (traderAccount.ownerAddress !== ownerAddress)
    throw new Error(
      `Market maker owner mismatch for traderAccountId ${traderAccountId}. Expected owner ${ownerAddress}, found ${traderAccount.ownerAddress}, expected package ${ammPackageId}.`
    )

  return traderAccount
}

const createTraderAccount = async ({
  tooling,
  ammPackageId,
  resolveCreateDependencies,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    "executeTransactionWithSummary" | "loadedEd25519KeyPair"
  >
  ammPackageId: string
  resolveCreateDependencies: ResolveCreateDependencies
  devInspect?: boolean
  dryRun?: boolean
}): Promise<{
  traderAccountId?: string
  summary: TransactionSummary
}> => {
  const { adminCapId } = await resolveCreateDependencies()
  const createTransaction = buildCreateTraderAccountTransaction({
    ammPackageId,
    adminCapId
  })
  const createResult = await tooling.executeTransactionWithSummary({
    transaction: createTransaction,
    signer: tooling.loadedEd25519KeyPair,
    summaryLabel: CREATE_MARKET_MAKER_LABEL,
    devInspect,
    dryRun
  })

  const summary =
    createResult.summary ?? buildSummaryLabel(CREATE_MARKET_MAKER_LABEL)

  if (dryRun) {
    return { summary }
  }

  const createExecution = createResult.execution?.transactionResult
  if (!createExecution)
    throw new Error("Market maker creation did not execute.")

  return {
    traderAccountId: ensureCreatedObject(
      "::market_maker::MarketMaker",
      createExecution
    ).objectId,
    summary
  }
}

const resolveExistingTraderAccountId = async ({
  tooling,
  traderAccountId,
  ownerAddress,
  ammPackageId
}: {
  tooling: Pick<Tooling, "suiClient">
  traderAccountId?: string
  ownerAddress: string
  ammPackageId: string
}): Promise<string | undefined> => {
  if (traderAccountId) return traderAccountId

  const ownedTraderAccountIds = await findOwnedTraderAccountIds({
    ownerAddress,
    packageId: ammPackageId,
    suiClient: tooling.suiClient
  })

  if (ownedTraderAccountIds.length > 1)
    throw new Error(
      `Multiple owned market makers were found for the active owner (${ownedTraderAccountIds.length}). Provide --trader-account-id to choose one explicitly.`
    )

  return ownedTraderAccountIds[0]
}

export const resolveOrCreateTraderAccount = async ({
  tooling,
  ammPackageId,
  resolveCreateDependencies,
  deepbookRegistryId,
  ownerAddress,
  traderAccountId,
  devInspect,
  dryRun
}: {
  tooling: Pick<
    Tooling,
    "executeTransactionWithSummary" | "loadedEd25519KeyPair" | "suiClient"
  >
  ammPackageId: string
  resolveCreateDependencies: ResolveCreateDependencies
  deepbookRegistryId: string
  ownerAddress: string
  traderAccountId?: string
  devInspect?: boolean
  dryRun?: boolean
}): Promise<ResolveOrCreateTraderAccountResult> => {
  // Kept for backward-compatible callsites; no longer needed by create_market_maker.
  void deepbookRegistryId

  const resolvedTraderAccountId = await resolveExistingTraderAccountId({
    tooling,
    traderAccountId,
    ownerAddress,
    ammPackageId
  })

  if (resolvedTraderAccountId) {
    return {
      status: "existing",
      traderAccount: await loadTraderAccountOverview({
        tooling,
        traderAccountId: resolvedTraderAccountId,
        ownerAddress,
        ammPackageId
      }),
      transactionSummaries: {}
    }
  }

  const createResult = await createTraderAccount({
    tooling,
    ammPackageId,
    resolveCreateDependencies,
    devInspect,
    dryRun
  })

  if (dryRun) {
    return {
      status: "dry-run-created",
      note: "Dry-run simulated market maker creation. Created object IDs are unavailable without execution.",
      transactionSummaries: {
        createTraderAccount: createResult.summary
      }
    }
  }

  if (!createResult.traderAccountId)
    throw new Error("Market maker creation did not return a market maker id.")

  return {
    status: "created",
    traderAccount: await loadTraderAccountOverview({
      tooling,
      traderAccountId: createResult.traderAccountId,
      ownerAddress,
      ammPackageId
    }),
    transactionSummaries: {
      createTraderAccount: createResult.summary
    }
  }
}
