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
import { resolveAmmConfigInputs } from "@sui-amm/domain-core/models/amm"
import { buildCreateExecutorTransaction } from "@sui-amm/domain-core/ptb/amm"
import { resolveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { validateRequiredHexBytes } from "@sui-amm/tooling-core/utils/validation"
import { useCallback, useMemo, useState } from "react"
import type {
  AmmConfigFieldKey,
  AmmConfigFormState
} from "../components/AmmConfigForm"
import type {
  MarketConfigFieldErrors,
  MarketConfigFieldKey,
  MarketConfigFormState
} from "../components/MarketConfigForm"
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
import { validateSuiObjectId } from "../helpers/suiIds"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import useExplorerUrl from "./useExplorerUrl"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useResolvedPackageId from "./useResolvedPackageId"

const PYTH_FEED_ID_BYTES = 32

const parseMoveTypeArguments = (type: string): string[] => {
  const open = type.indexOf("<")
  if (open < 0) return []
  let depth = 0
  let close = -1
  for (let i = open; i < type.length; i++) {
    if (type[i] === "<") depth++
    else if (type[i] === ">") {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  if (close < 0) return []
  const inside = type.substring(open + 1, close)
  const args: string[] = []
  let start = 0
  depth = 0
  for (let i = 0; i < inside.length; i++) {
    if (inside[i] === "<") depth++
    else if (inside[i] === ">") depth--
    else if (inside[i] === "," && depth === 0) {
      args.push(inside.substring(start, i).trim())
      start = i + 1
    }
  }
  args.push(inside.substring(start).trim())
  return args
}

const buildMarketConfigFormState = (): MarketConfigFormState => ({
  poolId: "",
  basePythPriceFeedIdHex: "",
  quotePythPriceFeedIdHex: ""
})

const buildMarketConfigFieldErrors = (
  formState: MarketConfigFormState
): MarketConfigFieldErrors => {
  const errors: MarketConfigFieldErrors = {}

  const poolError = validateSuiObjectId(
    formState.poolId,
    "DeepBook pool object ID"
  )
  if (poolError) errors.poolId = poolError

  const baseFeedError = validateRequiredHexBytes({
    value: formState.basePythPriceFeedIdHex,
    expectedBytes: PYTH_FEED_ID_BYTES,
    label: "Base Pyth price feed id"
  })
  if (baseFeedError) errors.basePythPriceFeedIdHex = baseFeedError

  const quoteFeedError = validateRequiredHexBytes({
    value: formState.quotePythPriceFeedIdHex,
    expectedBytes: PYTH_FEED_ID_BYTES,
    label: "Quote Pyth price feed id"
  })
  if (quoteFeedError) errors.quotePythPriceFeedIdHex = quoteFeedError

  return errors
}

export type CreateExecutorSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  packageId: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: CreateExecutorSummary }
  | { status: "error"; error: string; details?: string }

type CombinedFieldKey = AmmConfigFieldKey | MarketConfigFieldKey

export const useCreateExecutorState = () => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const contractPackageId = useResolvedPackageId()
  const explorerUrl = useExplorerUrl()
  const { refreshTraderAccount } = useTraderAccountContext()
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

  const [ammFormState, setAmmFormState] = useState<AmmConfigFormState>(() =>
    buildAmmConfigFormState()
  )
  const [marketFormState, setMarketFormState] = useState<MarketConfigFormState>(
    () => buildMarketConfigFormState()
  )
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<CombinedFieldKey>({ idleDelayMs: 600 })

  const walletAddress = currentAccount?.address

  const ammFieldErrors = useMemo(
    () => buildAmmConfigFieldErrors(ammFormState),
    [ammFormState]
  )
  const marketFieldErrors = useMemo(
    () => buildMarketConfigFieldErrors(marketFormState),
    [marketFormState]
  )
  const hasFieldErrors =
    Object.values(ammFieldErrors).some(Boolean) ||
    Object.values(marketFieldErrors).some(Boolean)

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(walletAddress && contractPackageId && !hasFieldErrors) &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetForm = useCallback(() => {
    setAmmFormState(buildAmmConfigFormState())
    setMarketFormState(buildMarketConfigFormState())
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
  }, [resetFieldState])

  const handleAmmInputChange = useCallback(
    <K extends AmmConfigFieldKey>(key: K, value: AmmConfigFormState[K]) => {
      markFieldChange(key)
      setAmmFormState((previous) => ({ ...previous, [key]: value }))
    },
    [markFieldChange]
  )

  const handleMarketInputChange = useCallback(
    <K extends MarketConfigFieldKey>(
      key: K,
      value: MarketConfigFormState[K]
    ) => {
      markFieldChange(key)
      setMarketFormState((previous) => ({ ...previous, [key]: value }))
    },
    [markFieldChange]
  )

  const markAmmFieldBlur = useCallback(
    (key: AmmConfigFieldKey) => markFieldBlur(key),
    [markFieldBlur]
  )

  const markMarketFieldBlur = useCallback(
    (key: MarketConfigFieldKey) => markFieldBlur(key),
    [markFieldBlur]
  )

  const ammShouldShowFieldError = useCallback(
    <K extends AmmConfigFieldKey>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const marketShouldShowFieldError = useCallback(
    <K extends MarketConfigFieldKey>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleCreateExecutor = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to create your market maker."
      })
      return
    }

    if (!contractPackageId) {
      setTransactionState({
        status: "error",
        error: "Contract package ID is not configured for this network."
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

    let failureStage:
      | "prepare"
      | "resolve-pool"
      | "parse-types"
      | "resolve-currency-base"
      | "resolve-currency-quote"
      | "execute"
      | "fetch" = "prepare"

    try {
      failureStage = "resolve-pool"
      const poolShared = await getSuiSharedObject(
        { objectId: marketFormState.poolId.trim(), mutable: true },
        { suiClient }
      )
      const poolType = poolShared.object.type
      if (!poolType) throw new Error("Pool object type is missing.")

      failureStage = "parse-types"
      const typeArguments = parseMoveTypeArguments(poolType)
      if (typeArguments.length < 2) {
        throw new Error(
          "Pool type does not expose <Base, Quote> generic arguments."
        )
      }
      const [baseAssetTypeTag, quoteAssetTypeTag] = typeArguments

      failureStage = "resolve-currency-base"
      const baseCurrencyId = await resolveCurrencyObjectId(
        { coinType: baseAssetTypeTag, fallbackRegistryScan: true },
        { suiClient }
      )
      if (!baseCurrencyId) {
        throw new Error(
          `No Currency<${baseAssetTypeTag}> object found in the coin registry.`
        )
      }
      const baseCurrencyShared = await getSuiSharedObject(
        { objectId: baseCurrencyId, mutable: false },
        { suiClient }
      )

      failureStage = "resolve-currency-quote"
      const quoteCurrencyId = await resolveCurrencyObjectId(
        { coinType: quoteAssetTypeTag, fallbackRegistryScan: true },
        { suiClient }
      )
      if (!quoteCurrencyId) {
        throw new Error(
          `No Currency<${quoteAssetTypeTag}> object found in the coin registry.`
        )
      }
      const quoteCurrencyShared = await getSuiSharedObject(
        { objectId: quoteCurrencyId, mutable: false },
        { suiClient }
      )

      const inputs = resolveAmmConfigInputs({
        baseSpreadBps: ammFormState.baseSpreadBps.trim(),
        volatilityMultiplierBps: ammFormState.volatilityMultiplierBps.trim(),
        basePythPriceFeedIdHex: marketFormState.basePythPriceFeedIdHex.trim(),
        quotePythPriceFeedIdHex: marketFormState.quotePythPriceFeedIdHex.trim(),
        orderExpirationTimeMs: ammFormState.orderExpirationTimeMs.trim(),
        maxPriceAgeSecs: ammFormState.maxPriceAgeSecs.trim(),
        maxConfRatioBps: ammFormState.maxConfRatioBps.trim(),
        outerBalanceBps: ammFormState.outerBalanceBps.trim(),
        inventorySkewBps: ammFormState.inventorySkewBps.trim()
      })

      const createTransaction = buildCreateExecutorTransaction({
        packageId: contractPackageId,
        pool: poolShared,
        baseCurrency: baseCurrencyShared,
        quoteCurrency: quoteCurrencyShared,
        baseAssetTypeTag,
        quoteAssetTypeTag,
        senderAddress: walletAddress,
        baseSpreadBps: inputs.baseSpreadBps,
        volatilityMultiplierBps: inputs.volatilityMultiplierBps,
        basePythPriceFeedIdBytes: inputs.basePythPriceFeedIdBytes,
        quotePythPriceFeedIdBytes: inputs.quotePythPriceFeedIdBytes,
        orderExpirationTimeMs: inputs.orderExpirationTimeMs,
        maxPriceAgeSecs: inputs.maxPriceAgeSecs,
        maxConfRatioBps: inputs.maxConfRatioBps,
        outerBalanceBps: inputs.outerBalanceBps,
        inventorySkewBps: inputs.inventorySkewBps
      })
      createTransaction.setSender(walletAddress)

      failureStage = "execute"
      let digest = ""

      if (isLocalnet) {
        const result = await localnetExecutor(createTransaction, {
          chain: expectedChain
        })
        digest = result.digest
      } else {
        const result = await signAndExecuteTransaction.mutateAsync({
          transaction: createTransaction,
          chain: expectedChain
        })
        digest = result.digest
      }

      failureStage = "fetch"
      // Wait for indexing to settle so the next AdminCap lookup actually finds
      // the new cap and resolution can flip to "ready".
      const transactionBlock = await waitForTransactionBlock(suiClient, digest)

      setTransactionState({
        status: "success",
        summary: {
          digest,
          transactionBlock,
          packageId: contractPackageId
        }
      })
      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success(`Market maker created (${digest})`, toastId)
      }

      refreshTraderAccount()
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
    ammFormState,
    contractPackageId,
    currentAccount,
    currentWallet,
    explorerUrl,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    marketFormState,
    network,
    refreshTraderAccount,
    signAndExecuteTransaction,
    suiClient,
    walletAddress
  ])

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"

  return {
    ammFormState,
    ammFieldErrors,
    ammHandleInputChange: handleAmmInputChange,
    ammMarkFieldBlur: markAmmFieldBlur,
    ammShouldShowFieldError,
    marketFormState,
    marketFieldErrors,
    marketHandleInputChange: handleMarketInputChange,
    marketMarkFieldBlur: markMarketFieldBlur,
    marketShouldShowFieldError,
    transactionState,
    isSuccessState,
    isErrorState,
    canSubmit,
    handleCreateExecutor,
    resetForm
  }
}
