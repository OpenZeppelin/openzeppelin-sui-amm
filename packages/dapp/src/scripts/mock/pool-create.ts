/**
 * Localnet-only. Creates a DeepBook permissionless pool between SUI (base) and
 * LocalMockUsd (quote) — or caller-supplied coin types — and records the pool
 * ID in mock.localnet.json for reuse. Idempotent: re-runs reuse an existing
 * matching pool unless --force is passed.
 *
 * The creation fee (500 DEEP) is paid from the publisher's DEEP balance,
 * which is minted into the publisher's address when `mock:setup` published
 * the DeepBook token package.
 */

import { normalizeStructTag, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

import {
  fetchCoinBalances,
  selectRichestCoin
} from "@sui-amm/tooling-core/coin"
import { SUI_COIN_TYPE } from "@sui-amm/tooling-core/constants"
import { assertLocalnetNetwork } from "@sui-amm/tooling-core/network"
import { findCreatedByType } from "@sui-amm/tooling-core/transactions"
import { readArtifact } from "@sui-amm/tooling-node/artifacts"
import { DEFAULT_TX_GAS_BUDGET } from "@sui-amm/tooling-node/constants"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import {
  logKeyValueBlue,
  logKeyValueGreen,
  logWarning
} from "@sui-amm/tooling-node/log"
import { runSuiScript } from "@sui-amm/tooling-node/process"
import { newTransaction } from "@sui-amm/tooling-node/transactions"

import {
  mockArtifactPath,
  writeMockArtifact,
  type MockArtifact,
  type PoolArtifact
} from "../../utils/mocks.ts"

process.env.SUI_NETWORK = "localnet"

const POOL_CREATION_FEE = 500_000_000n // 500 DEEP with 6 decimals
const DEFAULT_TICK_SIZE = "1000"
const DEFAULT_LOT_SIZE = "1000000"
const DEFAULT_MIN_SIZE = "10000000"

type PoolCreateArgs = {
  baseCoinType?: string
  quoteCoinType?: string
  tickSize: string
  lotSize: string
  minSize: string
  force: boolean
}

const requireField = <T>(value: T | undefined, label: string): T => {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${label} is missing from mock.localnet.json. Run \`pnpm --filter dapp mock:setup\` first.`
    )
  }
  return value
}

const resolveBaseCoinType = (cliValue: string | undefined): string =>
  normalizeStructTag(cliValue?.trim() || SUI_COIN_TYPE)

const resolveQuoteCoinType = (
  cliValue: string | undefined,
  coins: MockArtifact["coins"]
): string => {
  if (cliValue?.trim()) return normalizeStructTag(cliValue.trim())
  const localMockUsd = coins?.find((coin) => coin.label === "LocalMockUsd")
  if (!localMockUsd) {
    throw new Error(
      "Could not resolve default quote coin (LocalMockUsd) — pass --quote-coin-type to override."
    )
  }
  return normalizeStructTag(localMockUsd.coinType)
}

const findExistingPool = ({
  pools,
  baseCoinType,
  quoteCoinType
}: {
  pools: PoolArtifact[]
  baseCoinType: string
  quoteCoinType: string
}) =>
  pools.find(
    (pool) =>
      normalizeStructTag(pool.baseCoinType) === baseCoinType &&
      normalizeStructTag(pool.quoteCoinType) === quoteCoinType
  )

