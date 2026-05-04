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
import {
  buildDepositTransaction,
  buildWithdrawWithPauseTransaction
} from "@sui-amm/domain-core/ptb/amm"
import {
  fetchCoinBalances,
  selectRichestCoin
} from "@sui-amm/tooling-core/coin"
import { SUI_COIN_TYPE } from "@sui-amm/tooling-core/constants"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { parseCoinAmount } from "@sui-amm/tooling-core/utils/formatters"
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
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

export type FundingMode = "deposit" | "withdraw"
export type CoinSide = "base" | "quote"

type FormState = {
  coinSide: CoinSide
  amount: string
  /**
   * Withdraw-only flag. When `true` the PTB calls `executor::withdraw_all<T>`
   * and the amount input is ignored. Has no effect for `mode === "deposit"`.
   */
  withdrawAll: boolean
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; digest: string }
  | { status: "error"; error: string; details?: string }

const initialFormState = (): FormState => ({
  coinSide: "base",
  amount: "",
  withdrawAll: false
})

const normalizeCoinType = (raw: string) => raw.trim().toLowerCase()

const isSuiCoinType = (coinType: string) =>
  normalizeCoinType(coinType) === normalizeCoinType(SUI_COIN_TYPE) ||
  normalizeCoinType(coinType).endsWith("::sui::sui")

export const useFundingState = (mode: FundingMode) => {
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

  const [formState, setFormState] = useState<FormState>(initialFormState)
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })

  const walletAddress = currentAccount?.address
  const executorId = resolution.traderAccountId
  const traderAccount =
    overview.status === "success" ? overview.traderAccount : undefined

  const activeDecimals = useMemo(() => {
    if (!traderAccount) return undefined
    return formState.coinSide === "base"
      ? traderAccount.baseDecimals
      : traderAccount.quoteDecimals
  }, [formState.coinSide, traderAccount])

  const isWithdrawAll = mode === "withdraw" && formState.withdrawAll

  const amountError = useMemo(() => {
    // Withdraw-all drains the full BalanceManager balance for the chosen
    // side, so the amount input is intentionally ignored.
    if (isWithdrawAll) return undefined
    const trimmed = formState.amount.trim()
    if (!trimmed) return "Amount is required."
    if (activeDecimals === undefined) return undefined
    try {
      const atoms = parseCoinAmount({
        value: trimmed,
        decimals: activeDecimals
      })
      if (atoms <= 0n) return "Amount must be greater than zero."
      return undefined
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Amount must be a positive decimal number."
    }
  }, [activeDecimals, formState.amount, isWithdrawAll])

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress && contractPackageId && executorId && traderAccount
    ) &&
    !amountError &&
    transactionState.status !== "processing" &&
    isSubmissionPending !== true

  const resetForm = useCallback(() => {
    setFormState(initialFormState())
    setTransactionState({ status: "idle" })
  }, [])

  const handleInputChange = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
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
    if (!executorId) {
      setTransactionState({
        status: "error",
        error: "Market maker executor is not resolved yet."
      })
      return
    }
    if (!traderAccount) {
      setTransactionState({
        status: "error",
        error: "Market maker overview is not loaded yet."
      })
      return
    }
    if (amountError) return

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
      | "resolve-admin-cap"
      | "resolve-executor"
      | "resolve-pool"
      | "resolve-source-coin"
      | "execute"
      | "fetch" = "prepare"

    try {
      const decimals =
        formState.coinSide === "base"
          ? traderAccount.baseDecimals
          : traderAccount.quoteDecimals
      // Parse the amount up-front for branches that need it (deposit always,
      // withdraw when the user didn't pick "withdraw all"). The withdraw-all
      // branch passes `amount: undefined` straight through to the PTB so the
      // contract's `withdraw_all<T>` is invoked.
      const parsedAmount = isWithdrawAll
        ? undefined
        : parseCoinAmount({
            value: formState.amount.trim(),
            decimals
          })
      if (parsedAmount !== undefined && parsedAmount <= 0n) {
        throw new Error("Amount must be greater than zero.")
      }
      const coinTypeTag =
        formState.coinSide === "base"
          ? traderAccount.baseCoinType
          : traderAccount.quoteCoinType

      failureStage = "resolve-admin-cap"
      const adminCapId = resolution.adminCapId
      if (!adminCapId) {
        throw new Error("AdminCap not found for the connected wallet.")
      }

      failureStage = "resolve-executor"
      const executorShared = await getSuiSharedObject(
        { objectId: executorId, mutable: true },
        { suiClient }
      )

      let transaction
      if (mode === "deposit") {
        // Deposit always needs a concrete amount — `withdrawAll` is gated to
        // the withdraw mode so this branch can safely require it.
        if (parsedAmount === undefined) {
          throw new Error("Amount must be greater than zero.")
        }
        let sourceCoinId: string | undefined
        if (!isSuiCoinType(coinTypeTag)) {
          failureStage = "resolve-source-coin"
          const coins = await fetchCoinBalances(
            { owner: walletAddress, coinType: coinTypeTag },
            { suiClient }
          )
          const richest = selectRichestCoin(coins)
          if (!richest) {
            throw new Error(
              `Wallet holds no Coin<${coinTypeTag}>. Mint or transfer some before depositing.`
            )
          }
          if (richest.balance < parsedAmount) {
            throw new Error(
              `Wallet holds only ${richest.balance} atoms of ${coinTypeTag}; need ${parsedAmount}.`
            )
          }
          sourceCoinId = richest.coinObjectId
        }

        transaction = buildDepositTransaction({
          packageId: contractPackageId,
          executor: executorShared,
          adminCapId,
          coinTypeTag,
          amount: parsedAmount,
          sourceCoinId
        })
      } else {
        failureStage = "resolve-pool"
        const poolShared = await getSuiSharedObject(
          { objectId: traderAccount.poolId, mutable: true },
          { suiClient }
        )
        transaction = buildWithdrawWithPauseTransaction({
          packageId: contractPackageId,
          executor: executorShared,
          adminCapId,
          coinTypeTag,
          // `undefined` flips the PTB to `executor::withdraw_all<T>` and
          // ignores the amount input.
          amount: parsedAmount,
          recipientAddress: walletAddress,
          currentActive: traderAccount.active,
          pool: poolShared,
          baseAssetTypeTag: traderAccount.baseCoinType,
          quoteAssetTypeTag: traderAccount.quoteCoinType
        })
      }

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
      // Wait for the read-side indexer to catch up before refreshing balances,
      // otherwise the next getObject(executor) call returns the pre-tx Info
      // struct and the dashboard appears not to update.
      await waitForTransactionBlock(suiClient, digest)

      setTransactionState({ status: "success", digest })
      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success(`Transaction submitted (${digest})`, toastId)
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
    amountError,
    contractPackageId,
    currentAccount,
    currentWallet,
    executorId,
    explorerUrl,
    formState.amount,
    formState.coinSide,
    isLocalnet,
    localnetExecutor,
    mode,
    network,
    refreshTraderAccount,
    signAndExecuteTransaction,
    suiClient,
    traderAccount,
    walletAddress
  ])

  return {
    formState,
    amountError,
    transactionState,
    canSubmit,
    handleInputChange,
    handleSubmit,
    resetForm,
    traderAccount
  }
}
