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
import {
  SUI_USD_FEED,
  USDC_USD_FEED
} from "@sui-amm/domain-core/models/pyth"
import { buildCreateExecutorTransaction } from "@sui-amm/domain-core/ptb/amm"
import { normalizeStructTag } from "@mysten/sui/utils"
import { resolveCurrencyObjectId } from "@sui-amm/tooling-core/coin-registry"
import { SUI_COIN_TYPE } from "@sui-amm/tooling-core/constants"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { validateRequiredHexBytes } from "@sui-amm/tooling-core/utils/validation"
import { useCallback, useEffect, useMemo, useState } from "react"
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
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import { waitForTransactionBlock } from "../helpers/transactionWait"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import type { DeploymentArtifacts } from "./useDeploymentArtifacts"
import useDeploymentArtifacts from "./useDeploymentArtifacts"
import useExplorerUrl from "./useExplorerUrl"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useResolvedPackageId from "./useResolvedPackageId"

const PYTH_FEED_ID_BYTES = 32

// Move type tags are 2-3 hex packageId + `::module::TYPE`. The simplest test
// that's useful as a form-time validation is "non-empty + at least one `::`";
// real type-tag well-formedness is enforced at submit by `normalizeStructTag`,
// which throws on garbage.
const isPlausibleTypeTag = (value: string): boolean =>
  value.trim().length > 0 && value.trim().includes("::")

const findArtifactPool = ({
  artifacts,
  baseAssetTypeTag,
  quoteAssetTypeTag
}: {
  artifacts: DeploymentArtifacts
  baseAssetTypeTag: string
  quoteAssetTypeTag: string
}) => {
  const normalizedBase = normalizeStructTag(baseAssetTypeTag)
  const normalizedQuote = normalizeStructTag(quoteAssetTypeTag)
  return artifacts.pools.find(
    (entry) =>
      normalizeStructTag(entry.baseCoinType) === normalizedBase &&
      normalizeStructTag(entry.quoteCoinType) === normalizedQuote
  )
}

// The localnet USDC mock's coin type embeds a per-deployment package id, so
// the default for the quote-asset field has to come from the artifact rather
// than a static constant. SUI is fixed at `0x2::sui::SUI` and used unchanged.
const buildMarketConfigFormState = (
  artifacts?: DeploymentArtifacts
): MarketConfigFormState => {
  const usdcCoin = artifacts?.coins.find((coin) => coin.label === "USDC")
  return {
    baseAssetTypeTag: SUI_COIN_TYPE,
    quoteAssetTypeTag: usdcCoin?.coinType ?? "",
    basePythPriceFeedIdHex: SUI_USD_FEED.feedIdHex,
    quotePythPriceFeedIdHex: USDC_USD_FEED.feedIdHex
  }
}

const buildMarketConfigFieldErrors = (
  formState: MarketConfigFormState
): MarketConfigFieldErrors => {
  const errors: MarketConfigFieldErrors = {}

  if (!isPlausibleTypeTag(formState.baseAssetTypeTag)) {
    errors.baseAssetTypeTag = "Base asset coin type is required."
  }
  if (!isPlausibleTypeTag(formState.quoteAssetTypeTag)) {
    errors.quoteAssetTypeTag = "Quote asset coin type is required."
  }

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
  const artifacts = useDeploymentArtifacts()
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
  // The localnet USDC mock's package id is generated per-deployment, so the
  // quote-asset default has to come from the artifact. Backfill once the
  // artifact resolves, but only when the field is still empty so we don't
  // clobber a user-entered type tag.
  useEffect(() => {
    const usdcCoin = artifacts.coins.find((coin) => coin.label === "USDC")
    if (!usdcCoin) return
    setMarketFormState((previous) =>
      previous.quoteAssetTypeTag.trim() === ""
        ? { ...previous, quoteAssetTypeTag: usdcCoin.coinType }
        : previous
    )
  }, [artifacts.coins])
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
      | "resolve-currency-base"
      | "resolve-currency-quote"
      | "execute"
      | "fetch" = "prepare"

    try {
      failureStage = "resolve-pool"
      const baseAssetTypeTag = marketFormState.baseAssetTypeTag.trim()
      const quoteAssetTypeTag = marketFormState.quoteAssetTypeTag.trim()
      const matchingPool = findArtifactPool({
        artifacts,
        baseAssetTypeTag,
        quoteAssetTypeTag
      })
      if (!matchingPool) {
        throw new Error(
          `No DeepBook pool found for ${baseAssetTypeTag} / ${quoteAssetTypeTag} in the deployment artifact. Run \`pnpm --filter dapp mock:pool:create\` or pick types from an existing pool.`
        )
      }
      const poolShared = await getSuiSharedObject(
        { objectId: matchingPool.poolId, mutable: true },
        { suiClient }
      )

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
    artifacts,
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
