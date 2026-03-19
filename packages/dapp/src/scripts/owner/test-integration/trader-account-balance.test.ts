import { describe, expect, it } from "vitest"

import { normalizeCoinType } from "@sui-amm/tooling-core/coin"
import { NORMALIZED_SUI_COIN_TYPE } from "@sui-amm/tooling-node/constants"
import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"
import { resolveDappMoveRoot } from "@sui-amm/tooling-node/testing/paths"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"
import type { TraderAccountBalanceResult } from "../../../utils/trader-account-balance.ts"
import {
  assertTraderAccountScriptOutputMetadata,
  publishAndSetupRegisteredTraderAccount,
  resolveOwnedFundingCoin
} from "./helpers.ts"

type TraderAccountBalanceScriptOutput = TraderAccountBalanceResult & {
  ammPackageId: string
}

const testEnv = createSuiLocalnetTestEnv({
  mode: "test",
  moveSourceRootPath: resolveDappMoveRoot()
})

describe("trader-account-balance script", () => {
  it("renders funded balance-manager assets with withdraw-ready arguments", async () => {
    await testEnv.withTestContext(
      "owner-trader-account-balance",
      async (context) => {
        const trader = context.createAccount("trader")
        await context.fundAccount(trader, { minimumCoinObjects: 3 })

        const { ammPackageId, ammAdminCapId, traderAccount } =
          await publishAndSetupRegisteredTraderAccount({
            context,
            account: trader
          })
        const fundingCoin = await resolveOwnedFundingCoin({
          context,
          ownerAddress: trader.address
        })
        const fundingAmount = 13_000n
        expect(fundingCoin.balance > fundingAmount).toBe(true)

        const scriptRunner = createSuiScriptRunner(context)
        const fundResult = await scriptRunner.runOwnerScript(
          "trader-account-fund",
          {
            account: trader,
            args: {
              ammPackageId,
              ammAdminCapId,
              coinObjectId: fundingCoin.coinObjectId,
              amount: fundingAmount.toString(),
              json: true
            }
          }
        )
        expect(fundResult.exitCode).toBe(0)

        const balanceResult = await scriptRunner.runOwnerScript(
          "test-integration/trader-account-balance",
          {
            account: trader,
            args: {
              ammPackageId,
              json: true
            }
          }
        )
        expect(balanceResult.exitCode).toBe(0)

        const parsedBalanceResult =
          parseJsonFromScriptOutput<TraderAccountBalanceScriptOutput>(
            balanceResult.stdout,
            "trader-account-balance output"
          )

        assertTraderAccountScriptOutputMetadata({
          output: parsedBalanceResult,
          expectedStatus: "loaded",
          expectedAmmPackageId: ammPackageId,
          expectedTraderAccount: {
            traderAccountId: traderAccount.traderAccountId,
            balanceManagerId: traderAccount.balanceManagerId
          }
        })
        expect(parsedBalanceResult.ownerAddress).toBe(trader.address)

        const suiAsset = parsedBalanceResult.assets.find(
          (asset) =>
            normalizeCoinType(asset.coinType) ===
            normalizeCoinType(NORMALIZED_SUI_COIN_TYPE)
        )
        if (!suiAsset) {
          throw new Error(
            "Expected trader-account-balance output to include SUI."
          )
        }

        expect(suiAsset.balance).toBe(fundingAmount.toString())
        expect(suiAsset.withdrawArguments.coinType).toBe(
          NORMALIZED_SUI_COIN_TYPE
        )
        expect(suiAsset.withdrawArguments.amount).toBe(fundingAmount.toString())
      }
    )
  })
})
