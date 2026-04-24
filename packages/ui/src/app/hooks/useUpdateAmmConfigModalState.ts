"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { IdentifierString } from "@mysten/wallet-standard"
import type { AmmConfigOverview } from "@sui-amm/domain-core/models/amm"
import {
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildUpdateConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
import { deriveRelevantPackageId } from "@sui-amm/tooling-core/object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  AmmConfigFieldKey,
  AmmConfigFormState
} from "../components/AmmConfigForm"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
import {
  buildAmmConfigFieldErrors,
  buildAmmConfigFormState
} from "../helpers/ammConfigValidation"
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
import useExplorerUrl from "./useExplorerUrl"
import { useIdleFieldValidation } from "./useIdleFieldValidation"

export type AmmConfigUpdateSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  adminCapId: string
  packageId: string
  ammConfig: AmmConfigOverview
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: AmmConfigUpdateSummary }
  | { status: "error"; error: string; details?: string }

const buildOptimisticOverview = ({
  currentConfig,
  configId,
  formState
}: {
  currentConfig?: AmmConfigOverview
  configId: string
  formState: AmmConfigFormState
}): AmmConfigOverview => ({
  configId,
  baseSpreadBps: formState.baseSpreadBps.trim(),
  volatilityMultiplierBps: formState.volatilityMultiplierBps.trim(),
  active: currentConfig?.active ?? true,
  basePythPriceFeedIdHex: currentConfig?.basePythPriceFeedIdHex ?? "",
  quotePythPriceFeedIdHex: currentConfig?.quotePythPriceFeedIdHex ?? "",
  poolId: currentConfig?.poolId ?? "0x0",
  orderExpirationTimeMs: formState.orderExpirationTimeMs.trim(),
  maxPriceAgeSecs: formState.maxPriceAgeSecs.trim(),
  maxConfRatioBps: formState.maxConfRatioBps.trim(),
  outerBalanceBps: formState.outerBalanceBps.trim(),
  inventorySkewBps: formState.inventorySkewBps.trim()
})

const ammConfigMatches = (
  first: AmmConfigOverview,
  second: AmmConfigOverview
) =>
  first.baseSpreadBps === second.baseSpreadBps &&
  first.volatilityMultiplierBps === second.volatilityMultiplierBps &&
  first.orderExpirationTimeMs === second.orderExpirationTimeMs &&
  first.maxPriceAgeSecs === second.maxPriceAgeSecs &&
  first.maxConfRatioBps === second.maxConfRatioBps &&
  first.outerBalanceBps === second.outerBalanceBps &&
  first.inventorySkewBps === second.inventorySkewBps &&
  first.active === second.active

