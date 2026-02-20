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
  DEFAULT_BASE_SPREAD_BPS,
  DEFAULT_VOLATILITY_MULTIPLIER_BPS,
  getAmmConfigOverview,
  resolveAmmConfigInputs
} from "@sui-amm/domain-core/models/amm"
import { buildUpdateAmmConfigTransaction } from "@sui-amm/domain-core/ptb/amm"
import { deriveRelevantPackageId } from "@sui-amm/tooling-core/object"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import {
  parseNonNegativeU64,
  parsePositiveU64
} from "@sui-amm/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"
import {
  resolveValidationMessage,
  validateRequiredHexBytes
} from "../helpers/inputValidation"
import {
  getLocalnetClient,
  makeLocalnetExecutor,
  walletSupportsChain
} from "../helpers/localnet"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useIdleFieldValidation } from "./useIdleFieldValidation"

const PYTH_PRICE_FEED_ID_BYTES = 32

type AmmUpdateFormState = {
  baseSpreadBps: string
  volatilityMultiplierBps: string
  useLaser: boolean
  tradingPaused: boolean
  pythPriceFeedIdHex: string
}

type AmmUpdateFieldErrors = Partial<Record<keyof AmmUpdateFormState, string>>

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

const buildFormState = (ammConfig?: AmmConfigOverview): AmmUpdateFormState => ({
  baseSpreadBps: ammConfig?.baseSpreadBps ?? DEFAULT_BASE_SPREAD_BPS,
  volatilityMultiplierBps:
    ammConfig?.volatilityMultiplierBps ?? DEFAULT_VOLATILITY_MULTIPLIER_BPS,
  useLaser: ammConfig?.useLaser ?? false,
  tradingPaused: ammConfig?.tradingPaused ?? false,
  pythPriceFeedIdHex: ammConfig?.pythPriceFeedIdHex ?? ""
})

const buildFieldErrors = (
  formState: AmmUpdateFormState
): AmmUpdateFieldErrors => {
  const errors: AmmUpdateFieldErrors = {}
  const baseSpreadBps = formState.baseSpreadBps.trim()
  const volatilityMultiplierBps = formState.volatilityMultiplierBps.trim()

  if (!baseSpreadBps) {
    errors.baseSpreadBps = "Base spread is required."
  } else {
    try {
      parsePositiveU64(baseSpreadBps, "Base spread bps")
    } catch (error) {
      errors.baseSpreadBps = resolveValidationMessage(
        error,
        "Base spread must be a valid u64."
      )
    }
  }

  if (!volatilityMultiplierBps) {
    errors.volatilityMultiplierBps = "Volatility multiplier is required."
  } else {
    try {
      parseNonNegativeU64(volatilityMultiplierBps, "Volatility multiplier bps")
    } catch (error) {
      errors.volatilityMultiplierBps = resolveValidationMessage(
        error,
        "Volatility multiplier must be a valid u64."
      )
    }
  }

  const feedError = validateRequiredHexBytes({
    value: formState.pythPriceFeedIdHex,
    expectedBytes: PYTH_PRICE_FEED_ID_BYTES,
    label: "Pyth price feed id"
  })
  if (feedError) errors.pythPriceFeedIdHex = feedError

  return errors
}

const buildFallbackOverview = ({
  configId,
  formState,
  baseSpreadBps,
  volatilityMultiplierBps,
  pythPriceFeedIdHex
}: {
  configId: string
  formState: AmmUpdateFormState
  baseSpreadBps: bigint
  volatilityMultiplierBps: bigint
  pythPriceFeedIdHex: string
}): AmmConfigOverview => ({
  configId,
  baseSpreadBps: baseSpreadBps.toString(),
  volatilityMultiplierBps: volatilityMultiplierBps.toString(),
  useLaser: formState.useLaser,
  tradingPaused: formState.tradingPaused,
  pythPriceFeedIdHex
})

const ammConfigMatches = (
  first: AmmConfigOverview,
  second: AmmConfigOverview
) =>
  first.baseSpreadBps === second.baseSpreadBps &&
  first.volatilityMultiplierBps === second.volatilityMultiplierBps &&
  first.useLaser === second.useLaser &&
  first.tradingPaused === second.tradingPaused &&
  first.pythPriceFeedIdHex === second.pythPriceFeedIdHex

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

  const [formState, setFormState] = useState<AmmUpdateFormState>(() =>
    buildFormState(ammConfig)
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
  } = useIdleFieldValidation<keyof AmmUpdateFormState>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const fieldErrors = useMemo(() => buildFieldErrors(formState), [formState])
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
    setFormState(buildFormState(ammConfig))
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
    setFormState(buildFormState(ammConfig))
  }, [ammConfig, hasAttemptedSubmit, hasDirtyFields, open])

  const handleInputChange = useCallback(
    <K extends keyof AmmUpdateFormState>(
      key: K,
      value: AmmUpdateFormState[K]
    ) => {
      markFieldChange(key)
      setFormState((previous) => ({
        ...previous,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof AmmUpdateFormState>(
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

    let failureStage: "prepare" | "execute" | "fetch" | "refresh" = "prepare"

    try {
      const updateInputs = await resolveAmmConfigInputs({
        baseSpreadBps: formState.baseSpreadBps.trim(),
        volatilityMultiplierBps: formState.volatilityMultiplierBps.trim(),
        useLaser: formState.useLaser,
        pythPriceFeedIdHex: formState.pythPriceFeedIdHex.trim()
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

      const updateTransaction = buildUpdateAmmConfigTransaction({
        packageId,
        adminCapId,
        config: configShared,
        baseSpreadBps: updateInputs.baseSpreadBps,
        volatilityMultiplierBps: updateInputs.volatilityMultiplierBps,
        useLaser: updateInputs.useLaser,
        tradingPaused: formState.tradingPaused,
        pythPriceFeedIdBytes: updateInputs.pythPriceFeedIdBytes
      })
      updateTransaction.setSender(walletAddress)

      let digest = ""
      let transactionBlock: SuiTransactionBlockResponse

      if (isLocalnet) {
        failureStage = "execute"
        const result = await localnetExecutor(updateTransaction, {
          chain: expectedChain
        })
        digest = result.digest
        transactionBlock = result
      } else {
        failureStage = "execute"
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: updateTransaction,
          chain: expectedChain
        })

        failureStage = "fetch"
        digest = result.digest
        transactionBlock = await waitForTransactionBlock(suiClient, digest)
      }

      const optimisticOverview = buildFallbackOverview({
        configId,
        formState,
        baseSpreadBps: updateInputs.baseSpreadBps,
        volatilityMultiplierBps: updateInputs.volatilityMultiplierBps,
        pythPriceFeedIdHex: updateInputs.pythPriceFeedIdHex
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

      onConfigUpdated?.(optimisticOverview)

      try {
        failureStage = "refresh"
        const refreshedOverview = await getAmmConfigOverview(
          configId,
          suiClient
        )
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
    }
  }, [
    ammConfigId,
    currentAccount,
    currentWallet,
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
