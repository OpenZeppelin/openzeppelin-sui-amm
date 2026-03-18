import {
  getBalanceManagerAssetBalances,
  type TraderAccountAssetBalance,
  type TraderAccountOverview
} from "@sui-amm/domain-core/models/traderAccount"
import { normalizeCoinType } from "@sui-amm/tooling-core/coin"
import { resolveSignerAddress } from "@sui-amm/tooling-node/account"
import type { Tooling } from "@sui-amm/tooling-node/factory"
import {
  getOwnedTraderAccountOverview,
  resolveOwnedTraderAccountId
} from "./trader-account.ts"

const buildWithdrawCommand = ({
  ammPackageId,
  traderAccountId,
  coinType,
  amount
}: {
  ammPackageId: string
  traderAccountId: string
  coinType: string
  amount: string
}) =>
  `pnpm dapp user:trader-account:withdraw --amm-package-id ${ammPackageId} --trader-account-id ${traderAccountId} --coin-type ${coinType} --amount ${amount}`

const toTraderAccountBalanceAsset = ({
  assetBalance,
  ammPackageId,
  traderAccountId
}: {
  assetBalance: TraderAccountAssetBalance
  ammPackageId: string
  traderAccountId: string
}) => {
  const normalizedCoinType = normalizeCoinType(assetBalance.coinType)
  const normalizedBalance = assetBalance.balance.toString()

  return {
    coinType: normalizedCoinType,
    balance: normalizedBalance,
    withdrawArguments: {
      coinType: normalizedCoinType,
      amount: normalizedBalance
    },
    withdrawCommand: buildWithdrawCommand({
      ammPackageId,
      traderAccountId,
      coinType: normalizedCoinType,
      amount: normalizedBalance
    })
  }
}

const resolveBalanceAssets = ({
  assetBalances,
  ammPackageId,
  traderAccountId
}: {
  assetBalances: TraderAccountAssetBalance[]
  ammPackageId: string
  traderAccountId: string
}) =>
  assetBalances.map((assetBalance) =>
    toTraderAccountBalanceAsset({
      assetBalance,
      ammPackageId,
      traderAccountId
    })
  )

export type TraderAccountBalanceResult = {
  status: "loaded"
  ownerAddress: string
  traderAccount: TraderAccountOverview
  assets: {
    coinType: string
    balance: string
    withdrawArguments: {
      coinType: string
      amount: string
    }
    withdrawCommand: string
  }[]
}

export const viewExistingTraderAccountBalance = async ({
  tooling,
  ammPackageId,
  traderAccountId
}: {
  tooling: Pick<Tooling, "loadedEd25519KeyPair" | "suiClient">
  ammPackageId: string
  traderAccountId?: string
}): Promise<TraderAccountBalanceResult> => {
  const signerAddress = resolveSignerAddress(tooling.loadedEd25519KeyPair)
  const resolvedTraderAccountId = await resolveOwnedTraderAccountId({
    tooling,
    traderAccountId,
    ownerAddress: signerAddress,
    ammPackageId
  })

  if (!resolvedTraderAccountId) {
    throw new Error(
      "No owned trader account was found for the active signer. Create one or provide --trader-account-id."
    )
  }

  const traderAccount = await getOwnedTraderAccountOverview({
    tooling,
    traderAccountId: resolvedTraderAccountId,
    ownerAddress: signerAddress,
    ammPackageId,
    operation: "Trader account balance lookup"
  })
  const assetBalances = await getBalanceManagerAssetBalances(
    traderAccount.balanceManagerId,
    tooling.suiClient
  )

  return {
    status: "loaded",
    ownerAddress: signerAddress,
    traderAccount,
    assets: resolveBalanceAssets({
      assetBalances,
      ammPackageId,
      traderAccountId: traderAccount.traderAccountId
    })
  }
}
