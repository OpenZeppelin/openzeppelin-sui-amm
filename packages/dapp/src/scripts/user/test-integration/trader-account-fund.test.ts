import { describe, expect, it } from "vitest"

import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import { resolvePropAmmAppType } from "@sui-amm/domain-core/models/deepbook"
import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { getTraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import {
  buildAuthorizePropAmmAppTransaction,
  buildCreateTraderAccountTransaction,
  buildInitBalanceManagerMapTransaction,
  buildRegisterBalanceManagerTransaction
} from "@sui-amm/domain-core/ptb/deepbook"
import { selectRichestCoin } from "@sui-amm/tooling-core/coin"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { pickRootNonDependencyArtifact } from "@sui-amm/tooling-node/package"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import type {
  TestAccount,
  TestContext
} from "@sui-amm/tooling-node/testing/localnet"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"
import {
  resolveDeepbookPublishObjectsFromDigest,
  type DeepbookPublishObjects
} from "../../../utils/deepbook.ts"
import type { FundTraderAccountResultView } from "../../../utils/trader-account-funding.ts"

type FundTraderAccountScriptOutput = FundTraderAccountResultView & {
  ammPackageId: string
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
  ) => Parameters<TestContext["signAndExecuteTransaction"]>[0]
}): Promise<SuiTransactionBlockResponse> => {
  const deepbookRegistry = await resolveMutableDeepbookRegistry({
    context,
    deepbookRegistryId: deepbook.deepbookRegistryId
  })
  const transaction = buildTransaction(deepbookRegistry)

  return context.signAndExecuteTransactionAndWait(transaction, account)
}

const authorizePropAmmInDeepbook = async ({
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

const initializeDeepbookBalanceManagerMap = async ({
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

const createAndRegisterTraderAccount = async ({
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

const resolveOwnedFundingCoin = async ({
  context,
  ownerAddress
}: {
  context: TestContext
  ownerAddress: string
}) => {
  const ownedCoins = await context.suiClient.getCoins({
    owner: ownerAddress
  })

  const richestCoin = selectRichestCoin(ownedCoins.data)

  if (!richestCoin) {
    throw new Error("Expected the funded account to own at least one SUI coin.")
  }

  return {
    coinObjectId: richestCoin.coinObjectId,
    balance: BigInt(richestCoin.balance)
  }
}

type DeepbookBalanceEvent = {
  balance_manager_id: string
  amount: string | number
  deposit: boolean
}

const isDeepbookBalanceEvent = (
  value: unknown
): value is DeepbookBalanceEvent => {
  if (!value || typeof value !== "object") return false

  const eventValue = value as {
    balance_manager_id?: unknown
    amount?: unknown
    deposit?: unknown
  }

  const hasBalanceManagerId = typeof eventValue.balance_manager_id === "string"
  const hasAmount =
    typeof eventValue.amount === "string" ||
    typeof eventValue.amount === "number"
  const hasDeposit = typeof eventValue.deposit === "boolean"

  return hasBalanceManagerId && hasAmount && hasDeposit
}

const resolveBalanceEvent = ({
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
      `Expected ${expectedEventType} to include balance_manager_id, amount, and deposit fields.`
    )
  }

  return balanceEvent.parsedJson
}

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("trader-account-fund script", () => {
  it("funds the owned trader account and emits the DeepBook deposit event", async () => {
    await testEnv.withTestContext(
      "user-trader-account-fund",
      async (context) => {
        const trader = context.createAccount("trader")
        await context.fundAccount(trader, { minimumCoinObjects: 3 })

        const publishArtifacts = await context.publishPackage(
          "prop-amm",
          trader,
          { withUnpublishedDependencies: true }
        )
        const rootPublishArtifact =
          pickRootNonDependencyArtifact(publishArtifacts)
        const deepbook = await resolveDeepbookPublishObjectsFromDigest({
          publishDigest: rootPublishArtifact.digest,
          suiClient: context.suiClient
        })

        await authorizePropAmmInDeepbook({
          context,
          account: trader,
          deepbook,
          ammPackageId: rootPublishArtifact.packageId
        })
        await initializeDeepbookBalanceManagerMap({
          context,
          account: trader,
          deepbook
        })

        const traderAccount = await createAndRegisterTraderAccount({
          context,
          account: trader,
          ammPackageId: rootPublishArtifact.packageId,
          deepbookRegistryId: deepbook.deepbookRegistryId
        })
        const fundingCoin = await resolveOwnedFundingCoin({
          context,
          ownerAddress: trader.address
        })
        const fundingAmount = 10_000n

        expect(fundingCoin.balance > fundingAmount).toBe(true)

        const scriptRunner = createSuiScriptRunner(context)
        const result = await scriptRunner.runUserScript("trader-account-fund", {
          account: trader,
          args: {
            ammPackageId: rootPublishArtifact.packageId,
            coinObjectId: fundingCoin.coinObjectId,
            amount: fundingAmount.toString(),
            json: true
          }
        })

        expect(result.exitCode).toBe(0)

        const parsed = parseJsonFromScriptOutput<FundTraderAccountScriptOutput>(
          result.stdout,
          "trader-account-fund output"
        )

        expect(parsed.status).toBe("funded")
        expect(parsed.ammPackageId).toBe(rootPublishArtifact.packageId)
        expect(parsed.traderAccount.traderAccountId).toBe(
          traderAccount.traderAccountId
        )
        expect(parsed.traderAccount.balanceManagerId).toBe(
          traderAccount.balanceManagerId
        )
        expect(parsed.coinObjectId).toBe(fundingCoin.coinObjectId)
        expect(parsed.amount).toBe(fundingAmount.toString())
        expect(parsed.transactionSummaries.prepareSuiGas).toBeUndefined()

        const fundingDigest =
          parsed.transactionSummaries.fundTraderAccount?.digest
        if (!fundingDigest) {
          throw new Error(
            "Funding summary digest was not returned by the script."
          )
        }

        const fundingTransaction = await context.waitForFinality(fundingDigest)
        const parsedBalanceEvent = resolveBalanceEvent({
          events: fundingTransaction.events,
          expectedEventType: `${deepbook.deepbookPackageId}::balance_manager::BalanceEvent`
        })

        expect(parsedBalanceEvent.balance_manager_id).toBe(
          traderAccount.balanceManagerId
        )
        expect(String(parsedBalanceEvent.amount)).toBe(fundingAmount.toString())
        expect(parsedBalanceEvent.deposit).toBe(true)
      }
    )
  })
})
