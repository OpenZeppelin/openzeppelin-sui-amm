/**
 * Prints coin balances for an address, including object counts per coin type.
 * On Sui, a "balance" is the sum of many Coin objects.
 * Helpful for spotting fragmentation before building a PTB.
 */
import { setTimeout as delay } from "node:timers/promises"
import yargs from "yargs"

import type { SuiClient } from "@mysten/sui/client"
import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { CoinBalanceSummary } from "@sui-amm/tooling-core/address"
import { fetchCoinBalances } from "@sui-amm/tooling-core/coin"
import { resolveOwnerAddress } from "@sui-amm/tooling-node/account"
import {
  logEachGreen,
  logKeyValueBlue,
  logKeyValueGreen,
  logKeyValueYellow,
  logWarning
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
      const coinObjectIds = await resolveCoinObjectIds({
        address,
        coinType: balance.coinType,
        suiClient
      })

      return {
        ...balance,
        coinObjectIds
      }
    })
  )

const resolveCoinObjectIds = async ({
  address,
  coinType,
  suiClient
}: {
  address: string
  coinType: string
  suiClient: SuiClient
}): Promise<string[]> => {
  try {
    return await fetchSampledCoinObjectIds({
      address,
      coinType,
      suiClient
    })
  } catch {
    logWarning(
      `Coin object sampling failed for ${coinType}; retrying with a full fetch.`
    )
    await delay(250)

    try {
      const fullCoinObjectIds = await fetchCoinBalances(
        {
          owner: address,
          coinType
        },
        { suiClient }
      )

      return fullCoinObjectIds
        .map((coin) => coin.coinObjectId)
        .slice(0, MAX_LOGGED_COIN_OBJECT_IDS)
    } catch {
      logWarning(
        `Coin object fallback fetch failed for ${coinType}; continuing without object ids.`
      )
      return []
    }
  }
}

const fetchSampledCoinObjectIds = async ({
  address,
  coinType,
  suiClient
}: {
  address: string
  coinType: string
  suiClient: SuiClient
}) => {
  const coinPage = await suiClient.getCoins({
    owner: address,
    coinType,
    limit: MAX_LOGGED_COIN_OBJECT_IDS
  })

  return coinPage.data.map((coin) => normalizeSuiObjectId(coin.coinObjectId))
}

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
      coinObjectIds: formatCoinObjectIds({
        coinObjectIds: balance.coinObjectIds,
        coinObjectCount: balance.coinObjectCount
      }),
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

const formatCoinObjectIds = ({
  coinObjectIds,
  coinObjectCount
}: {
  coinObjectIds: string[]
  coinObjectCount: number
}) => {
  if (coinObjectCount === 0 || coinObjectIds.length === 0) return "none"
  if (coinObjectCount <= MAX_LOGGED_COIN_OBJECT_IDS) {
    return coinObjectIds.join(", ")
  }

  const visibleCoinObjectIds = coinObjectIds
    .slice(0, MAX_LOGGED_COIN_OBJECT_IDS)
    .join(", ")
  const hiddenCoinObjectCount = Math.max(
    coinObjectCount - coinObjectIds.length,
    0
  )

  return `${visibleCoinObjectIds} (+${hiddenCoinObjectCount} more)`
}
