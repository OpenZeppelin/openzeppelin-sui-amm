/**
 * Localnet-only. Creates a DeepBook permissionless pool between SUI (base) and
 * USDC mock (quote) — or caller-supplied coin types — and records the pool
 * ID in mock.localnet.json for reuse. Idempotent: re-runs reuse an existing
 * matching pool unless --force is passed.
 *
 * The creation fee (500 DEEP) is paid from the publisher's DEEP balance,
 * which is minted into the publisher's address when `mock:setup` published
 * the DeepBook token package.
 */

import { normalizeStructTag, normalizeSuiObjectId } from "@mysten/sui/utils"
import yargs from "yargs"

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
  const usdc = coins?.find((coin) => coin.label === "USDC")
  if (!usdc) {
    throw new Error(
      "Could not resolve default quote coin (USDC) — pass --quote-coin-type to override."
    )
  }
  return normalizeStructTag(usdc.coinType)
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
    const deepbookAdminCapId = normalizeSuiObjectId(
      requireField(mockArtifact.deepbookAdminCapId, "deepbookAdminCapId")
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

    const registryShared = await tooling.getMutableSharedObject({
      objectId: deepbookRegistryId
    })

    // Use create_pool_admin with whitelisted_pool=true to get a zero-fee pool.
    // Permissionless pools charge maker/taker fees out of the input asset,
    // and our `executor::refresh_quotes_permissionless` allocates 100% of the BM balance to
    // the four orders, so a non-zero fee makes the second lock in the PTB
    // abort with EBalanceManagerBalanceTooLow.
    const transaction = newTransaction(DEFAULT_TX_GAS_BUDGET)
    transaction.moveCall({
      target: `${deepbookPackageId}::pool::create_pool_admin`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [
        transaction.sharedObjectRef(registryShared.sharedRef),
        transaction.pure.u64(cliArguments.tickSize),
        transaction.pure.u64(cliArguments.lotSize),
        transaction.pure.u64(cliArguments.minSize),
        transaction.pure.bool(true), // whitelisted_pool — zero fees
        transaction.pure.bool(false), // stable_pool
        transaction.object(deepbookAdminCapId)
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
    logKeyValueGreen("Created pool")(`${baseCoinType} / ${quoteCoinType}`)
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
        "Quote asset type tag. Defaults to the USDC mock coin recorded in mock.localnet.json."
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
