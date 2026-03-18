/**
 * Funds an existing trader account by depositing a selected coin object into
 * the linked DeepBook balance manager.
 */
import yargs from "yargs"

import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { withAmmPackageIdOption } from "../../utils/register-script-options.ts"
import {
  fundExistingTraderAccount,
  toFundTraderAccountResultView,
  type FundTraderAccountResult
} from "../../utils/trader-account-funding.ts"

type FundTraderAccountArguments = {
  ammPackageId?: string
  traderAccountId?: string
  coinObjectId: string
  amount: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

const logFundingResult = ({
  ammPackageId,
  fundingResult
}: {
  ammPackageId: string
  fundingResult: FundTraderAccountResult
}) => {
  logKeyValueGreen("Status")(fundingResult.status)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("Trader account")(
    fundingResult.traderAccount.traderAccountId
  )
  logKeyValueGreen("Balance manager")(
    fundingResult.traderAccount.balanceManagerId
  )
  logKeyValueGreen("Funding coin")(fundingResult.coinObjectId)
  logKeyValueGreen("Coin type")(fundingResult.coinType)
  logKeyValueGreen("Amount")(fundingResult.amount)

  if (fundingResult.note) {
    logKeyValueGreen("Note")(fundingResult.note)
  }

  if (fundingResult.transactionSummaries.prepareSuiGas) {
    logKeyValueGreen("Prepare SUI gas")(
      fundingResult.transactionSummaries.prepareSuiGas.label ??
        "prepare-sui-gas-coin"
    )
  }

  if (fundingResult.transactionSummaries.fundTraderAccount) {
    logKeyValueGreen("Funding summary")(
      fundingResult.transactionSummaries.fundTraderAccount.label ??
        "fund-trader-account"
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: FundTraderAccountArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const fundingResult = await fundExistingTraderAccount({
      tooling,
      ammPackageId,
      traderAccountId: cliArguments.traderAccountId,
      coinObjectId: cliArguments.coinObjectId,
      amount: cliArguments.amount,
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (
      emitJsonOutput(
        {
          ammPackageId,
          ...toFundTraderAccountResultView(fundingResult)
        },
        cliArguments.json
      )
    ) {
      return
    }

    logFundingResult({
      ammPackageId,
      fundingResult
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
    .option("coinObjectId", {
      alias: ["coin-object-id"],
      type: "string",
      description:
        "Coin object id to fund with. On localnet, inspect coin object ids with `pnpm dapp chain:describe-coin-balances --address <signer>` and mock setup artifacts when using mock assets.",
      demandOption: true
    })
    .option("amount", {
      type: "string",
      description: "Funding amount in base units (u64).",
      demandOption: true
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
