/**
 * Creates a shared Counter object and its owner capability.
 * Intended as a domain-neutral fixture for integration tests.
 */
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import {
  newTransaction,
  requireCreatedArtifactIdBySuffix
} from "@sui-amm/tooling-node/transactions"

type CounterCreateCliArgs = {
  counterPackageId: string
  label: string
  json?: boolean
}

const encodeCounterLabel = (label: string) => {
  if (!label.trim()) throw new Error("Counter label cannot be empty.")
  return new TextEncoder().encode(label)
}

runSuiScript<CounterCreateCliArgs>(
  async (tooling, cliArguments) => {
    const packageId = normalizeSuiObjectId(cliArguments.counterPackageId)
    const transaction = newTransaction()

    transaction.moveCall({
      target: `${packageId}::counter::create_counter`,
      arguments: [
        transaction.pure.vector("u8", encodeCounterLabel(cliArguments.label))
      ]
    })

    const { objectArtifacts } = await tooling.signAndExecute({
      transaction,
      signer: tooling.loadedEd25519KeyPair,
      requestType: "WaitForLocalExecution",
      assertSuccess: true
    })

    const counterId = requireCreatedArtifactIdBySuffix({
      createdArtifacts: objectArtifacts.created,
      suffix: "::counter::Counter",
      label: "Counter"
    })
    const ownerCapId = requireCreatedArtifactIdBySuffix({
      createdArtifacts: objectArtifacts.created,
      suffix: "::counter::CounterOwnerCap",
      label: "CounterOwnerCap"
    })

    emitJsonOutput(
      {
        counterOverview: {
          counterId,
          ownerCapId
        }
      },
      cliArguments.json
    )
  },
  yargs()
    .option("counterPackageId", {
      type: "string",
      demandOption: true,
      description: "Package ID for the counter module."
    })
    .option("label", {
      type: "string",
      demandOption: true,
      description: "Counter label."
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Emit JSON output."
    })
    .strict()
)
