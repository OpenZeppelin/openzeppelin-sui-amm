/**
 * Displays the current AMM config snapshot for the target network.
 * Resolves the config id from artifacts when omitted.
 */
import yargs from "yargs"

import {
  collectAmmConfigSnapshot,
  resolveAmmConfigId
} from "@sui-amm/domain-node/amm"
import { emitJsonOutput } from "@sui-amm/tooling-node/json"
import { logKeyValueBlue } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { logAmmConfigOverview } from "../../utils/amm.ts"

type AmmViewArguments = {
  ammConfigId?: string
  json?: boolean
}

type AmmViewContext = {
  networkName: string
  rpcUrl: string
  ammConfigId: string
}

const resolveAmmConfigIdToView = async ({
  networkName,
  cliArguments
}: {
  networkName: string
  cliArguments: AmmViewArguments
}): Promise<string> =>
  resolveAmmConfigId({
    networkName,
    ammConfigId: cliArguments.ammConfigId
  })

const logAmmViewContext = ({
  networkName,
  rpcUrl,
  ammConfigId
}: AmmViewContext) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Config")(ammConfigId)
  console.log("")
}

runSuiScript(
  async (tooling, cliArguments: AmmViewArguments) => {
    const ammConfigId = await resolveAmmConfigIdToView({
      networkName: tooling.network.networkName,
      cliArguments
    })

    const { ammConfigOverview, initialSharedVersion } =
      await collectAmmConfigSnapshot({
        tooling,
        ammConfigId
      })

    if (
      emitJsonOutput(
        {
          ammConfig: ammConfigOverview,
          initialSharedVersion
        },
        cliArguments.json
      )
    )
      return

    logAmmViewContext({
      networkName: tooling.network.networkName,
      rpcUrl: tooling.network.url,
      ammConfigId
    })

    logAmmConfigOverview(ammConfigOverview, { initialSharedVersion })
  },
  yargs()
    .option("ammConfigId", {
      alias: ["amm-config-id", "config-id"],
      type: "string",
      description:
        "AMM config object id; inferred from the latest objects artifact when omitted.",
      demandOption: false
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: "Output results as JSON."
    })
    .strict()
)
