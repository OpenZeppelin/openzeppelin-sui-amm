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
  adminCapId
}: {
  ammPackageId: string
  adminCapId: string
}) => {
  const transaction = newTransaction()

  transaction.moveCall({
    target: `${ammPackageId}::market_maker::create`,
    arguments: [transaction.object(adminCapId)]
  })

  return transaction
}
