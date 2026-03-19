import { describe, expect, it } from "vitest"

import {
  getBalanceManagerAssetBalances,
  type TraderAccountAssetBalance
} from "@sui-amm/domain-core/models/traderAccount"
import { normalizeCoinType } from "@sui-amm/tooling-core/coin"
import { NORMALIZED_SUI_COIN_TYPE } from "@sui-amm/tooling-node/constants"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import type { WithdrawTraderAccountResultView } from "../../../utils/trader-account-withdrawal.ts"
import {
  assertDeepbookBalanceEvent,
  assertTraderAccountScriptOutputMetadata,
  publishAndSetupRegisteredTraderAccount,
  requireScriptSummaryDigest,
  resolveOwnedFundingCoin
} from "./helpers.ts"

type WithdrawTraderAccountScriptOutput = WithdrawTraderAccountResultView & {
  ammPackageId: string
}

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

const resolveBalanceByCoinType = ({
  balances,
  coinType
}: {
  balances: TraderAccountAssetBalance[]
  coinType: string
}) =>
  balances.find(
    (assetBalance) =>
      normalizeCoinType(assetBalance.coinType) === normalizeCoinType(coinType)
  )?.balance ?? 0n

describe("trader-account-withdraw script", () => {
  it("withdraws from the owned trader account and emits the DeepBook withdrawal event", async () => {
    await testEnv.withTestContext(
      "owner-trader-account-withdraw",
      async (context) => {
        const trader = context.createAccount("trader")
        await context.fundAccount(trader, { minimumCoinObjects: 3 })

        const { ammPackageId, ammAdminCapId, deepbook, traderAccount } =
          await publishAndSetupRegisteredTraderAccount({
            context,
            account: trader
          })
        const fundingCoin = await resolveOwnedFundingCoin({
          context,
          ownerAddress: trader.address
        })
        const seedFundingAmount = 20_000n
        const withdrawAmount = 7_000n
        expect(fundingCoin.balance > seedFundingAmount).toBe(true)

        const scriptRunner = createSuiScriptRunner(context)
        const fundingResult = await scriptRunner.runOwnerScript(
          "trader-account-fund",
          {
            account: trader,
            args: {
              ammPackageId,
              ammAdminCapId,
              coinObjectId: fundingCoin.coinObjectId,
              amount: seedFundingAmount.toString(),
              json: true
            }
          }
        )
        expect(fundingResult.exitCode).toBe(0)

        const balancesBeforeWithdraw = await getBalanceManagerAssetBalances(
          traderAccount.balanceManagerId,
          context.suiClient
        )
        const suiBalanceBeforeWithdraw = resolveBalanceByCoinType({
          balances: balancesBeforeWithdraw,
          coinType: NORMALIZED_SUI_COIN_TYPE
        })
        expect(suiBalanceBeforeWithdraw >= withdrawAmount).toBe(true)

        const withdrawResult = await scriptRunner.runOwnerScript(
          "trader-account-withdraw",
          {
            account: trader,
            args: {
              ammPackageId,
              coinType: NORMALIZED_SUI_COIN_TYPE,
              amount: withdrawAmount.toString(),
              json: true
            }
          }
        )
        expect(withdrawResult.exitCode).toBe(0)

        const parsedWithdrawResult =
          parseJsonFromScriptOutput<WithdrawTraderAccountScriptOutput>(
            withdrawResult.stdout,
            "trader-account-withdraw output"
          )
        assertTraderAccountScriptOutputMetadata({
          output: parsedWithdrawResult,
          expectedStatus: "withdrawn",
          expectedAmmPackageId: ammPackageId,
          expectedTraderAccount: {
            traderAccountId: traderAccount.traderAccountId,
            balanceManagerId: traderAccount.balanceManagerId
          }
        })
        expect(parsedWithdrawResult.coinType).toBe(NORMALIZED_SUI_COIN_TYPE)
        expect(parsedWithdrawResult.amount).toBe(withdrawAmount.toString())
        expect(parsedWithdrawResult.recipientAddress).toBe(trader.address)

        const withdrawalDigest = requireScriptSummaryDigest({
          digest:
            parsedWithdrawResult.transactionSummaries.withdrawTraderAccount
              ?.digest,
          summaryLabel: "Withdrawal"
        })

        const withdrawalTransaction =
          await context.waitForFinality(withdrawalDigest)
        assertDeepbookBalanceEvent({
          events: withdrawalTransaction.events,
          expectedEventType: `${deepbook.deepbookPackageId}::balance_manager::BalanceEvent`,
          expectedBalanceManagerId: traderAccount.balanceManagerId,
          expectedAmount: withdrawAmount,
          expectedDeposit: false,
          expectedAssetType: NORMALIZED_SUI_COIN_TYPE
        })

        const balancesAfterWithdraw = await getBalanceManagerAssetBalances(
          traderAccount.balanceManagerId,
          context.suiClient
        )
        const suiBalanceAfterWithdraw = resolveBalanceByCoinType({
          balances: balancesAfterWithdraw,
          coinType: NORMALIZED_SUI_COIN_TYPE
        })
        expect(suiBalanceAfterWithdraw).toBe(
          suiBalanceBeforeWithdraw - withdrawAmount
        )
      }
    )
  })
})
