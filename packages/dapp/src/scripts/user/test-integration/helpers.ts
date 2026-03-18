import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { resolvePropAmmAppType } from "@sui-amm/domain-core/models/deepbook"
import { getTraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import {
  buildAuthorizePropAmmAppTransaction,
  buildCreateTraderAccountTransaction,
  buildInitBalanceManagerMapTransaction,
  buildRegisterBalanceManagerTransaction
} from "@sui-amm/domain-core/ptb/deepbook"
import {
  fetchCoinBalances,
  normalizeCoinType,
  selectRichestCoin
} from "@sui-amm/tooling-core/coin"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/package"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"
import type {
  TestAccount,
  TestContext
} from "@sui-amm/tooling-node/testing/localnet"
import {
  resolveDeepbookPublishObjectsFromDigest,
  type DeepbookPublishObjects
} from "../../../utils/deepbook.ts"

type DeepbookBalanceEventAsset = {
  name?: unknown
}

type IntegrationTransaction = Parameters<
  TestContext["signAndExecuteTransactionAndWait"]
>[0]

export type DeepbookBalanceEvent = {
  balance_manager_id: string
  asset: string | DeepbookBalanceEventAsset
  amount: string | number
  deposit: boolean
}

const resolveMutableDeepbookRegistry = async ({
  context,
  deepbookRegistryId
}: {
  context: TestContext
  deepbookRegistryId: string
}) =>
  getSuiSharedObject(
    {
      objectId: deepbookRegistryId,
      mutable: true
    },
    { suiClient: context.suiClient }
  )

const executeWithMutableDeepbookRegistry = async ({
  context,
  account,
  deepbook,
  buildTransaction
}: {
  context: TestContext
  account: TestAccount
  deepbook: DeepbookPublishObjects
  buildTransaction: (
    deepbookRegistry: Awaited<ReturnType<typeof resolveMutableDeepbookRegistry>>
  ) => IntegrationTransaction
}) => {
  const deepbookRegistry = await resolveMutableDeepbookRegistry({
    context,
    deepbookRegistryId: deepbook.deepbookRegistryId
  })
  const transaction = buildTransaction(deepbookRegistry)

  await context.signAndExecuteTransactionAndWait(transaction, account)
}

export const authorizePropAmmInDeepbook = async ({
  context,
  account,
  deepbook,
  ammPackageId
}: {
  context: TestContext
  account: TestAccount
  deepbook: DeepbookPublishObjects
  ammPackageId: string
}) => {
  await executeWithMutableDeepbookRegistry({
    context,
    account,
    deepbook,
    buildTransaction: (deepbookRegistry) =>
      buildAuthorizePropAmmAppTransaction({
        deepbookPackageId: deepbook.deepbookPackageId,
        deepbookRegistry,
        deepbookAdminCapId: deepbook.deepbookAdminCapId,
        appType: resolvePropAmmAppType(ammPackageId)
      })
  })
}

export const initializeDeepbookBalanceManagerMap = async ({
  context,
  account,
  deepbook
}: {
  context: TestContext
  account: TestAccount
  deepbook: DeepbookPublishObjects
}) => {
  await executeWithMutableDeepbookRegistry({
    context,
    account,
    deepbook,
    buildTransaction: (deepbookRegistry) =>
      buildInitBalanceManagerMapTransaction({
        deepbookPackageId: deepbook.deepbookPackageId,
        deepbookRegistry,
        deepbookAdminCapId: deepbook.deepbookAdminCapId
      })
  })
}

export const createAndRegisterTraderAccount = async ({
  context,
  account,
  ammPackageId,
  deepbookRegistryId
}: {
  context: TestContext
  account: TestAccount
  ammPackageId: string
  deepbookRegistryId: string
}): Promise<TraderAccountOverview> => {
  const immutableDeepbookRegistry = await getSuiSharedObject(
    {
      objectId: deepbookRegistryId,
      mutable: false
    },
    { suiClient: context.suiClient }
  )

  const createTraderAccountTransaction = buildCreateTraderAccountTransaction({
    ammPackageId,
    deepbookRegistry: immutableDeepbookRegistry,
    ownerAddress: account.address
  })

  const createTraderAccountResult =
    await context.signAndExecuteTransactionAndWait(
      createTraderAccountTransaction,
      account
    )

  const traderAccountId = ensureCreatedObject(
    "::executor::TraderAccount",
    createTraderAccountResult
  ).objectId
  const traderAccount = await getTraderAccountOverview(
    traderAccountId,
    context.suiClient
  )
  if (traderAccount.ownerAddress !== account.address) {
    throw new Error(
      `Expected trader account owner ${account.address}, received ${traderAccount.ownerAddress}.`
    )
  }

  const balanceManager = await getSuiSharedObject(
    {
      objectId: traderAccount.balanceManagerId,
      mutable: false
    },
    { suiClient: context.suiClient }
  )
  const mutableDeepbookRegistry = await resolveMutableDeepbookRegistry({
    context,
    deepbookRegistryId
  })

  const registerBalanceManagerTransaction =
    buildRegisterBalanceManagerTransaction({
      ammPackageId,
      traderAccountId,
      balanceManager,
      deepbookRegistry: mutableDeepbookRegistry
    })

  await context.signAndExecuteTransactionAndWait(
    registerBalanceManagerTransaction,
    account
  )

  return traderAccount
}

export const setupRegisteredTraderAccount = async ({
  context,
  account,
  deepbook,
  ammPackageId
}: {
  context: TestContext
  account: TestAccount
  deepbook: DeepbookPublishObjects
  ammPackageId: string
}): Promise<TraderAccountOverview> => {
  await authorizePropAmmInDeepbook({
    context,
    account,
    deepbook,
    ammPackageId
  })
  await initializeDeepbookBalanceManagerMap({
    context,
    account,
    deepbook
  })

  return createAndRegisterTraderAccount({
    context,
    account,
    ammPackageId,
    deepbookRegistryId: deepbook.deepbookRegistryId
  })
}

export const publishAndSetupRegisteredTraderAccount = async ({
  context,
  account
}: {
  context: TestContext
  account: TestAccount
}) => {
  const publishArtifacts = await context.publishPackage("prop-amm", account, {
    withUnpublishedDependencies: true
  })
  const rootPublishArtifact = pickRootNonDependencyArtifact(publishArtifacts)
  const deepbook = await resolveDeepbookPublishObjectsFromDigest({
    publishDigest: rootPublishArtifact.digest,
    suiClient: context.suiClient
  })
  const ammPackageId = rootPublishArtifact.packageId
  const traderAccount = await setupRegisteredTraderAccount({
    context,
    account,
    deepbook,
    ammPackageId
  })

  return {
    ammPackageId,
    deepbook,
    traderAccount
  }
}

export const resolveOwnedFundingCoin = async ({
  context,
  ownerAddress
}: {
  context: TestContext
  ownerAddress: string
}) => {
  const ownedCoins = await fetchCoinBalances(
    { owner: ownerAddress },
    { suiClient: context.suiClient }
  )
  const richestCoin = selectRichestCoin(ownedCoins)

  if (!richestCoin) {
    throw new Error("Expected the funded account to own at least one SUI coin.")
  }

  return richestCoin
}

const resolveEventAssetType = (
  asset: DeepbookBalanceEvent["asset"]
): string | undefined => {
  if (typeof asset === "string") return asset
  if (typeof asset !== "object" || !asset) return undefined
  return typeof asset.name === "string" ? asset.name : undefined
}

const isDeepbookBalanceEvent = (
  value: unknown
): value is DeepbookBalanceEvent => {
  if (!value || typeof value !== "object") return false

  const eventValue = value as {
    balance_manager_id?: unknown
    asset?: unknown
    amount?: unknown
    deposit?: unknown
  }

  const hasBalanceManagerId = typeof eventValue.balance_manager_id === "string"
  const hasAssetType = resolveEventAssetType(
    eventValue.asset as DeepbookBalanceEvent["asset"]
  )
  const hasAmount =
    typeof eventValue.amount === "string" ||
    typeof eventValue.amount === "number"
  const hasDeposit = typeof eventValue.deposit === "boolean"

  return hasBalanceManagerId && Boolean(hasAssetType) && hasAmount && hasDeposit
}

export const resolveBalanceEvent = ({
  events,
  expectedEventType
}: {
  events: SuiTransactionBlockResponse["events"]
  expectedEventType: string
}): DeepbookBalanceEvent => {
  const balanceEvents = (events ?? []).filter(
    (event) => event.type === expectedEventType
  )

  if (balanceEvents.length !== 1) {
    throw new Error(
      `Expected exactly one ${expectedEventType} event, found ${balanceEvents.length}.`
    )
  }

  const [balanceEvent] = balanceEvents
  if (!isDeepbookBalanceEvent(balanceEvent?.parsedJson)) {
    throw new Error(
      `Expected ${expectedEventType} to include balance_manager_id, asset, amount, and deposit fields.`
    )
  }

  return balanceEvent.parsedJson
}

export const expectBalanceEventAssetType = ({
  event,
  expectedAssetType
}: {
  event: DeepbookBalanceEvent
  expectedAssetType: string
}) => {
  const eventAssetType = resolveEventAssetType(event.asset)
  if (!eventAssetType) {
    throw new Error("Balance event did not include a readable asset type.")
  }

  const normalizedEventAssetType = normalizeCoinType(eventAssetType)
  const normalizedExpectedAssetType = normalizeCoinType(expectedAssetType)

  if (normalizedEventAssetType !== normalizedExpectedAssetType) {
    throw new Error(
      `Expected asset ${normalizedExpectedAssetType}, received ${normalizedEventAssetType}.`
    )
  }
}

export const assertDeepbookBalanceEvent = ({
  events,
  expectedEventType,
  expectedBalanceManagerId,
  expectedAmount,
  expectedDeposit,
  expectedAssetType
}: {
  events: SuiTransactionBlockResponse["events"]
  expectedEventType: string
  expectedBalanceManagerId: string
  expectedAmount: string | number | bigint
  expectedDeposit: boolean
  expectedAssetType: string
}) => {
  const parsedBalanceEvent = resolveBalanceEvent({
    events,
    expectedEventType
  })

  if (parsedBalanceEvent.balance_manager_id !== expectedBalanceManagerId) {
    throw new Error(
      `Expected balance manager ${expectedBalanceManagerId}, received ${parsedBalanceEvent.balance_manager_id}.`
    )
  }

  const resolvedExpectedAmount = expectedAmount.toString()
  if (String(parsedBalanceEvent.amount) !== resolvedExpectedAmount) {
    throw new Error(
      `Expected amount ${resolvedExpectedAmount}, received ${String(parsedBalanceEvent.amount)}.`
    )
  }

  if (parsedBalanceEvent.deposit !== expectedDeposit) {
    throw new Error(
      `Expected deposit flag ${String(expectedDeposit)}, received ${String(parsedBalanceEvent.deposit)}.`
    )
  }

  expectBalanceEventAssetType({
    event: parsedBalanceEvent,
    expectedAssetType
  })

  return parsedBalanceEvent
}

export const assertTraderAccountScriptOutputMetadata = ({
  output,
  expectedStatus,
  expectedAmmPackageId,
  expectedTraderAccount
}: {
  output: {
    status: string
    ammPackageId: string
    traderAccount: {
      traderAccountId: string
      balanceManagerId: string
    }
  }
  expectedStatus: string
  expectedAmmPackageId: string
  expectedTraderAccount: Pick<
    TraderAccountOverview,
    "traderAccountId" | "balanceManagerId"
  >
}) => {
  if (output.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus}, received ${output.status}.`
    )
  }
  if (output.ammPackageId !== expectedAmmPackageId) {
    throw new Error(
      `Expected AMM package ${expectedAmmPackageId}, received ${output.ammPackageId}.`
    )
  }
  if (
    output.traderAccount.traderAccountId !==
    expectedTraderAccount.traderAccountId
  ) {
    throw new Error(
      `Expected trader account ${expectedTraderAccount.traderAccountId}, received ${output.traderAccount.traderAccountId}.`
    )
  }
  if (
    output.traderAccount.balanceManagerId !==
    expectedTraderAccount.balanceManagerId
  ) {
    throw new Error(
      `Expected balance manager ${expectedTraderAccount.balanceManagerId}, received ${output.traderAccount.balanceManagerId}.`
    )
  }
}

export const requireScriptSummaryDigest = ({
  digest,
  summaryLabel
}: {
  digest?: string
  summaryLabel: string
}) => {
  if (digest) return digest

  throw new Error(
    `${summaryLabel} summary digest was not returned by the script.`
  )
}
