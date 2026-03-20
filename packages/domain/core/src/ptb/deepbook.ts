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
  adminCapId,
  deepbookRegistry,
  ownerAddress
}: {
  ammPackageId: string
  adminCapId: string
  deepbookRegistry: WrappedSuiSharedObject
  ownerAddress: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::executor::create_trader_account_for_owner`,
    arguments: [
      transaction.object(adminCapId),
      transaction.sharedObjectRef(deepbookRegistry.sharedRef),
      transaction.pure.address(ownerAddress)
    ]
  })

  return transaction
}
