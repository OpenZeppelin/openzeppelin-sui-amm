import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import { TRADER_ACCOUNT_TYPE_SUFFIX } from "@sui-amm/domain-core/models/traderAccount"
import {
  ensureCreatedObject,
  findCreatedObjectIds
} from "@sui-amm/tooling-core/transactions"

const BALANCE_MANAGER_TYPE_SUFFIX = "::balance_manager::BalanceManager"
const TRADE_CAP_TYPE_SUFFIX = "::balance_manager::TradeCap"
const DEPOSIT_CAP_TYPE_SUFFIX = "::balance_manager::DepositCap"
const WITHDRAW_CAP_TYPE_SUFFIX = "::balance_manager::WithdrawCap"

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

const resolveOptionalCreatedObjectId = (
  transactionBlock: SuiTransactionBlockResponse,
  typeSuffix: string
) => findCreatedObjectIds(transactionBlock, typeSuffix)[0]

export const buildTraderAccountCreateSummary = ({
  digest,
  transactionBlock,
  ownerAddress
}: {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  ownerAddress: string
}): TraderAccountCreateSummary => ({
  digest,
  transactionBlock,
  ownerAddress,
  traderAccountId: resolveCreatedTraderAccountId(transactionBlock),
  balanceManagerId: resolveOptionalCreatedObjectId(
    transactionBlock,
    BALANCE_MANAGER_TYPE_SUFFIX
  ),
  tradeCapId: resolveOptionalCreatedObjectId(
    transactionBlock,
    TRADE_CAP_TYPE_SUFFIX
  ),
  depositCapId: resolveOptionalCreatedObjectId(
    transactionBlock,
    DEPOSIT_CAP_TYPE_SUFFIX
  ),
  withdrawCapId: resolveOptionalCreatedObjectId(
    transactionBlock,
    WITHDRAW_CAP_TYPE_SUFFIX
  )
})
