/**
 * Prints coin balances for an address, including object counts per coin type.
 * On Sui, a "balance" is the sum of many Coin objects.
 * Helpful for spotting fragmentation before building a PTB.
 */
import yargs from "yargs"

import { resolveOwnerAddress } from "@sui-amm/tooling-node/account"
import {
  logEachGreen,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { formatBigInt, logChainContext } from "./utils.ts"

type CoinBalancesCliArgs = {
  address?: string
}

type CoinBalanceSummary = {
  coinType: string
  coinObjectCount: number
  totalBalance: bigint
  lockedBalanceTotal: bigint
}

runSuiScript<CoinBalancesCliArgs>(
  async (tooling, _cliArguments) => {
    const addressToInspect = await resolveOwnerAddress(
      _cliArguments.address,
      tooling.network
    )

    logChainContext({
      networkName: tooling.network.networkName,
      rpcUrl: tooling.network.url,
      subjectLabel: "Address",
      subjectValue: addressToInspect
    })

    const balances = await tooling.getCoinBalances({
      address: addressToInspect
    })

    logCoinBalances(balances)
  },
  yargs()
    .option("address", {
      type: "string",
      description:
        "Address to inspect. Defaults to the configured account when omitted.",
      demandOption: false
    })
    .strict()
)

const logCoinBalances = (balances: CoinBalanceSummary[]) => {
  const sortedBalances = [...balances].sort((left, right) =>
    left.coinType.localeCompare(right.coinType)
  )

  logKeyValueGreen("Coin types")(sortedBalances.length)
  console.log("")

  if (sortedBalances.length === 0) {
    logKeyValueYellow("Coins")("No coin balances found for this address.")
    return
  }

  sortedBalances.forEach((balance) =>
    logEachGreen({
      coinType: balance.coinType,
      objects: balance.coinObjectCount,
      total: formatBigInt(balance.totalBalance),
      locked: formatBigInt(balance.lockedBalanceTotal),
      "": ""
    })
  )
}

// formatBigInt provided by chain utils
