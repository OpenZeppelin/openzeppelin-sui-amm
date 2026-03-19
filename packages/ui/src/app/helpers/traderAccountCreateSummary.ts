import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { TraderAccountOverview } from "@sui-amm/domain-core/models/traderAccount"
import { TRADER_ACCOUNT_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import { ensureCreatedObject } from "@sui-amm/tooling-core/transactions"

export type TraderAccountCreateSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  ownerAddress: string
  traderAccountId: string
  balanceManagerId?: string
  tradeCapId?: string
  depositCapId?: string
  withdrawCapId?: string
}

const resolveCreatedTraderAccountId = (
  transactionBlock: SuiTransactionBlockResponse
) => ensureCreatedObject(TRADER_ACCOUNT_TYPE_SUFFIX, transactionBlock).objectId

const resolveTraderAccountId = ({
  transactionBlock,
  traderAccountOverview,
  fallbackTraderAccountId
}: {
  transactionBlock: SuiTransactionBlockResponse
  traderAccountOverview?: TraderAccountOverview
  fallbackTraderAccountId?: string
}) =>
  traderAccountOverview?.traderAccountId ??
  fallbackTraderAccountId ??
  resolveCreatedTraderAccountId(transactionBlock)

export const buildTraderAccountCreateSummary = ({
  digest,
  transactionBlock,
  ownerAddress,
  traderAccountOverview,
  fallbackTraderAccountId
}: {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  ownerAddress: string
  traderAccountOverview?: TraderAccountOverview
  fallbackTraderAccountId?: string
}): TraderAccountCreateSummary => ({
  digest,
  transactionBlock,
  ownerAddress,
  traderAccountId: resolveTraderAccountId({
    transactionBlock,
    traderAccountOverview,
    fallbackTraderAccountId
  }),
  balanceManagerId: traderAccountOverview?.balanceManagerId,
  tradeCapId: traderAccountOverview?.tradeCapId,
  depositCapId: traderAccountOverview?.depositCapId,
  withdrawCapId: traderAccountOverview?.withdrawCapId
})
