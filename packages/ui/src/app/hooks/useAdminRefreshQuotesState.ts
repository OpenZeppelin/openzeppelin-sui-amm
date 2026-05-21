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
import { buildAdminRefreshQuotesTransaction } from "@sui-amm/domain-core/ptb/amm"
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
import { readSelectedAdminCapId } from "../helpers/selectedAdminCap"
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

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; digest: string }
  | { status: "error"; error: string; details?: string }

export type AdminRefreshFormState = {
  priceDollars: string
  confRatioPercent: string
}

export type AdminRefreshFieldErrors = {
  priceDollars?: string
  confRatioPercent?: string
}

const DEFAULT_FORM_STATE: AdminRefreshFormState = {
  priceDollars: "",
  confRatioPercent: "0"
}

const parsePositiveDecimal = (raw: string): number | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0) return undefined
  return value
}

const parseNonNegativeDecimal = (raw: string): number | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

const buildFieldErrors = (
  formState: AdminRefreshFormState
): AdminRefreshFieldErrors => {
  const errors: AdminRefreshFieldErrors = {}
  if (parsePositiveDecimal(formState.priceDollars) === undefined) {
    errors.priceDollars = "Enter a positive decimal price (e.g. 1.50)."
  }
  if (parseNonNegativeDecimal(formState.confRatioPercent) === undefined) {
    errors.confRatioPercent = "Enter a non-negative decimal percent (e.g. 1.5)."
  }
  return errors
}

// Convert human price → DeepBook fixed-point u64. Same scale the on-chain
// `Market.deepbook_price` produces and `ActiveOrdersCard.formatDeepbookPrice`
// inverts: midPrice = humanPrice * 10^(9 - baseDecimals + quoteDecimals).
const toDeepbookMidPrice = (
  priceDollars: number,
  baseDecimals: number,
  quoteDecimals: number
): bigint => {
  const adjustedDecimals = 9 - baseDecimals + quoteDecimals
  if (adjustedDecimals < 0) {
    throw new Error(
      `Unsupported decimal layout (baseDecimals=${baseDecimals}, quoteDecimals=${quoteDecimals}): 9 - base + quote is negative.`
    )
  }
  const scaled = priceDollars * 10 ** adjustedDecimals
  if (!Number.isFinite(scaled) || scaled < 0) {
    throw new Error(`Computed midPrice is non-finite or negative: ${scaled}.`)
  }
  return BigInt(Math.floor(scaled))
}

const toConfRatioBps = (confRatioPercent: number): bigint =>
  BigInt(Math.round(confRatioPercent * 100))

export const useAdminRefreshQuotesState = () => {
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

  const [formState, setFormState] =
    useState<AdminRefreshFormState>(DEFAULT_FORM_STATE)
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })

  const walletAddress = currentAccount?.address
  const executorId = resolution.traderAccountId
  const traderAccount =
    overview.status === "success" ? overview.traderAccount : undefined

  const fieldErrors = useMemo(() => buildFieldErrors(formState), [formState])
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)

  const isProcessing = transactionState.status === "processing"
  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress && contractPackageId && executorId && traderAccount
    ) &&
    traderAccount?.active === true &&
    !hasFieldErrors &&
    !isProcessing &&
    isSubmissionPending !== true

  const disabledReason = (() => {
    if (!walletAddress) return "Connect a wallet."
    if (!contractPackageId) return "Contract package ID missing."
    if (!traderAccount) return "Market maker overview still loading."
    if (traderAccount.active === false)
      return "Executor is paused — unpause first."
    return undefined
  })()

  const handleInputChange = useCallback(
    <K extends keyof AdminRefreshFormState>(
      key: K,
      value: AdminRefreshFormState[K]
    ) => {
      setFormState((previous) => ({ ...previous, [key]: value }))
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to submit."
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
    if (!executorId || !traderAccount) {
      setTransactionState({
        status: "error",
        error: "Market maker executor is not resolved yet."
      })
      return
    }
    if (hasFieldErrors) return

    const parsedPriceDollars = parsePositiveDecimal(formState.priceDollars)
    const parsedConfRatioPercent = parseNonNegativeDecimal(
      formState.confRatioPercent
    )
    if (
      parsedPriceDollars === undefined ||
      parsedConfRatioPercent === undefined
    ) {
      setTransactionState({
        status: "error",
        error: "Form inputs invalid; see field errors."
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
      | "resolve-executor"
      | "resolve-pool"
      | "resolve-admin-cap"
      | "execute"
      | "fetch" = "prepare"

    try {
      failureStage = "resolve-executor"
      const executorShared = await getSuiSharedObject(
        { objectId: executorId, mutable: true },
        { suiClient }
      )
      failureStage = "resolve-pool"
      const poolShared = await getSuiSharedObject(
        { objectId: traderAccount.poolId, mutable: true },
        { suiClient }
      )
      failureStage = "resolve-admin-cap"
      const adminCapId = await resolveAmmAdminCapId({
        ownerAddress: walletAddress,
        packageId: contractPackageId,
        preferredAdminCapId: readSelectedAdminCapId(),
        suiClient
      })
      if (!adminCapId) {
        throw new Error(
          "No AMM admin capability found for the connected wallet."
        )
      }

      const midPrice = toDeepbookMidPrice(
        parsedPriceDollars,
        traderAccount.baseDecimals,
        traderAccount.quoteDecimals
      )
      const confRatioBps = toConfRatioBps(parsedConfRatioPercent)

      const transaction = buildAdminRefreshQuotesTransaction({
        packageId: contractPackageId,
        executor: executorShared,
        adminCapId,
        pool: poolShared,
        baseAssetTypeTag: traderAccount.baseCoinType,
        quoteAssetTypeTag: traderAccount.quoteCoinType,
        midPrice,
        confRatioBps
      })
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

      setTransactionState({ status: "success", digest })
      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success(`Admin refresh submitted (${digest})`, toastId)
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
        error: formattedError,
        details: errorDetailsRaw
      })
      notification.txError(
        error instanceof Error ? error : undefined,
        formattedError,
        toastId
      )
    }
  }, [
    contractPackageId,
    currentAccount,
    currentWallet,
    executorId,
    explorerUrl,
    formState,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    network,
    refreshTraderAccount,
    signAndExecuteTransaction,
    suiClient,
    traderAccount,
    walletAddress
  ])

  return {
    formState,
    fieldErrors,
    transactionState,
    canSubmit,
    disabledReason,
    isProcessing,
    handleInputChange,
    handleSubmit
  }
}

export default useAdminRefreshQuotesState
