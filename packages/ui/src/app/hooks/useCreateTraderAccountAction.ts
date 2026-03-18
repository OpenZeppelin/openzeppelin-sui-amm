"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import { buildCreateTraderAccountTransaction } from "@sui-amm/domain-core/ptb/deepbook"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useMemo, useState } from "react"
import { resolveDeepbookRegistryIdForNetwork } from "@sui-amm/domain-core/models/deepbook"
import { LOCALNET_DEEPBOOK_REGISTRY_ID } from "../config/network"
import { getLocalnetClient, makeLocalnetExecutor } from "../helpers/localnet"
import { transactionUrl } from "../helpers/network"
import { notification } from "../helpers/notification"
import {
  executeTransaction,
  resolveLocalnetSupportNote,
  withOptionalSupportNote
} from "../helpers/transactionExecution"
import {
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import {
  buildTraderAccountCreateSummary,
  type TraderAccountCreateSummary
} from "../helpers/traderAccountCreateSummary"
import { resolveWalletNetworkPreflight } from "../helpers/walletPreflight"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

type CreateTraderAccountTransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: TraderAccountCreateSummary }
  | { status: "error"; error: string; details?: string }

const networkUnsupportedMessage =
  "Trader account creation is not configured for the active network."
const missingGasCoinsErrorFragment =
  "no valid gas coins found for the transaction"

const includesMissingGasCoinsError = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .toLowerCase()
    .includes(missingGasCoinsErrorFragment)

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
  const resetTransactionState = useCallback(() => {
    setTransactionState({ status: "idle" })
  }, [])

  const walletAddress = currentAccount?.address
  const { expectedChain, accountChains, chainMismatch, localnetSupported } =
    useMemo(
      () =>
        resolveWalletNetworkPreflight({
          network,
          accountChainsInput: currentAccount?.chains,
          walletChainSupport: currentWallet ?? currentAccount ?? undefined
        }),
      [currentAccount, currentWallet, network]
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

      const buildTransaction = () => {
        const transaction = buildCreateTraderAccountTransaction({
          ammPackageId,
          deepbookRegistry,
          ownerAddress: walletAddress
        })
        transaction.setSender(walletAddress)
        return transaction
      }

      const { digest, transactionBlock } = await executeTransaction({
        buildTransaction,
        isLocalnet,
        expectedChain,
        localnetExecutor,
        signAndExecuteTransaction: signAndExecuteTransaction.mutateAsync,
        suiClient,
        retryLocalnetWithoutDryRunWhen: includesMissingGasCoinsError
      })

      const summary = buildTraderAccountCreateSummary({
        digest,
        transactionBlock,
        ownerAddress: walletAddress
      })

      setTransactionState({
        status: "success",
        summary
      })
      onCreated?.()

      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success("Trader account created.", toastId)
      }
    } catch (error) {
      const localnetSupportNote = resolveLocalnetSupportNote({
        isLocalnet,
        localnetSupported
      })
      const formattedError = formatErrorMessage(error)
      const errorMessage = withOptionalSupportNote({
        message: formattedError,
        supportNote: localnetSupportNote
      })
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
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  return {
    canCreate: Boolean(canCreate),
    disabledReason,
    transactionState,
    createTraderAccount,
    resetTransactionState
  }
}

export default useCreateTraderAccountAction