export const useUpdateAmmConfigModalState = ({
  open,
  ammConfigId,
  ammConfig,
  onConfigUpdated
}: {
  open: boolean
  ammConfigId?: string
  ammConfig?: AmmConfigOverview
  onConfigUpdated?: (config: AmmConfigOverview) => void
}) => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const explorerUrl = useExplorerUrl()
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

  const [formState, setFormState] = useState<AmmConfigFormState>(() =>
    buildAmmConfigFormState(ammConfig)
  )
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    fieldDirty,
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<AmmConfigFieldKey>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(
    () => buildAmmConfigFieldErrors(formState),
    [formState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)
  const hasDirtyFields = useMemo(
    () => Object.values(fieldDirty).some(Boolean),
    [fieldDirty]
  )

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && ammConfigId && !hasFieldErrors) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetForm = useCallback(() => {
    setFormState(buildAmmConfigFormState(ammConfig))
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [ammConfig, resetFieldState])

  useEffect(() => {
    if (!open) return
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [open, resetFieldState])

  useEffect(() => {
    if (!open) return
    if (hasDirtyFields || hasAttemptedSubmit) return
    setFormState(buildAmmConfigFormState(ammConfig))
  }, [ammConfig, hasAttemptedSubmit, hasDirtyFields, open])

  const handleInputChange = useCallback(
    <K extends AmmConfigFieldKey>(key: K, value: AmmConfigFormState[K]) => {
      markFieldChange(key)
      setFormState((previous) => ({
        ...previous,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends AmmConfigFieldKey>(
      key: K,
      error?: string
    ): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleUpdateAmmConfig = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to update the AMM configuration."
      })
      return
    }

    if (!ammConfigId) {
      setTransactionState({
        status: "error",
        error: "AMM config ID is required to update configuration."
      })
      return
    }

    if (hasFieldErrors) return

    const expectedChain = `sui:${network}` as IdentifierString
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount ?? undefined,
      expectedChain
    )
    const walletFeatureKeys = currentWallet
      ? Object.keys(currentWallet.features)
      : []
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
      localnetSupported,
      walletFeatureKeys
    }

    if (!isLocalnet && chainMismatch) {
      setTransactionState({
        status: "error",
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
        error: "No wallet connected. Connect a wallet to continue.",
        details: safeJsonStringify(
          { walletContext, reason: "wallet_missing" },
          2
        )
      })
      return
    }

    setTransactionState({ status: "processing" })
    const toastId = notification.txLoading()

    let failureStage: "prepare" | "execute" | "fetch" | "refresh" = "prepare"

    try {
      const updateInputs = resolveAmmConfigInputs({
        baseSpreadBps: formState.baseSpreadBps.trim(),
        volatilityMultiplierBps: formState.volatilityMultiplierBps.trim(),
        basePythPriceFeedIdHex: ammConfig?.basePythPriceFeedIdHex ?? "",
        quotePythPriceFeedIdHex: ammConfig?.quotePythPriceFeedIdHex ?? "",
        orderExpirationTimeMs: formState.orderExpirationTimeMs.trim(),
        maxPriceAgeSecs: formState.maxPriceAgeSecs.trim(),
        maxConfRatioBps: formState.maxConfRatioBps.trim(),
        outerBalanceBps: formState.outerBalanceBps.trim(),
        inventorySkewBps: formState.inventorySkewBps.trim()
      })

      const configShared = await getSuiSharedObject(
        { objectId: ammConfigId, mutable: true },
        { suiClient }
      )
      const configId = configShared.object.objectId
      const packageId = deriveRelevantPackageId(configShared.object.type)
      const adminCapId = await resolveAmmAdminCapId({
        ownerAddress: walletAddress,
        packageId,
        suiClient
      })

      if (!adminCapId)
        throw new Error(
          "No AMM admin capability found for the connected wallet."
        )

      const updateTransaction = buildUpdateConfigTransaction({
        packageId,
        executor: configShared,
        adminCapId,
        baseSpreadBps: updateInputs.baseSpreadBps,
        volatilityMultiplierBps: updateInputs.volatilityMultiplierBps,
        orderExpirationTimeMs: updateInputs.orderExpirationTimeMs,
        maxPriceAgeSecs: updateInputs.maxPriceAgeSecs,
        maxConfRatioBps: updateInputs.maxConfRatioBps,
        outerBalanceBps: updateInputs.outerBalanceBps,
        inventorySkewBps: updateInputs.inventorySkewBps
      })
      updateTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      failureStage = "execute"
      if (isLocalnet) {
        const result = await localnetExecutor(updateTransaction, {
          chain: expectedChain
        })
        digest = result.digest
      } else {
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: updateTransaction,
          chain: expectedChain
        })
        digest = result.digest
      }

      failureStage = "fetch"
      // Wait for indexing so the optimistic refresh below sees the new state.
      transactionBlock = await waitForTransactionBlock(suiClient, digest)

      const optimisticOverview = buildOptimisticOverview({
        currentConfig: ammConfig,
        configId,
        formState
      })

      setTransactionState({
        status: "success",
        summary: {
          digest,
          transactionBlock,
          adminCapId,
          packageId,
          ammConfig: optimisticOverview
        }
      })
      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success(`AMM config updated (${digest})`, toastId)
      }

      onConfigUpdated?.(optimisticOverview)

      try {
        failureStage = "refresh"
        const refreshedOverview = await getAmmConfigOverview(
          configId,
          suiClient
        )
        // If refreshedOverview is stale relative to optimisticOverview, keep the optimistic summary/state.
        if (!ammConfigMatches(refreshedOverview, optimisticOverview)) return
        setTransactionState({
          status: "success",
          summary: {
            digest,
            transactionBlock,
            adminCapId,
            packageId,
            ammConfig: refreshedOverview
          }
        })
        onConfigUpdated?.(refreshedOverview)
      } catch {
        // Keep optimistic summary when refresh fails or returns stale data.
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error)
      const localnetSupportNote =
        isLocalnet && !localnetSupported && failureStage === "execute"
          ? "Wallet may not support sui:localnet signing."
          : undefined
      const errorDetailsRaw = safeJsonStringify(
        {
          summary: errorDetails,
          raw: serializeForJson(error),
          failureStage,
          localnetSupportNote,
          walletContext
        },
        2
      )
      const formattedError = formatErrorMessage(error)
      const errorMessage = localnetSupportNote
        ? `${formattedError} ${localnetSupportNote}`
        : formattedError
      setTransactionState({
        status: "error",
        error: errorMessage,
        details: errorDetailsRaw
      })
      notification.txError(
        error instanceof Error ? error : undefined,
        errorMessage,
        toastId
      )
    }
  }, [
    ammConfig,
    ammConfigId,
    currentAccount,
    currentWallet,
    explorerUrl,
    formState,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    network,
    onConfigUpdated,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  return {
    formState,
    fieldErrors,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleUpdateAmmConfig,
    resetForm
  }
}
