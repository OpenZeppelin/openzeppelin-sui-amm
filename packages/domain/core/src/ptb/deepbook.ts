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
  ownerAddress
}: {
  ammPackageId: string
  deepbookRegistry: WrappedSuiSharedObject
  ownerAddress: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::executor::create_trader_account_with_shared_manager_and_owner_caps`,
    arguments: [
      transaction.sharedObjectRef(deepbookRegistry.sharedRef),
      transaction.pure.address(ownerAddress)
    ]
  })

  return transaction
}

export const buildRegisterBalanceManagerTransaction = ({
  ammPackageId,
  traderAccountId,
  balanceManager,
  deepbookRegistry
}: {
  ammPackageId: string
  traderAccountId: string
  balanceManager: WrappedSuiSharedObject
  deepbookRegistry: WrappedSuiSharedObject
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::executor::register_balance_manager`,
    arguments: [
      transaction.object(traderAccountId),
      transaction.sharedObjectRef(balanceManager.sharedRef),
      transaction.sharedObjectRef(deepbookRegistry.sharedRef)
    ]
  })

  return transaction
}

export const fundTraderAccount = ({
  transaction,
  ammPackageId,
  traderAccountId,
  balanceManager,
  fundingCoin,
  coinAssetType
}: {
  transaction: Transaction
  ammPackageId: string
  traderAccountId: string
  balanceManager: WrappedSuiSharedObject
  fundingCoin: TransactionArgument
  coinAssetType: string
}) =>
  transaction.moveCall({
    target: `${ammPackageId}::executor::fund_trader_account`,
    typeArguments: [coinAssetType],
    arguments: [
      transaction.object(traderAccountId),
      transaction.sharedObjectRef(balanceManager.sharedRef),
      fundingCoin
    ]
  })
