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
import { resolveDeepbookRegistryIdForNetwork } from "@sui-amm/domain-core/models/deepbook"
import { buildCreateTraderAccountTransaction } from "@sui-amm/domain-core/ptb/deepbook"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useMemo, useState } from "react"
import { LOCALNET_DEEPBOOK_REGISTRY_ID } from "../config/network"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import { transactionUrl } from "../helpers/network"
import { notification } from "../helpers/notification"
import {
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

type CreateTraderAccountTransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; digest: string }
  | { status: "error"; error: string; details?: string }

const networkUnsupportedMessage =
  "Trader account creation is not configured for the active network."

const useCreateTraderAccountAction = ({
  onCreated
}: {
  onCreated?: () => void
}) => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const explorerUrl = useExplorerUrl()
  const ammPackageId = useResolvedPackageId()
  const deepbookRegistryId = useMemo(() => {
    if (network === "localnet") return LOCALNET_DEEPBOOK_REGISTRY_ID
    return resolveDeepbookRegistryIdForNetwork(network)
  }, [network])
  const localnetClient = useMemo(() => getLocalnetClient(), [])
  const reloadUi = useCallback(() => {
    if (typeof window === "undefined") return
    window.location.reload()
  }, [])

  const isLocalnet = network === ENetwork.LOCALNET
  const localnetExecutor = useMemo(
    () =>
      makeLocalnetExecutor({
        client: localnetClient,
        signTransaction: signTransaction.mutateAsync
      }),
    [localnetClient, signTransaction.mutateAsync]
  )
  const [transactionState, setTransactionState] =
    useState<CreateTraderAccountTransactionState>({ status: "idle" })

  const walletAddress = currentAccount?.address
  const expectedChain = `sui:${network}` as IdentifierString
  const accountChains = useMemo(
    () => currentAccount?.chains ?? [],
    [currentAccount?.chains]
  )
  const chainMismatch = useMemo(
    () => accountChains.length > 0 && !accountChains.includes(expectedChain),
    [accountChains, expectedChain]
  )
  const localnetSupported = useMemo(
    () =>
      walletSupportsChain(
        currentWallet ?? currentAccount ?? undefined,
        expectedChain
      ),
    [currentAccount, currentWallet, expectedChain]
  )

  const disabledReason = !walletAddress
    ? "Connect a wallet to create a trader account."
    : !ammPackageId
      ? "Contract package id is not configured for this network."
      : !deepbookRegistryId
        ? networkUnsupportedMessage
        : chainMismatch
          ? `Switch your wallet to ${network} before creating a trader account.`
          : undefined

  const canCreate =
    !disabledReason &&
    transactionState.status !== "processing" &&
    !(isLocalnet
      ? signTransaction.isPending
      : signAndExecuteTransaction.isPending)

  const createTraderAccount = useCallback(async () => {
    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to create a trader account."
      })
      return
    }

    if (!ammPackageId) {
      setTransactionState({
        status: "error",
        error: "Contract package id is not configured for this network."
      })
      return
    }

    if (!deepbookRegistryId) {
      setTransactionState({
        status: "error",
        error: networkUnsupportedMessage
      })
      return
    }

    if (!currentWallet) {
      setTransactionState({
        status: "error",
        error: "No wallet connected. Connect a wallet to continue."
      })
      return
    }

    if (!isLocalnet && chainMismatch) {
      setTransactionState({
        status: "error",
        error: `Wallet chain mismatch. Switch your wallet to ${network}.`
      })
      return
    }

    const toastId = notification.txLoading()
    setTransactionState({ status: "processing" })

    try {
      const deepbookRegistry = await getSuiSharedObject(
        { objectId: deepbookRegistryId, mutable: true },
        { suiClient }
      )

      const transaction = buildCreateTraderAccountTransaction({
        ammPackageId,
        deepbookRegistry,
        ownerAddress: walletAddress
      })
      transaction.setSender(walletAddress)

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
        await waitForTransactionBlock(suiClient, digest)
      }

      setTransactionState({ status: "success", digest })
      onCreated?.()

      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success("Trader account created.", toastId)
      }

      reloadUi()
    } catch (error) {
      const localnetSupportNote =
        isLocalnet && !localnetSupported
          ? "Wallet may not support sui:localnet signing."
          : undefined
      const formattedError = formatErrorMessage(error)
      const errorMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      const errorDetails = safeJsonStringify(
        {
          network,
          walletAddress,
          accountChains,
          localnetSupported,
          raw: serializeForJson(error)
        },
        2
      )

      setTransactionState({
        status: "error",
        error: errorMessage,
        details: errorDetails
      })
      notification.txError(
        error instanceof Error ? error : undefined,
        errorMessage,
        toastId
      )
    }
  }, [
    accountChains,
    ammPackageId,
    chainMismatch,
    currentWallet,
    deepbookRegistryId,
    expectedChain,
    explorerUrl,
    isLocalnet,
    localnetExecutor,
    localnetSupported,
    network,
    onCreated,
    reloadUi,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  return {
    canCreate: Boolean(canCreate),
    disabledReason,
    transactionState,
    createTraderAccount
  }
}

export default useCreateTraderAccountAction
