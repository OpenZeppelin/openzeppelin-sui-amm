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
import { readPythPriceComponentsFromContent } from "@sui-amm/domain-core/models/pyth"
import {
  buildUpdateConfigAndCancelTransaction,
  buildUpdateConfigAndLocalnetRefreshTransaction
} from "@sui-amm/domain-core/ptb/amm"
import { SuiPythClient } from "@pythnetwork/pyth-sui-js"
import { deriveRelevantPackageId } from "@sui-amm/tooling-core/object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import type {
  AmmConfigFieldKey,
  AmmConfigFormState
} from "../components/AmmConfigForm"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
import { readSelectedAdminCapId } from "../helpers/selectedAdminCap"
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
import useDeploymentArtifacts from "./useDeploymentArtifacts"
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
  baseCoinType: currentConfig?.baseCoinType ?? "",
  quoteCoinType: currentConfig?.quoteCoinType ?? "",
  orderExpirationTimeMs: formState.orderExpirationTimeMs.trim(),
  maxPriceAgeSecs: formState.maxPriceAgeSecs.trim(),
  maxConfRatioBps: formState.maxConfRatioBps.trim(),
  outerBalanceBps: formState.outerBalanceBps.trim(),
  inventorySkewBps: formState.inventorySkewBps.trim(),
  postOnly: formState.postOnly.trim().toLowerCase() === "true"
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
  first.postOnly === second.postOnly &&
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
  const {
    pythMockPackageId: localnetPythMockPackageId,
    pythStateId: localnetPythStateId
  } = useDeploymentArtifacts()
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

  // Update & refresh requires the localnet mock-Pyth artifacts (Hermes VAA
  // fetching isn't wired up here, so the refresh consumer is localnet-only)
  // and an active executor (refresh_quotes_pyth_after_update aborts on a
  // paused executor).
  const localnetRefreshArtifactsReady = Boolean(
    localnetPythMockPackageId && localnetPythStateId
  )
  const refreshDisabledReason = (() => {
    if (!isLocalnet)
      return "Update & refresh quotes is localnet-only (no Hermes VAA wiring on real networks)."
    if (!localnetRefreshArtifactsReady)
      return "Mock Pyth artifacts missing — run `pnpm mock:setup` and reload."
    if (ammConfig && ammConfig.active === false)
      return "Executor is paused — unpause before refreshing quotes."
    return undefined
  })()
  const canSubmitRefresh = canSubmit && refreshDisabledReason === undefined

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
    <K extends AmmConfigFieldKey>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleUpdateAmmConfig = useCallback(async (
    variant: "cancel" | "localnet-refresh" = "cancel"
  ) => {
    setHasAttemptedSubmit(true)

    if (variant === "localnet-refresh" && refreshDisabledReason !== undefined) {
      setTransactionState({ status: "error", error: refreshDisabledReason })
      return
    }

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
        inventorySkewBps: formState.inventorySkewBps.trim(),
        postOnly: formState.postOnly.trim()
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
        preferredAdminCapId: readSelectedAdminCapId(),
        suiClient
      })

      if (!adminCapId)
        throw new Error(
          "No AMM admin capability found for the connected wallet."
        )

      if (!ammConfig?.poolId || !ammConfig.baseCoinType || !ammConfig.quoteCoinType) {
        throw new Error(
          "AMM config overview is missing pool / base / quote metadata required to cancel the live ladder."
        )
      }

      const poolShared = await getSuiSharedObject(
        { objectId: ammConfig.poolId, mutable: true },
        { suiClient }
      )

      const commonBuildArgs = {
        packageId,
        executor: configShared,
        adminCapId,
        pool: poolShared,
        baseAssetTypeTag: ammConfig.baseCoinType,
        quoteAssetTypeTag: ammConfig.quoteCoinType,
        baseSpreadBps: updateInputs.baseSpreadBps,
        volatilityMultiplierBps: updateInputs.volatilityMultiplierBps,
        orderExpirationTimeMs: updateInputs.orderExpirationTimeMs,
        maxPriceAgeSecs: updateInputs.maxPriceAgeSecs,
        maxConfRatioBps: updateInputs.maxConfRatioBps,
        outerBalanceBps: updateInputs.outerBalanceBps,
        inventorySkewBps: updateInputs.inventorySkewBps,
        postOnly: updateInputs.postOnly
      }

      let updateTransaction
      if (variant === "cancel") {
        updateTransaction = buildUpdateConfigAndCancelTransaction(
          commonBuildArgs
        )
      } else {
        // localnet-refresh variant: gating above guarantees
        // localnetPythMockPackageId / localnetPythStateId are present and the
        // network is localnet, but TS doesn't see that — narrow defensively.
        if (!localnetPythMockPackageId || !localnetPythStateId) {
          throw new Error(
            "Mock Pyth artifacts are not configured. Re-run `pnpm mock:setup`."
          )
        }
        // Resolve the on-chain PriceInfoObject IDs from the feed-id hex stored
        // in `Market.{base,quote}.pyth_price_feed_id`. The mock Pyth `State`
        // exposes the same `b"price_info"` dynamic-field registry as real
        // Pyth, so the SDK call works identically on localnet.
        const pythClient = new SuiPythClient(
          suiClient,
          localnetPythStateId,
          localnetPythStateId
        )
        const [basePriceInfoObjectId, quotePriceInfoObjectId] =
          await Promise.all([
            pythClient.getPriceFeedObjectId(ammConfig.basePythPriceFeedIdHex),
            pythClient.getPriceFeedObjectId(ammConfig.quotePythPriceFeedIdHex)
          ])
        if (!basePriceInfoObjectId || !quotePriceInfoObjectId) {
          throw new Error(
            `Pyth state ${localnetPythStateId} has no PriceInfoObject for feed(s) ${[
              !basePriceInfoObjectId
                ? `base ${ammConfig.basePythPriceFeedIdHex}`
                : undefined,
              !quotePriceInfoObjectId
                ? `quote ${ammConfig.quotePythPriceFeedIdHex}`
                : undefined
            ]
              .filter(Boolean)
              .join(", ")}. Re-run mock:setup --re-publish to seed missing feeds.`
          )
        }
        const [basePriceInfo, quotePriceInfo] =
          basePriceInfoObjectId === quotePriceInfoObjectId
            ? await Promise.all([
                getSuiSharedObject(
                  { objectId: basePriceInfoObjectId, mutable: true },
                  { suiClient }
                )
              ]).then(([shared]) => [shared, shared] as const)
            : await Promise.all([
                getSuiSharedObject(
                  { objectId: basePriceInfoObjectId, mutable: true },
                  { suiClient }
                ),
                getSuiSharedObject(
                  { objectId: quotePriceInfoObjectId, mutable: true },
                  { suiClient }
                )
              ])

        // Re-stamp each PriceInfoObject with the magnitude it already holds —
        // only the `timestamp` advances so `assert_price_age_within_limit`
        // inside the executor passes. Preserves whatever the market-activity
        // bot has walked the price to instead of clobbering it.
        const basePriceComponents = readPythPriceComponentsFromContent(
          basePriceInfo.object.content
        )
        const quotePriceComponents = readPythPriceComponentsFromContent(
          quotePriceInfo.object.content
        )

        updateTransaction = buildUpdateConfigAndLocalnetRefreshTransaction({
          ...commonBuildArgs,
          pythMockPackageId: localnetPythMockPackageId,
          basePriceInfoObject: basePriceInfo,
          quotePriceInfoObject: quotePriceInfo,
          basePriceComponents,
          quotePriceComponents
        })
      }
      updateTransaction.setSender(walletAddress)

      let digest = ""

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
      const transactionBlock = await waitForTransactionBlock(suiClient, digest)

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
    localnetPythMockPackageId,
    localnetPythStateId,
    network,
    onConfigUpdated,
    refreshDisabledReason,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  const handleUpdateAndRefreshAmmConfig = useCallback(
    () => handleUpdateAmmConfig("localnet-refresh"),
    [handleUpdateAmmConfig]
  )

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
    canSubmitRefresh,
    refreshDisabledReason,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleUpdateAmmConfig,
    handleUpdateAndRefreshAmmConfig,
    resetForm
  }
}
