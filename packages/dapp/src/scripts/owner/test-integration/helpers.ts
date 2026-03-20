import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import type {
  TestAccount,
  TestContext
} from "@sui-amm/tooling-node/testing/localnet"
import {
  createSuiScriptRunner,
  parseJsonFromScriptOutput
} from "@sui-amm/tooling-node/testing/scripts"

export type AmmSeedOutput = {
  ammPackageId?: string
  ammConfig?: AmmConfigOverview
  ammConfigId?: string
  initialSharedVersion?: string
  pythPriceFeedIdHex?: string
  publishDigest?: string
  transactionSummary?: { label?: string }
  didPublish?: boolean
  didCreateAmmConfig?: boolean
}

export type CompleteAmmSeedOutput = AmmSeedOutput & {
  ammPackageId: string
  ammConfig: AmmConfigOverview
  ammConfigId: string
  initialSharedVersion: string
}

export type AmmSeedScriptArguments = {
  json: boolean
  baseSpreadBps?: string
  volatilitySpreadBps?: string
  useLaser?: boolean
  pythPriceFeedId?: string
}

export const parseAmmSeedOutput = (stdout: string) =>
  parseJsonFromScriptOutput<AmmSeedOutput>(stdout, "amm-seed output")

export const requireAmmSeedOutput = (
  output: AmmSeedOutput
): CompleteAmmSeedOutput => {
  if (!output.ammPackageId) {
    throw new Error("amm-seed output did not include ammPackageId.")
  }

  if (!output.ammConfig) {
    throw new Error("amm-seed output did not include ammConfig.")
  }

  if (!output.ammConfigId) {
    throw new Error("amm-seed output did not include ammConfigId.")
  }

  if (!output.initialSharedVersion) {
    throw new Error(
      "amm-seed output did not include the shared version for the config."
    )
  }

  return {
    ...output,
    ammPackageId: output.ammPackageId,
    ammConfig: output.ammConfig,
    ammConfigId: output.ammConfigId,
    initialSharedVersion: output.initialSharedVersion
  }
}

export const runAmmSeedScript = (
  context: TestContext,
  account: TestAccount,
  args: AmmSeedScriptArguments
) =>
  createSuiScriptRunner(context).runOwnerScript("amm-seed", { account, args })
