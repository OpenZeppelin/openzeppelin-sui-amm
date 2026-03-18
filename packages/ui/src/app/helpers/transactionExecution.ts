import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Transaction } from "@mysten/sui/transactions"
import type { IdentifierString } from "@mysten/wallet-standard"
import { waitForTransactionBlock } from "./transactionWait"

type LocalnetExecutor = (
  transaction: Transaction,
  options?: { chain?: IdentifierString; dryRun?: boolean }
) => Promise<SuiTransactionBlockResponse>

export const executeTransaction = async ({
  buildTransaction,
  isLocalnet,
  expectedChain,
  localnetExecutor,
  signAndExecuteTransaction,
  suiClient,
  retryLocalnetWithoutDryRunWhen,
  onBeforeLocalExecute,
  onBeforeRemoteExecute,
  onBeforeRemoteFetch
}: {
  buildTransaction: () => Transaction
  isLocalnet: boolean
  expectedChain: IdentifierString
  localnetExecutor: LocalnetExecutor
  signAndExecuteTransaction: (input: {
    transaction: Transaction
    chain: IdentifierString
  }) => Promise<{ digest: string }>
  suiClient: SuiClient
  retryLocalnetWithoutDryRunWhen?: (error: unknown) => boolean
  onBeforeLocalExecute?: () => void
  onBeforeRemoteExecute?: () => void
  onBeforeRemoteFetch?: () => void
}): Promise<{
  digest: string
  transactionBlock: SuiTransactionBlockResponse
}> => {
  if (isLocalnet) {
    onBeforeLocalExecute?.()

    try {
      const transactionBlock = await localnetExecutor(buildTransaction(), {
        chain: expectedChain
      })
      return { digest: transactionBlock.digest, transactionBlock }
    } catch (error) {
      if (!retryLocalnetWithoutDryRunWhen?.(error)) throw error

      onBeforeLocalExecute?.()
      const transactionBlock = await localnetExecutor(buildTransaction(), {
        chain: expectedChain,
        dryRun: false
      })
      return { digest: transactionBlock.digest, transactionBlock }
    }
  }

  onBeforeRemoteExecute?.()
  const { digest } = await signAndExecuteTransaction({
    transaction: buildTransaction(),
    chain: expectedChain
  })

  onBeforeRemoteFetch?.()
  const transactionBlock = await waitForTransactionBlock(suiClient, digest)
  return { digest, transactionBlock }
}

export const resolveLocalnetSupportNote = ({
  isLocalnet,
  localnetSupported
}: {
  isLocalnet: boolean
  localnetSupported: boolean
}) =>
  isLocalnet && !localnetSupported
    ? "Wallet may not support sui:localnet signing."
    : undefined

export const withOptionalSupportNote = ({
  message,
  supportNote
}: {
  message: string
  supportNote?: string
}) => (supportNote ? `${message} ${supportNote}` : message)
