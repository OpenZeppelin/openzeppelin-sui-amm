/**
 * Localnet-only. Migrates `CoinMetadata<SUI>` into a shared `Currency<SUI>` via
 * `0x2::coin_registry::migrate_legacy_metadata`. SUI predates the coin registry
 * and needs this one-time migration before it can be used as base or quote in a
 * market maker Executor (whose `market::new` requires `&Currency<T>`).
 *
 * Idempotent: if `Currency<SUI>` already exists in the registry the script exits
 * early without submitting a transaction.
 */

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { resolveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import {
  SUI_COIN_REGISTRY_ID,
  SUI_COIN_TYPE
} from "@sui-amm/tooling-core/constants"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import { DEFAULT_TX_GAS_BUDGET } from "@sui-amm/tooling-node/constants"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import { logKeyValueBlue, logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { newTransaction } from "@sui-amm/tooling-node/transactions"

process.env.SUI_NETWORK = "localnet"

type SuiMigrateArgs = {
  force: boolean
}

runSuiScript(
  async (tooling: Tooling, cliArguments: SuiMigrateArgs) => {
    const {
      suiConfig: { network }
    } = tooling
    assertLocalnetNetwork(network.networkName)

    if (!cliArguments.force) {
      const existingCurrencyId = await resolveCurrencyObjectId(
        { coinType: SUI_COIN_TYPE, fallbackRegistryScan: true },
        { suiClient: tooling.suiClient }
      )
      if (existingCurrencyId) {
        logKeyValueBlue("Currency<SUI>")(
          `already registered: ${existingCurrencyId}`
        )
        return
      }
    }

    const suiMetadata = await tooling.suiClient.getCoinMetadata({
      coinType: SUI_COIN_TYPE
    })
    if (!suiMetadata?.id) {
      throw new Error(
        "CoinMetadata<SUI> not found on-chain. Is the Sui framework installed on this network?"
      )
    }
    const suiMetadataId = normalizeSuiObjectId(suiMetadata.id)

    await tooling.ensureFoundedAddress({
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    })

    const registryShared = await tooling.getMutableSharedObject({
      objectId: SUI_COIN_REGISTRY_ID
    })

    const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
    transaction.moveCall({
      target: "0x2::coin_registry::migrate_legacy_metadata",
      typeArguments: [SUI_COIN_TYPE],
      arguments: [
        transaction.sharedObjectRef(registryShared.sharedRef),
        transaction.object(suiMetadataId)
      ]
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const migratedCurrencyId = await resolveCurrencyObjectId(
      { coinType: SUI_COIN_TYPE, fallbackRegistryScan: true },
      { suiClient: tooling.suiClient }
    )

    logKeyValueGreen("migrated")(SUI_COIN_TYPE)
    logKeyValueGreen("metadataId")(suiMetadataId)
    if (migratedCurrencyId) logKeyValueGreen("currencyId")(migratedCurrencyId)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
  },
  yargs()
    .option("force", {
      type: "boolean",
      description:
        "Skip the existence check and always attempt migration (will fail if Currency<SUI> already exists).",
      default: false
    })
    .strict()
)
