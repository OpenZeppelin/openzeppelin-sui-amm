import { extractInitialSharedVersion } from "@sui-amm/tooling-core/shared-object"
import type { TestContext } from "@sui-amm/tooling-node/testing/localnet"

export const resolveOnChainSharedVersion = async (
  context: TestContext,
  ammConfigId: string
) => {
  const objectResponse = await context.suiClient.getObject({
    id: ammConfigId,
    options: { showOwner: true }
  })
  if (!objectResponse.data) {
    throw new Error("AMM config object could not be loaded from localnet.")
  }

  return extractInitialSharedVersion(objectResponse.data)
}
