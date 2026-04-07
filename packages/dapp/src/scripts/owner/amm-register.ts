/**
 * Resolves or creates a market maker for shared networks.
 */
import yargs from "yargs"

import {
  isBalanceManagerMapInitialized,
  isPropAmmAppAuthorizedInRegistry,
  resolveDeepbookNetworkIds,
  resolveDeepbookPackageId,
  resolveDeepbookRegistryId
} from "@sui-amm/domain-core/models/deepbook"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import {
  resolveOwnerAddress,
  resolveSignerAddress
} from "@sui-amm/tooling-node/account"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  logTraderAccountResult,
  toTraderAccountResultView
} from "../../utils/deepbook-registration-script.ts"
import { resolveSignerAmmAdminCapId } from "../../utils/amm.ts"
import { resolveOrCreateTraderAccount } from "../../utils/deepbook-registration.ts"
import {
  withAdminCapIdOption,
  withAmmPackageIdOption,
  withCommonRegistrationOptions
} from "../../utils/register-script-options.ts"

type RegisterAmmCliArgs = {
  ammPackageId?: string
  adminCapId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  ownerAddress?: string
  traderAccountId?: string
  devInspect?: boolean
  dryRun?: boolean
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
    const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const { deepbookPackageId, deepbookRegistryId } = resolveDeepbookIds({
      networkName: tooling.network.networkName,
      deepbookPackageId: cliArguments.deepbookPackageId,
      deepbookRegistryId: cliArguments.deepbookRegistryId
    })

    let resolvedAdminCapId: string | undefined

    const traderAccountResult = await resolveOrCreateTraderAccount({
      tooling,
      ammPackageId,
      resolveCreateDependencies: async () => {
        const isBalanceManagerMapReady = await isBalanceManagerMapInitialized({
          suiClient: tooling.suiClient,
          deepbookRegistryId,
          deepbookPackageId
        })
        if (!isBalanceManagerMapReady)
          throw new Error(
            "DeepBook registry balance manager map is not initialized. Ask the registry admin to initialize it before creating market makers."
          )

        const isAuthorized = await isPropAmmAppAuthorizedInRegistry({
          suiClient: tooling.suiClient,
          deepbookRegistryId,
          deepbookPackageId,
          ammPackageId
        })

        if (!isAuthorized)
          throw new Error(
            "PropAmmApp is not authorized in the DeepBook registry. Request authorization from the registry admin before proceeding."
          )

        resolvedAdminCapId ??= await resolveSignerAmmAdminCapId({
          tooling,
          ammPackageId,
          signerAddress,
          adminCapId: cliArguments.adminCapId
        })

        return { adminCapId: resolvedAdminCapId }
      },
      deepbookRegistryId,
      ownerAddress,
      traderAccountId: cliArguments.traderAccountId,
      devInspect: cliArguments.devInspect,
      dryRun: cliArguments.dryRun
    })

    const traderAccountResultView =
      toTraderAccountResultView(traderAccountResult)

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          adminCapId: resolvedAdminCapId,
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
      adminCapId: resolvedAdminCapId,
      deepbookPackageId,
      deepbookRegistryId,
      traderAccountResult
    })
  },
  withAdminCapIdOption(
    withCommonRegistrationOptions(withAmmPackageIdOption(yargs()), {
      includeDebugAlias: true
    })
  )
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
