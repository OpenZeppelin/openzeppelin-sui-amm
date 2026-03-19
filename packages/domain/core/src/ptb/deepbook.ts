import type { Transaction, TransactionArgument } from "@mysten/sui/transactions"
import type { WrappedSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"

export const buildAuthorizePropAmmAppTransaction = ({
  deepbookPackageId,
  deepbookRegistry,
  deepbookAdminCapId,
  appType
}: {
  deepbookPackageId: string
  deepbookRegistry: WrappedSuiSharedObject
  deepbookAdminCapId: string
  appType: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${deepbookPackageId}::registry::authorize_app`,
    typeArguments: [appType],
    arguments: [
      transaction.sharedObjectRef(deepbookRegistry.sharedRef),
      transaction.object(deepbookAdminCapId)
    ]
  })

  return transaction
}

export const buildInitBalanceManagerMapTransaction = ({
  deepbookPackageId,
  deepbookRegistry,
  deepbookAdminCapId
}: {
  deepbookPackageId: string
  deepbookRegistry: WrappedSuiSharedObject
  deepbookAdminCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${deepbookPackageId}::registry::init_balance_manager_map`,
    arguments: [
      transaction.sharedObjectRef(deepbookRegistry.sharedRef),
      transaction.object(deepbookAdminCapId)
    ]
  })

  return transaction
}

export const buildCreateTraderAccountTransaction = ({
  ammPackageId,
  deepbookRegistry,
  ownerAddress,
  ammAdminCapId
}: {
  ammPackageId: string
  deepbookRegistry: WrappedSuiSharedObject
  ownerAddress: string
  ammAdminCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::executor::create_trader_account_and_transfer`,
    arguments: [
      transaction.object(ammAdminCapId),
      transaction.sharedObjectRef(deepbookRegistry.sharedRef),
      transaction.pure.address(ownerAddress)
    ]
  })

  return transaction
}

export const buildRegisterBalanceManagerTransaction = ({
  ammPackageId,
  traderAccountId,
  deepbookRegistry,
  ammAdminCapId
}: {
  ammPackageId: string
  traderAccountId: string
  deepbookRegistry: WrappedSuiSharedObject
  ammAdminCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::executor::register_balance_manager`,
    arguments: [
      transaction.object(traderAccountId),
      transaction.object(ammAdminCapId),
      transaction.sharedObjectRef(deepbookRegistry.sharedRef)
    ]
  })

  return transaction
}

export const depositTraderAccount = ({
  transaction,
  ammPackageId,
  traderAccountId,
  ammAdminCapId,
  fundingCoin,
  coinAssetType
}: {
  transaction: Transaction
  ammPackageId: string
  traderAccountId: string
  ammAdminCapId: string
  fundingCoin: TransactionArgument
  coinAssetType: string
}) =>
  transaction.moveCall({
    target: `${ammPackageId}::executor::deposit`,
    typeArguments: [coinAssetType],
    arguments: [
      transaction.object(traderAccountId),
      transaction.object(ammAdminCapId),
      fundingCoin
    ]
  })

export const withdrawTraderAccount = ({
  transaction,
  ammPackageId,
  traderAccountId,
  balanceManager,
  withdrawAmount,
  coinAssetType
}: {
  transaction: Transaction
  ammPackageId: string
  traderAccountId: string
  balanceManager: WrappedSuiSharedObject
  withdrawAmount: bigint
  coinAssetType: string
}) =>
  transaction.moveCall({
    target: `${ammPackageId}::executor::withdraw_trader_account`,
    typeArguments: [coinAssetType],
    arguments: [
      transaction.object(traderAccountId),
      transaction.sharedObjectRef(balanceManager.sharedRef),
      transaction.pure.u64(withdrawAmount)
    ]
  })
