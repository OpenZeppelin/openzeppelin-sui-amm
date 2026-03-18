/**
 * Prints coin balances for an address, including object counts per coin type.
 * On Sui, a "balance" is the sum of many Coin objects.
 * Helpful for spotting fragmentation before building a PTB.
 */
import yargs from "yargs"

import type { SuiClient } from "@mysten/sui/client"
import type { CoinBalanceSummary } from "@sui-amm/tooling-core/address"
import { fetchCoinBalances } from "@sui-amm/tooling-core/coin"
import { resolveOwnerAddress } from "@sui-amm/tooling-node/account"
import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"

type CoinBalancesCliArgs = {
  address?: string
}

type CoinBalanceDetails = CoinBalanceSummary & {
  coinObjectIds: string[]
}

const MAX_LOGGED_COIN_OBJECT_IDS = 5

runSuiScript<CoinBalancesCliArgs>(
  async (tooling, _cliArguments) => {
    const addressToInspect = await resolveOwnerAddress(
      _cliArguments.address,
      tooling.network
    )

    logInspectionContext({
      address: addressToInspect,
      rpcUrl: tooling.network.url,
      networkName: tooling.network.networkName
    })

    const balances = await tooling.getCoinBalances({
      address: addressToInspect
    })

    const balancesWithCoinObjectIds = await resolveCoinBalanceDetails({
      address: addressToInspect,
      balances,
      suiClient: tooling.suiClient
    })

    logCoinBalances(balancesWithCoinObjectIds)
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

const resolveCoinBalanceDetails = async ({
  address,
  balances,
  suiClient
}: {
  address: string
  balances: CoinBalanceSummary[]
  suiClient: SuiClient
}): Promise<CoinBalanceDetails[]> =>
  Promise.all(
    balances.map(async (balance): Promise<CoinBalanceDetails> => {
      const ownedCoins = await fetchCoinBalances(
        {
          owner: address,
          coinType: balance.coinType
        },
        { suiClient }
      )

      return {
        ...balance,
        coinObjectIds: ownedCoins.map((coin) => coin.coinObjectId)
      }
    })
  )

const logCoinBalances = (balances: CoinBalanceDetails[]) => {
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
      coinObjectIds: formatCoinObjectIds(balance.coinObjectIds),
      "": ""
    })
  )
}

const logInspectionContext = ({
  address,
  rpcUrl,
  networkName
}: {
  address: string
  rpcUrl: string
  networkName: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue("Address")(address)
  console.log("")
}

const formatBigInt = (value: bigint) => value.toString()

const formatCoinObjectIds = (coinObjectIds: string[]) => {
  if (coinObjectIds.length === 0) return "none"
  if (coinObjectIds.length <= MAX_LOGGED_COIN_OBJECT_IDS) {
    return coinObjectIds.join(", ")
  }

  const visibleCoinObjectIds = coinObjectIds
    .slice(0, MAX_LOGGED_COIN_OBJECT_IDS)
    .join(", ")
  const hiddenCoinObjectCount =
    coinObjectIds.length - MAX_LOGGED_COIN_OBJECT_IDS

  return `${visibleCoinObjectIds} (+${hiddenCoinObjectCount} more)`
}
