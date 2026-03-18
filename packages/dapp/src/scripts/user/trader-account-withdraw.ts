/**
 * Withdraws funds from an existing trader account into a recipient address.
 */
import yargs from "yargs"

import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { withAmmPackageIdOption } from "../../utils/register-script-options.ts"
import {
  withdrawFromExistingTraderAccount,
  toWithdrawTraderAccountResultView,
  type WithdrawTraderAccountResult
} from "../../utils/trader-account-withdrawal.ts"

type WithdrawTraderAccountArguments = {
  ammPackageId?: string
  traderAccountId?: string
  coinType: string
  amount: string
  recipientAddress?: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

const logWithdrawalResult = ({
  ammPackageId,
  withdrawalResult
}: {
  ammPackageId: string
  withdrawalResult: WithdrawTraderAccountResult
}) => {
  logKeyValueGreen("Status")(withdrawalResult.status)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("Trader account")(
    withdrawalResult.traderAccount.traderAccountId
  )
  logKeyValueGreen("Balance manager")(
    withdrawalResult.traderAccount.balanceManagerId
  )
  logKeyValueGreen("Coin type")(withdrawalResult.coinType)
  logKeyValueGreen("Amount")(withdrawalResult.amount)
  logKeyValueGreen("Recipient")(withdrawalResult.recipientAddress)
  if (withdrawalResult.transactionSummaries.withdrawTraderAccount) {
    logKeyValueGreen("Withdrawal summary")(
      withdrawalResult.transactionSummaries.withdrawTraderAccount.label ??
        "withdraw-trader-account"
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: WithdrawTraderAccountArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const withdrawalResult = await withdrawFromExistingTraderAccount({
      tooling,
      ammPackageId,
      traderAccountId: cliArguments.traderAccountId,
      coinType: cliArguments.coinType,
      amount: cliArguments.amount,
      recipientAddress: cliArguments.recipientAddress,
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (
      emitJsonOutput(
        {
          ammPackageId,
          ...toWithdrawTraderAccountResultView(withdrawalResult)
        },
        cliArguments.json
      )
    ) {
      return
    }

    logWithdrawalResult({
      ammPackageId,
      withdrawalResult
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
    .option("coinType", {
      alias: ["coin-type"],
      type: "string",
      description: "Coin type to withdraw (for example 0x2::sui::SUI).",
      demandOption: true
    })
    .option("amount", {
      type: "string",
      description: "Withdrawal amount in base units (u64).",
      demandOption: true
    })
    .option("recipientAddress", {
      alias: ["recipient-address"],
      type: "string",
      description:
        "Recipient address for withdrawn funds. Defaults to the active signer.",
      demandOption: false
    })
    .option("devInspect", {
      alias: ["dev-inspect", "debug"],
      type: "boolean",
      default: false,
      description: "Run a dev-inspect and log VM error details."
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: "Run dev-inspect and exit without executing the transaction."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