runSuiScript(
  async (tooling: Tooling, cliArguments: PoolCreateArgs) => {
    const {
      suiConfig: { network }
    } = tooling
    assertLocalnetNetwork(network.networkName)

    const mockArtifact = await readArtifact<MockArtifact>(mockArtifactPath, {})
    const deepbookPackageId = normalizeSuiObjectId(
      requireField(mockArtifact.deepbookPackageId, "deepbookPackageId")
    )
    const deepbookRegistryId = normalizeSuiObjectId(
      requireField(mockArtifact.deepbookRegistryId, "deepbookRegistryId")
    )
    const deepbookTokenPackageId = normalizeSuiObjectId(
      requireField(mockArtifact.deepbookTokenPackageId, "deepbookTokenPackageId")
    )

    const baseCoinType = resolveBaseCoinType(cliArguments.baseCoinType)
    const quoteCoinType = resolveQuoteCoinType(
      cliArguments.quoteCoinType,
      mockArtifact.coins
    )
    if (baseCoinType === quoteCoinType) {
      throw new Error("Base and quote coin types must differ.")
    }

    const existingPools = mockArtifact.pools ?? []
    const existingPool = findExistingPool({
      pools: existingPools,
      baseCoinType,
      quoteCoinType
    })
    if (existingPool && !cliArguments.force) {
      logKeyValueBlue("Pool")(
        `${baseCoinType} / ${quoteCoinType} already exists; reusing ${existingPool.poolId}`
      )
      logKeyValueGreen("poolId")(existingPool.poolId)
      return
    }

    await tooling.ensureFoundedAddress({
      signerAddress: tooling.loadedEd25519KeyPair.toSuiAddress(),
      signer: tooling.loadedEd25519KeyPair
    })

    const deepCoinType = `${deepbookTokenPackageId}::deep::DEEP`
    const signerAddress = tooling.loadedEd25519KeyPair.toSuiAddress()
    const deepCoins = await fetchCoinBalances(
      { owner: signerAddress, coinType: deepCoinType },
      { suiClient: tooling.suiClient }
    )
    const richestDeepCoin = selectRichestCoin(deepCoins)
    if (!richestDeepCoin || richestDeepCoin.balance < POOL_CREATION_FEE) {
      throw new Error(
        `Signer ${signerAddress} has insufficient DEEP (${
          richestDeepCoin?.balance ?? 0n
        } / ${POOL_CREATION_FEE} required). DEEP is minted to the publisher when mock:setup runs; ensure the same keypair is used here.`
      )
    }

    const registryShared = await tooling.getMutableSharedObject({
      objectId: deepbookRegistryId
    })

    const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
    const [feeCoin] = transaction.splitCoins(
      transaction.object(richestDeepCoin.coinObjectId),
      [transaction.pure.u64(POOL_CREATION_FEE)]
    )

    transaction.moveCall({
      target: `${deepbookPackageId}::pool::create_permissionless_pool`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [
        transaction.sharedObjectRef(registryShared.sharedRef),
        transaction.pure.u64(cliArguments.tickSize),
        transaction.pure.u64(cliArguments.lotSize),
        transaction.pure.u64(cliArguments.minSize),
        feeCoin
      ]
    })

    const { transactionResult } = await tooling.signAndExecute({
      transaction,
      signer: tooling.loadedEd25519KeyPair
    })

    const poolTypePrefix = `${deepbookPackageId}::pool::Pool<`
    const [createdPoolId] = findCreatedByType(transactionResult, (objectType) =>
      objectType.startsWith(poolTypePrefix)
    )
    if (!createdPoolId) {
      throw new Error(
        "Transaction succeeded but no Pool object was created. Check `deepbookPackageId` in the mock artifact."
      )
    }
    const poolId = normalizeSuiObjectId(createdPoolId)

    const newPool: PoolArtifact = {
      poolId,
      baseCoinType,
      quoteCoinType,
      tickSize: cliArguments.tickSize,
      lotSize: cliArguments.lotSize,
      minSize: cliArguments.minSize
    }
    const nextPools = existingPool
      ? existingPools.map((pool) => (pool === existingPool ? newPool : pool))
      : [...existingPools, newPool]

    await writeMockArtifact(mockArtifactPath, { pools: nextPools })

    if (existingPool && cliArguments.force) {
      logWarning(
        `Overwrote existing pool ${existingPool.poolId} with new pool ${poolId}.`
      )
    }
    logKeyValueGreen("Created pool")(
      `${baseCoinType} / ${quoteCoinType}`
    )
    logKeyValueGreen("poolId")(poolId)
    logKeyValueGreen("tickSize")(cliArguments.tickSize)
    logKeyValueGreen("lotSize")(cliArguments.lotSize)
    logKeyValueGreen("minSize")(cliArguments.minSize)
    if (transactionResult.digest)
      logKeyValueGreen("digest")(transactionResult.digest)
  },
  yargs()
    .option("baseCoinType", {
      alias: ["base-coin-type", "base"],
      type: "string",
      description: "Base asset type tag. Defaults to 0x2::sui::SUI."
    })
    .option("quoteCoinType", {
      alias: ["quote-coin-type", "quote"],
      type: "string",
      description:
        "Quote asset type tag. Defaults to the LocalMockUsd coin recorded in mock.localnet.json."
    })
    .option("tickSize", {
      alias: ["tick-size"],
      type: "string",
      description:
        "Tick size. Must be > 0 and a power of 10 (DeepBook pool validator).",
      default: DEFAULT_TICK_SIZE
    })
    .option("lotSize", {
      alias: ["lot-size"],
      type: "string",
      description:
        "Lot size. Must be >= 1000 and a power of 10 (DeepBook pool validator).",
      default: DEFAULT_LOT_SIZE
    })
    .option("minSize", {
      alias: ["min-size"],
      type: "string",
      description:
        "Minimum order size. Must be > 0, a multiple of lot-size, and a power of 10.",
      default: DEFAULT_MIN_SIZE
    })
    .option("force", {
      type: "boolean",
      description:
        "Re-create the pool even if a matching base/quote pair already exists in mock.localnet.json.",
      default: false
    })
    .strict()
)
