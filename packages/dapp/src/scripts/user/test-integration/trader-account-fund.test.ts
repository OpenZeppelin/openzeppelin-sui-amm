import { describe, expect, it } from "vitest"

import { NORMALIZED_SUI_COIN_TYPE } from "@sui-amm/tooling-node/constants"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import type { FundTraderAccountResultView } from "../../../utils/trader-account-funding.ts"
import {
  assertDeepbookBalanceEvent,
  assertTraderAccountScriptOutputMetadata,
  publishAndSetupRegisteredTraderAccount,
  requireScriptSummaryDigest,
  resolveOwnedFundingCoin
} from "./helpers.ts"

type FundTraderAccountScriptOutput = FundTraderAccountResultView & {
  ammPackageId: string
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

        const { ammPackageId, deepbook, traderAccount } =
          await publishAndSetupRegisteredTraderAccount({
            context,
            account: trader
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
            ammPackageId,
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

        assertTraderAccountScriptOutputMetadata({
          output: parsed,
          expectedStatus: "funded",
          expectedAmmPackageId: ammPackageId,
          expectedTraderAccount: {
            traderAccountId: traderAccount.traderAccountId,
            balanceManagerId: traderAccount.balanceManagerId
          }
        })
        expect(parsed.coinObjectId).toBe(fundingCoin.coinObjectId)
        expect(parsed.amount).toBe(fundingAmount.toString())
        expect(parsed.transactionSummaries.prepareSuiGas).toBeUndefined()

        const fundingDigest = requireScriptSummaryDigest({
          digest: parsed.transactionSummaries.fundTraderAccount?.digest,
          summaryLabel: "Funding"
        })

        const fundingTransaction = await context.waitForFinality(fundingDigest)
        assertDeepbookBalanceEvent({
          events: fundingTransaction.events,
          expectedEventType: `${deepbook.deepbookPackageId}::balance_manager::BalanceEvent`,
          expectedBalanceManagerId: traderAccount.balanceManagerId,
          expectedAmount: fundingAmount,
          expectedDeposit: true,
          expectedAssetType: NORMALIZED_SUI_COIN_TYPE
        })
      }
    )
  })
})
