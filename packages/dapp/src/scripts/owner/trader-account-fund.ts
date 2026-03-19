/**
 * Funds the AMM owner's trader account by depositing a selected coin.
 */
import yargs from "yargs"

import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import {
  fetchCoinBalances,
  normalizeCoinType,
  selectRichestCoin
} from "@sui-amm/tooling-core/coin"
import { parsePositiveU64 } from "@sui-amm/tooling-core/utils/utility"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { resolveAmmAdminCapIdForSigner } from "../../utils/amm.ts"
import { withAmmPackageIdOption } from "../../utils/register-script-options.ts"
import {
  fundExistingTraderAccount,
  toFundTraderAccountResultView,
  type FundTraderAccountResult
} from "../../utils/trader-account-funding.ts"

type FundTraderAccountArguments = {
  ammPackageId?: string
  ammAdminCapId?: string
  coinType?: string
  coinObjectId?: string
  amount: string
  devInspect?: boolean
  dryRun?: boolean
  json?: boolean
}

const resolveFundingCoinObjectId = async ({
  tooling,
  coinType,
  coinObjectId,
  amount
}: {
  tooling: {
    loadedEd25519KeyPair: { toSuiAddress: () => string }
    suiClient: Parameters<typeof fetchCoinBalances>[1]["suiClient"]
  }
  coinType?: string
  coinObjectId?: string
  amount: string
}) => {
  if (coinObjectId) {
    return coinObjectId
  }

  if (!coinType) {
    throw new Error(
      "Either --coin-type or --coin-object-id must be provided to fund a trader account."
    )
  }

  const normalizedCoinType = normalizeCoinType(coinType)
  const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
  const fundingAmount = parsePositiveU64(amount, "Funding amount")
  const ownedCoins = await fetchCoinBalances(
    {
      owner: signerAddress,
      coinType: normalizedCoinType
    },
    { suiClient: tooling.suiClient }
  )
  const richestOwnedCoin = selectRichestCoin(ownedCoins)

  if (!richestOwnedCoin) {
    throw new Error(
      `No coin objects for ${normalizedCoinType} were found for signer ${signerAddress}.`
    )
  }

  if (richestOwnedCoin.balance < fundingAmount) {
    throw new Error(
      `No single ${normalizedCoinType} coin can cover funding amount ${fundingAmount.toString()}. Merge coins or provide --coin-object-id.`
    )
  }

  return richestOwnedCoin.coinObjectId
}

const logFundingResult = ({
  ammPackageId,
  ammAdminCapId,
  fundingResult
}: {
  ammPackageId: string
  ammAdminCapId: string
  fundingResult: FundTraderAccountResult
}) => {
  logKeyValueGreen("Status")(fundingResult.status)
  logKeyValueGreen("AMM package")(ammPackageId)
  logKeyValueGreen("AMM admin cap")(ammAdminCapId)
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
    const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const ammAdminCapId = await resolveAmmAdminCapIdForSigner({
      tooling,
      ammPackageId,
      signerAddress,
      ammAdminCapId: cliArguments.ammAdminCapId
    })
    const fundingCoinObjectId = await resolveFundingCoinObjectId({
      tooling,
      coinType: cliArguments.coinType,
      coinObjectId: cliArguments.coinObjectId,
      amount: cliArguments.amount
    })

    const fundingResult = await fundExistingTraderAccount({
      tooling,
      ammPackageId,
      ammAdminCapId,
      coinObjectId: fundingCoinObjectId,
      amount: cliArguments.amount,
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    if (
      emitJsonOutput(
        {
          ammPackageId,
          ammAdminCapId,
          ...toFundTraderAccountResultView(fundingResult)
        },
        cliArguments.json
      )
    ) {
      return
    }

    logFundingResult({
      ammPackageId,
      ammAdminCapId,
      fundingResult
    })
  },
  withAmmPackageIdOption(yargs())
    .option("ammAdminCapId", {
      alias: ["amm-admin-cap-id", "admin-cap-id"],
      type: "string",
      description:
        "AMM admin cap id; defaults to the signer-owned admin cap for the selected package when omitted.",
      demandOption: false
    })
    .option("coinType", {
      alias: ["coin-type"],
      type: "string",
      description:
        "Coin type to fund with (for example 0x2::sui::SUI). The script selects a matching owned coin object automatically.",
      demandOption: false
    })
    .option("coinObjectId", {
      alias: ["coin-object-id"],
      type: "string",
      description:
        "Optional explicit coin object id override for funding. When omitted, the script resolves one from --coin-type.",
      demandOption: false
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
