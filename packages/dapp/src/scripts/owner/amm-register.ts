/**
 * Creates a trader account and registers its balance manager for shared networks.
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
  assertOwnerMatchesSigner,
  logRegistrationResult,
  toRegistrationResultView
} from "../../utils/deepbook-registration-script.ts"
import { createTraderAccountAndRegisterBalanceManager } from "../../utils/deepbook-registration.ts"
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
    assertOwnerMatchesSigner({ ownerAddress, signerAddress })

    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })

    const { deepbookPackageId, deepbookRegistryId } = resolveDeepbookIds({
      networkName: tooling.network.networkName,
      deepbookPackageId: cliArguments.deepbookPackageId,
      deepbookRegistryId: cliArguments.deepbookRegistryId
    })

    const isBalanceManagerMapReady = await isBalanceManagerMapInitialized({
      suiClient: tooling.suiClient,
      deepbookRegistryId,
      deepbookPackageId
    })
    if (!isBalanceManagerMapReady)
      throw new Error(
        "DeepBook registry balance manager map is not initialized. Ask the registry admin to initialize it before registering a balance manager."
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

    const registrationResult =
      await createTraderAccountAndRegisterBalanceManager({
        tooling,
        ammPackageId,
        deepbookRegistryId,
        ownerAddress,
        traderAccountId: cliArguments.traderAccountId,
        devInspect: cliArguments.devInspect,
        dryRun: cliArguments.dryRun
      })

    const registrationResultView = toRegistrationResultView(registrationResult)

    if (
      emitJsonOutput(
        {
          ownerAddress,
          ammPackageId,
          deepbookPackageId,
          deepbookRegistryId,
          ...registrationResultView
        },
        cliArguments.json
      )
    )
      return

    logRegistrationResult({
      ownerAddress,
      ammPackageId,
      deepbookPackageId,
      deepbookRegistryId,
      registrationResult
    })
  },
  withCommonRegistrationOptions(withAmmPackageIdOption(yargs()), {
    includeDebugAlias: true
  })
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
