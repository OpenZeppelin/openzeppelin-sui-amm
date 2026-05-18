/**
 * Diagnostic for "ask orders aren't being marked EXPIRED in the UI".
 *
 * Reads DeepBook's `OrderExpired`, `OrderCanceled`, and `OrderFullyFilled`
 * events directly from the chain (no UI in the loop), filters them by the
 * target executor's pool + BalanceManager, and prints the bid/ask split.
 *
 * Use the result to distinguish:
 *   (A) UI filter is broken — events DO contain ask-side rows (`is_bid=false`)
 *       but they're not surfacing in the Active Orders card. Then the bug is
 *       in `useDeepbookExpiredOrders` / friends.
 *   (B) DeepBook isn't emitting OrderExpired for our asks at all — events
 *       only contain bid-side rows. Then the bug is upstream: the bot's
 *       takers aren't walking far enough past the executor's ask ladder to
 *       observe their expiry on-chain. UI is faithfully reporting "no
 *       events".
 *
 * Usage:
 *   pnpm --filter dapp bot:audit-deepbook-events --executor-id 0x…
 */

import { normalizeSuiObjectId } from "@mysten/sui/utils"
import type { SuiClient } from "@mysten/sui/client"
import yargs from "yargs"

import { getTraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { resolveAmmPackageId } from "@sui-amm/domain-node/amm"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
import { logKeyValueGreen } from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"

import { mockArtifactPath, type MockArtifact } from "../../utils/mocks.ts"

process.env.SUI_NETWORK = process.env.SUI_NETWORK ?? "localnet"

type CliArguments = {
  executorId: string
  ammPackageId?: string
  scanLimit: number
}

type SideCounts = {
  total: number
  bid: number
  ask: number
  unknownSide: number
  sampleBidOrderIds: string[]
  sampleAskOrderIds: string[]
}

const emptyCounts = (): SideCounts => ({
  total: 0,
  bid: 0,
  ask: 0,
  unknownSide: 0,
  sampleBidOrderIds: [],
  sampleAskOrderIds: []
})

const safeNormalize = (value?: string) => {
  if (!value) return undefined
  try {
    return normalizeSuiObjectId(value)
  } catch {
    return undefined
  }
}

// Pages back through queryEvents until `scanLimit` events have been scanned
// (not just matched) or the chain's history runs out. We page over all events
// for the event type since `queryEvents` doesn't accept compound filters —
// the pool/BalanceManager match is done client-side.
const countEventsForExecutor = async ({
  suiClient,
  eventType,
  normalizedPool,
  normalizedBm,
  scanLimit
}: {
  suiClient: SuiClient
  eventType: string
  normalizedPool: string
  normalizedBm: string
  scanLimit: number
}): Promise<SideCounts> => {
  const counts = emptyCounts()
  let cursor: Parameters<SuiClient["queryEvents"]>[0]["cursor"] = null
  let scanned = 0
  while (scanned < scanLimit) {
    const pageSize = Math.min(200, scanLimit - scanned)
    const page = await suiClient.queryEvents({
      query: { MoveEventType: eventType },
      cursor,
      order: "descending",
      limit: pageSize
    })
    scanned += page.data.length
    for (const event of page.data) {
      const data = event.parsedJson as
        | {
            pool_id?: string
            balance_manager_id?: string
            is_bid?: boolean
            order_id?: string | number
          }
        | undefined
      if (!data) continue
      if (safeNormalize(data.pool_id) !== normalizedPool) continue
      if (safeNormalize(data.balance_manager_id) !== normalizedBm) continue
      counts.total += 1
      if (data.is_bid === true) {
        counts.bid += 1
        if (
          counts.sampleBidOrderIds.length < 3 &&
          data.order_id !== undefined
        ) {
          counts.sampleBidOrderIds.push(String(data.order_id))
        }
      } else if (data.is_bid === false) {
        counts.ask += 1
        if (
          counts.sampleAskOrderIds.length < 3 &&
          data.order_id !== undefined
        ) {
          counts.sampleAskOrderIds.push(String(data.order_id))
        }
      } else {
        counts.unknownSide += 1
      }
    }
    if (!page.hasNextPage || !page.nextCursor) break
    cursor = page.nextCursor
  }
  return counts
}

const formatCounts = (counts: SideCounts): string => {
  const sampleSegments: string[] = []
  if (counts.sampleBidOrderIds.length > 0) {
    sampleSegments.push(`bidSamples=[${counts.sampleBidOrderIds.join(", ")}]`)
  }
  if (counts.sampleAskOrderIds.length > 0) {
    sampleSegments.push(`askSamples=[${counts.sampleAskOrderIds.join(", ")}]`)
  }
  const head = `total=${counts.total} bid=${counts.bid} ask=${counts.ask} unknownSide=${counts.unknownSide}`
  return sampleSegments.length > 0
    ? `${head} · ${sampleSegments.join(" · ")}`
    : head
}

runSuiScript(
  async (tooling, cliArguments: CliArguments) => {
    const ammPackageId = await resolveAmmPackageId({
      networkName: tooling.network.networkName,
      ammPackageId: cliArguments.ammPackageId
    })
    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const deepbookPackageId = mockArtifact.deepbookPackageId
    if (!deepbookPackageId) {
      throw new Error(
        "deepbookPackageId missing from mock.localnet.json; re-run mock:setup."
      )
    }

    const overview = await getTraderAccountOverview(
      cliArguments.executorId,
      tooling.suiClient,
      ammPackageId
    )

    const normalizedPool = safeNormalize(overview.poolId)
    const normalizedBm = safeNormalize(overview.balanceManagerId)
    if (!normalizedPool || !normalizedBm) {
      throw new Error(
        `Executor ${cliArguments.executorId} resolved to invalid pool / balance manager ids.`
      )
    }

    logKeyValueGreen("executor")(cliArguments.executorId)
    logKeyValueGreen("pool")(overview.poolId)
    logKeyValueGreen("balance-manager")(overview.balanceManagerId)
    logKeyValueGreen("deepbook")(deepbookPackageId)
    logKeyValueGreen("scan-limit")(String(cliArguments.scanLimit))

    const eventTypes = [
      `${deepbookPackageId}::order_info::OrderExpired`,
      `${deepbookPackageId}::order::OrderCanceled`,
      `${deepbookPackageId}::order_info::OrderFullyFilled`
    ] as const

    for (const eventType of eventTypes) {
      const counts = await countEventsForExecutor({
        suiClient: tooling.suiClient,
        eventType,
        normalizedPool,
        normalizedBm,
        scanLimit: cliArguments.scanLimit
      })
      logKeyValueGreen(eventType)(formatCounts(counts))
    }
  },
  yargs()
    .option("executorId", {
      alias: ["executor-id"],
      type: "string",
      description: "Executor object id to scope the event scan.",
      demandOption: true
    })
    .option("ammPackageId", {
      alias: ["amm-package-id"],
      type: "string",
      description:
        "AMM Move package id; inferred from the latest deployment artifact when omitted."
    })
    .option("scanLimit", {
      alias: ["scan-limit"],
      type: "number",
      description:
        "Maximum number of raw events to scan per event type before stopping. Increase if your chain history is large enough that filtered counts saturate near the cutoff.",
      default: 2000
    })
    .strict()
)
