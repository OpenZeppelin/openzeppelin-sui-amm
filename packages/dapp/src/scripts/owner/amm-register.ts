/**
 * Resolves the market maker for shared networks.
 */
import yargs from "yargs"

import {
  resolveDeepbookNetworkIds,
  resolveDeepbookPackageId,
  resolveDeepbookRegistryId
} from "@sui-amm/domain-core/models/deepbook"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { resolveOwnerAddress } from "@sui-amm/tooling-node/account"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  logTraderAccountResult,
  toTraderAccountResultView
} from "../../utils/deepbook-registration-script.ts"
import { resolveTraderAccount } from "../../utils/deepbook-registration.ts"
import {
  withAmmPackageIdOption,
  withCommonRegistrationOptions
} from "../../utils/register-script-options.ts"

type RegisterAmmCliArgs = {
  ammPackageId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  ownerAddress?: string
  traderAccountId?: string
  json?: boolean
}

const buildDeepbookPackageIdErrorMessage = (networkName: string) =>
  `DeepBook package id is required for ${networkName}. Provide --deepbook-package-id.`

const buildDeepbookRegistryIdErrorMessage = (networkName: string) =>
  `DeepBook registry id is required for ${networkName}. Provide --deepbook-registry-id.`

const resolveDeepbookIds = ({
  networkName,
  deepbookPackageId,
  deepbookRegistryId
}: {
  networkName: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
}): { deepbookPackageId: string; deepbookRegistryId: string } => {
  const deepbookNetworkIds = resolveDeepbookNetworkIds(networkName)

  return {
    deepbookPackageId: resolveDeepbookPackageId(
      deepbookPackageId ?? deepbookNetworkIds?.packageId,
      buildDeepbookPackageIdErrorMessage(networkName)
    ),
    deepbookRegistryId: resolveDeepbookRegistryId(
      deepbookRegistryId ?? deepbookNetworkIds?.registryId,
      buildDeepbookRegistryIdErrorMessage(networkName)
    )
  }
}

runSuiScript(
  async (tooling, cliArguments: RegisterAmmCliArgs) => {
    const ownerAddress = await resolveOwnerAddress(
      cliArguments.ownerAddress,
      tooling.suiConfig.network
    )

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const { deepbookPackageId, deepbookRegistryId } = resolveDeepbookIds({
      networkName: tooling.network.networkName,
      deepbookPackageId: cliArguments.deepbookPackageId,
      deepbookRegistryId: cliArguments.deepbookRegistryId
    })

    const traderAccountResult = await resolveTraderAccount({
      tooling,
      ammPackageId,
      ownerAddress,
      traderAccountId: cliArguments.traderAccountId
    })

    const traderAccountResultView =
      toTraderAccountResultView(traderAccountResult)

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          deepbookPackageId,
          deepbookRegistryId,
          ...traderAccountResultView
        },
        cliArguments.json
      )
    )
      return

    logTraderAccountResult({
      ownerAddress,
      ammPackageId,
      deepbookPackageId,
      deepbookRegistryId,
      traderAccountResult
    })
  },
  withCommonRegistrationOptions(withAmmPackageIdOption(yargs()))
    .option("deepbookPackageId", {
      alias: ["deepbook-package-id"],
      type: "string",
      description:
        "DeepBook package id (defaults to known mainnet/testnet package ids when omitted).",
      demandOption: false
    })
    .option("deepbookRegistryId", {
      alias: ["deepbook-registry-id"],
      type: "string",
      description:
        "DeepBook registry id (defaults to known mainnet/testnet registry ids when omitted).",
      demandOption: false
    })
    .strict()
)
