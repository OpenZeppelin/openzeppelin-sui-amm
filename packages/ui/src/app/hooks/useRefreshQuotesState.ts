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
import { SuiPythClient } from "@pythnetwork/pyth-sui-js"
import { readPythPriceComponentsFromContent } from "@sui-amm/domain-core/models/pyth"
import { buildLocalnetRefreshQuotesTransaction } from "@sui-amm/domain-core/ptb/amm"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { useCallback, useMemo, useState } from "react"
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
import useDeploymentArtifacts from "./useDeploymentArtifacts"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; digest: string }
  | { status: "error"; error: string; details?: string }

export const useRefreshQuotesState = () => {
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

  const localnetArtifactsMissing =
    isLocalnet && (!localnetPythMockPackageId || !localnetPythStateId)

  const supportsNetwork = isLocalnet
  const canSubmit =
    supportsNetwork &&
    !localnetArtifactsMissing &&
    Boolean(
      walletAddress && contractPackageId && executorId && traderAccount
    ) &&
    traderAccount?.active === true &&
    !isProcessing &&
    isSubmissionPending !== true

  const disabledReason = (() => {
    if (!walletAddress) return "Connect a wallet."
    if (!contractPackageId) return "Contract package ID missing."
    if (!supportsNetwork)
      return "Manual refresh is implemented for localnet only. Real Pyth updates require Hermes VAA integration."
    if (localnetArtifactsMissing)
      return "Mock Pyth package/state IDs missing — run `pnpm mock:setup` and reload."
    if (!traderAccount) return "Market maker overview still loading."
    if (traderAccount.active === false)
      return "Executor is paused — unpause first."
    return undefined
  })()

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
    if (!isLocalnet) {
      setTransactionState({
        status: "error",
        error:
          "Manual refresh is only implemented on localnet. Mainnet/testnet would require fetching Pyth VAA updates via Hermes before calling refresh_quotes_permissionless."
      })
      return
    }
    if (!localnetPythMockPackageId || !localnetPythStateId) {
      setTransactionState({
        status: "error",
        error:
          "Mock Pyth artifacts are not configured. Re-run `pnpm mock:setup` and reload the page."
      })
      return
    }

    const expectedChain = `sui:${network}` as IdentifierString
    const accountChains = currentAccount?.chains ?? []
    const localnetSupported = walletSupportsChain(
      currentWallet ?? currentAccount ?? undefined,
      expectedChain
    )

    const walletContext = {
      appNetwork: network,
      expectedChain,
      walletName: currentWallet?.name,
      walletVersion: currentWallet?.version,
      accountAddress: walletAddress,
      accountChains,
      localnetSupported
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
      | "resolve-price-info"
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

      failureStage = "resolve-price-info"
      // Resolve the on-chain PriceInfoObject IDs from the feed-id hex stored
      // in `Market.{base,quote}.pyth_price_feed_id`. The mock Pyth `State`
      // exposes the same `b"price_info"` dynamic-field registry as real Pyth,
      // so the SDK call works identically on localnet and on real networks.
      // Wormhole isn't used by `getPriceFeedObjectId`, so reusing the pyth
      // state id as a stand-in is safe on localnet.
      const pythClient = new SuiPythClient(
        suiClient,
        localnetPythStateId,
        localnetPythStateId
      )
      const [basePriceInfoObjectId, quotePriceInfoObjectId] = await Promise.all(
        [
          pythClient.getPriceFeedObjectId(traderAccount.basePythPriceFeedIdHex),
          pythClient.getPriceFeedObjectId(traderAccount.quotePythPriceFeedIdHex)
        ]
      )
      if (!basePriceInfoObjectId || !quotePriceInfoObjectId) {
        throw new Error(
          `Pyth state ${localnetPythStateId} has no PriceInfoObject for feed(s) ${[
            !basePriceInfoObjectId
              ? `base ${traderAccount.basePythPriceFeedIdHex}`
              : undefined,
            !quotePriceInfoObjectId
              ? `quote ${traderAccount.quotePythPriceFeedIdHex}`
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

      // Stamp each PriceInfoObject with the value it ALREADY holds — we just
      // need to bump its `timestamp` so the executor's
      // `assert_price_age_within_limit` check passes. Reading the on-chain
      // magnitude/expo first preserves whatever the market-activity bot has
      // walked the price to instead of clobbering it with a hardcoded default.
      const basePriceComponents = readPythPriceComponentsFromContent(
        basePriceInfo.object.content
      )
      const quotePriceComponents = readPythPriceComponentsFromContent(
        quotePriceInfo.object.content
      )

      const transaction = buildLocalnetRefreshQuotesTransaction({
        packageId: contractPackageId,
        executor: executorShared,
        pool: poolShared,
        baseAssetTypeTag: traderAccount.baseCoinType,
        quoteAssetTypeTag: traderAccount.quoteCoinType,
        pythMockPackageId: localnetPythMockPackageId,
        basePriceInfoObject: basePriceInfo,
        quotePriceInfoObject: quotePriceInfo,
        basePriceComponents,
        quotePriceComponents
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
        notification.success(`Quotes refreshed (${digest})`, toastId)
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
    isLocalnet,
    localnetExecutor,
    localnetPythMockPackageId,
    localnetPythStateId,
    network,
    refreshTraderAccount,
    signAndExecuteTransaction,
    suiClient,
    traderAccount,
    walletAddress
  ])

  return {
    transactionState,
    canSubmit,
    disabledReason,
    isProcessing,
    supportsNetwork,
    handleSubmit
  }
}
