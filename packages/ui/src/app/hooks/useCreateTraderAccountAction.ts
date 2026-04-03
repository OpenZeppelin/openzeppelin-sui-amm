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
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { LOCALNET_DEEPBOOK_REGISTRY_ID } from "../config/network"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
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

type AdminCapResolutionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; adminCapId?: string }
  | { status: "error"; error: string }

const networkUnsupportedMessage =
  "Trader account creation is not configured for the active network."
const missingAdminCapMessage =
  "Connected wallet does not own the AMM admin capability required to create trader accounts."

const resolveAdminCapErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Unable to resolve the AMM admin capability."

const resolveDisabledReason = ({
  walletAddress,
  ammPackageId,
  deepbookRegistryId,
  chainMismatch,
  network,
  adminCapResolution
}: {
  walletAddress?: string
  ammPackageId?: string
  deepbookRegistryId?: string
  chainMismatch: boolean
  network: string
  adminCapResolution: AdminCapResolutionState
}) => {
  if (!walletAddress) {
    return "Connect a wallet to create a trader account."
  }

  if (!ammPackageId) {
    return "Contract package id is not configured for this network."
  }

  if (!deepbookRegistryId) {
    return networkUnsupportedMessage
  }

  if (chainMismatch) {
    return `Switch your wallet to ${network} before creating a trader account.`
  }

  if (adminCapResolution.status === "loading") {
    return "Checking AMM admin capability."
  }

  if (adminCapResolution.status === "error") {
    return adminCapResolution.error
  }

  if (adminCapResolution.status === "ready" && !adminCapResolution.adminCapId) {
    return missingAdminCapMessage
  }

  return undefined
}

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
  const [adminCapResolution, setAdminCapResolution] =
    useState<AdminCapResolutionState>({ status: "idle" })

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

  useEffect(() => {
    let active = true

    if (!walletAddress || !ammPackageId) {
      setAdminCapResolution({ status: "idle" })
      return () => {
        active = false
      }
    }

    setAdminCapResolution({ status: "loading" })

    const load = async () => {
      try {
        const adminCapId = await resolveAmmAdminCapId({
          ownerAddress: walletAddress,
          packageId: ammPackageId,
          suiClient
        })

        if (!active) return
        setAdminCapResolution({
          status: "ready",
          adminCapId
        })
      } catch (error) {
        if (!active) return

        setAdminCapResolution({
          status: "error",
          error: resolveAdminCapErrorMessage(error)
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [ammPackageId, suiClient, walletAddress])

  const adminCapId =
    adminCapResolution.status === "ready"
      ? adminCapResolution.adminCapId
      : undefined
  const disabledReason = resolveDisabledReason({
    walletAddress,
    ammPackageId,
    deepbookRegistryId,
    chainMismatch,
    network,
    adminCapResolution
  })

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

    if (!adminCapId) {
      setTransactionState({
        status: "error",
        error:
          adminCapResolution.status === "error"
            ? adminCapResolution.error
            : missingAdminCapMessage
      })
      return
    }

    const toastId = notification.txLoading()
    setTransactionState({ status: "processing" })

    try {
      const transaction = buildCreateTraderAccountTransaction({
        ammPackageId,
        adminCapId
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
    adminCapId,
    adminCapResolution,
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
