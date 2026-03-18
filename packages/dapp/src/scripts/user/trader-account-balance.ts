/**
 * Displays the current balances held by a trader account's DeepBook balance manager.
 * Includes withdraw-ready arguments for each asset so users can copy them into
 * the withdrawal script.
 */
import yargs from "yargs"

import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import {
  logEachGreen,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { withAmmPackageIdOption } from "../../utils/register-script-options.ts"
import {
  viewExistingTraderAccountBalance,
  type TraderAccountBalanceResult
} from "../../utils/trader-account-balance.ts"

type TraderAccountBalanceArguments = {
  ammPackageId?: string
  traderAccountId?: string
  json?: boolean
}

const logTraderAccountBalance = ({
  ammPackageId,
  balanceResult
}: {
  ammPackageId: string
  balanceResult: TraderAccountBalanceResult
}) => {
  logKeyValueGreen("Status")(balanceResult.status)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("Owner")(balanceResult.ownerAddress)
  logKeyValueGreen("Trader account")(
    balanceResult.traderAccount.traderAccountId
  )
  logKeyValueGreen("Balance manager")(balanceResult.traderAccount.balanceManagerId)
  logKeyValueGreen("Asset count")(balanceResult.assets.length)
  console.log("")

  if (balanceResult.assets.length === 0) {
    logKeyValueYellow("Assets")(
      "No funded assets were found in this trader account balance manager."
    )
    return
  }

  balanceResult.assets.forEach((asset, index) => {
    logKeyValueGreen("Asset")(index + 1)
    logEachGreen({
      coinType: asset.coinType,
      balance: asset.balance,
      withdrawCoinType: asset.withdrawArguments.coinType,
      withdrawAmount: asset.withdrawArguments.amount,
      withdrawCommand: asset.withdrawCommand
    })
    console.log("")
  })
}

runSuiScript(
  async (tooling, cliArguments: TraderAccountBalanceArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const balanceResult = await viewExistingTraderAccountBalance({
      tooling,
      ammPackageId,
      traderAccountId: cliArguments.traderAccountId
    })

    if (
      emitJsonOutput(
        {
          ammPackageId,
          ...balanceResult
        },
        cliArguments.json
      )
    ) {
      return
    }

    logTraderAccountBalance({
      ammPackageId,
      balanceResult
    })
  },
  withAmmPackageIdOption(yargs())
    .option("traderAccountId", {
      alias: ["trader-account-id"],
      type: "string",
      description:
        "Existing trader account id; when omitted the flow uses the single trader account owned by the active signer.",
      demandOption: false
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
