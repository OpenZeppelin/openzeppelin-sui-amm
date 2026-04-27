"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { IdentifierString } from "@mysten/wallet-standard"
import {
  buildPauseTransaction,
  buildUnpauseTransaction
} from "@sui-amm/domain-core/ptb/amm"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useMemo, useState } from "react"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { transactionUrl } from "../helpers/network"
import { notification } from "../helpers/notification"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

export type BotAction = "pause" | "unpause"

type TransactionState =
  | { status: "idle" }
  | { status: "processing"; action: BotAction }
  | { status: "success"; action: BotAction; digest: string }
  | { status: "error"; action: BotAction; error: string; details?: string }

export const useBotControlState = () => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const contractPackageId = useResolvedPackageId()
  const explorerUrl = useExplorerUrl()
  const { overview, resolution, refreshTraderAccount } =
    useTraderAccountContext()
  const localnetClient = useMemo(() => getLocalnetClient(), [])
  const isLocalnet = network === ENetwork.LOCALNET
  const localnetExecutor = useMemo(
    () =>
      makeLocalnetExecutor({
        client: localnetClient,
        signTransaction: signTransaction.mutateAsync
      }),
    [localnetClient, signTransaction.mutateAsync]
  )

  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })

  const walletAddress = currentAccount?.address
  const executorId = resolution.traderAccountId
  const traderAccount =
    overview.status === "success" ? overview.traderAccount : undefined

  const isProcessing = transactionState.status === "processing"
  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const ready =
    Boolean(
      walletAddress && contractPackageId && executorId && traderAccount
    ) &&
    !isProcessing &&
    isSubmissionPending !== true

  const canPause = ready && traderAccount?.active === true
  const canUnpause = ready && traderAccount?.active === false

  const submit = useCallback(
    async (action: BotAction) => {
      if (!walletAddress) {
        setTransactionState({
          status: "error",
          action,
          error: "Connect a wallet to submit."
        })
        return
      }
      if (!contractPackageId) {
        setTransactionState({
          status: "error",
          action,
          error: "Contract package ID is not configured for this network."
        })
        return
      }
      if (!executorId || !traderAccount) {
        setTransactionState({
          status: "error",
          action,
          error: "Market maker executor is not resolved yet."
        })
        return
      }

      const expectedChain = `sui:${network}` as IdentifierString
      const accountChains = currentAccount?.chains ?? []
      const localnetSupported = walletSupportsChain(
        currentWallet ?? currentAccount ?? undefined,
        expectedChain
      )
      const chainMismatch =
        accountChains.length > 0 && !accountChains.includes(expectedChain)

      const walletContext = {
        appNetwork: network,
        expectedChain,
        walletName: currentWallet?.name,
        walletVersion: currentWallet?.version,
        accountAddress: walletAddress,
        accountChains,
        chainMismatch,
        localnetSupported
      }

      if (!isLocalnet && chainMismatch) {
        setTransactionState({
          status: "error",
          action,
          error: `Wallet chain mismatch. Switch your wallet to ${network}.`,
          details: safeJsonStringify(
            { walletContext, reason: "chain_mismatch" },
            2
          )
        })
        return
      }
      if (!currentWallet) {
        setTransactionState({
          status: "error",
          action,
          error: "No wallet connected. Connect a wallet to continue.",
          details: safeJsonStringify(
            { walletContext, reason: "wallet_missing" },
            2
          )
        })
        return
      }

      setTransactionState({ status: "processing", action })
      const toastId = notification.txLoading()

      let failureStage:
        | "prepare"
        | "resolve-admin-cap"
        | "resolve-executor"
        | "resolve-pool"
        | "execute"
        | "fetch" = "prepare"

      try {
        failureStage = "resolve-admin-cap"
        const adminCapId = await resolveAmmAdminCapId({
          ownerAddress: walletAddress,
          packageId: contractPackageId,
          suiClient
        })
        if (!adminCapId) {
          throw new Error("AdminCap not found for the connected wallet.")
        }

        failureStage = "resolve-executor"
        const executorShared = await getSuiSharedObject(
          { objectId: executorId, mutable: true },
          { suiClient }
        )

        let transaction
        if (action === "pause") {
          failureStage = "resolve-pool"
          const poolShared = await getSuiSharedObject(
            { objectId: traderAccount.poolId, mutable: true },
            { suiClient }
          )
          transaction = buildPauseTransaction({
            packageId: contractPackageId,
            executor: executorShared,
            adminCapId,
            pool: poolShared,
            baseAssetTypeTag: traderAccount.baseCoinType,
            quoteAssetTypeTag: traderAccount.quoteCoinType
          })
        } else {
          transaction = buildUnpauseTransaction({
            packageId: contractPackageId,
            executor: executorShared,
            adminCapId
          })
        }

        transaction.setSender(walletAddress)

        failureStage = "execute"
        let digest = ""

        if (isLocalnet) {
          const result = await localnetExecutor(transaction, {
            chain: expectedChain
          })
          digest = result.digest
        } else {
          const result = await signAndExecuteTransaction.mutateAsync({
            transaction,
            chain: expectedChain
          })
          digest = result.digest
        }

        failureStage = "fetch"
        await waitForTransactionBlock(suiClient, digest)

        setTransactionState({ status: "success", action, digest })
        if (explorerUrl) {
          notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
        } else {
          notification.success(`Executor ${action}d (${digest})`, toastId)
        }
        refreshTraderAccount()
      } catch (error) {
        const errorDetails = extractErrorDetails(error)
        const errorDetailsRaw = safeJsonStringify(
          {
            summary: errorDetails,
            raw: serializeForJson(error),
            failureStage,
            walletContext
          },
          2
        )
        const formattedError = formatErrorMessage(error)
        setTransactionState({
          status: "error",
          action,
          error: formattedError,
          details: errorDetailsRaw
        })
        notification.txError(
          error instanceof Error ? error : undefined,
          formattedError,
          toastId
        )
      }
    },
    [
      contractPackageId,
      currentAccount,
      currentWallet,
      executorId,
      explorerUrl,
      isLocalnet,
      localnetExecutor,
      network,
      refreshTraderAccount,
      signAndExecuteTransaction,
      suiClient,
      traderAccount,
      walletAddress
    ]
  )

  const pause = useCallback(() => submit("pause"), [submit])
  const unpause = useCallback(() => submit("unpause"), [submit])

  return {
    transactionState,
    canPause,
    canUnpause,
    isProcessing,
    pause,
    unpause,
    traderAccount
  }
}
