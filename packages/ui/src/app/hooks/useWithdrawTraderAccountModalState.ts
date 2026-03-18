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
import { getBalanceManagerAssetBalances } from "@sui-amm/domain-core/models/traderAccount"
import { withdrawTraderAccount } from "@sui-amm/domain-core/ptb/deepbook"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import { newTransaction } from "@sui-amm/tooling-core/transactions"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { parsePositiveU64 } from "@sui-amm/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { resolveValidationMessage } from "../helpers/inputValidation"
import { getLocalnetClient, makeLocalnetExecutor } from "../helpers/localnet"
import { transactionUrl } from "../helpers/network"
import { notification } from "../helpers/notification"
import {
  executeTransaction,
  resolveLocalnetSupportNote,
  withOptionalSupportNote
} from "../helpers/transactionExecution"
import {
  extractErrorDetails,
  formatErrorMessage,
  safeJsonStringify,
  serializeForJson
} from "../helpers/transactionErrors"
import {
  buildWalletPreflightContext,
  resolveWalletNetworkPreflight
} from "../helpers/walletPreflight"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useExplorerUrl from "./useExplorerUrl"
import useResolvedPackageId from "./useResolvedPackageId"

type WithdrawFormState = {
  coinType: string
  amount: string
}

type WithdrawFieldErrors = Partial<Record<keyof WithdrawFormState, string>>

export type TraderAccountCoinBalanceOption = {
  coinType: string
  totalBalance: bigint
}

type TraderAccountCoinBalancesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; balances: TraderAccountCoinBalanceOption[] }
  | { status: "error"; error: string }

export type TraderAccountWithdrawSummary = {
  digest: string
  transactionBlock: SuiTransactionBlockResponse
  ownerAddress: string
  traderAccountId: string
  balanceManagerId: string
  coinType: string
  amount: string
}

type TransactionState =
  | { status: "idle" }
  | { status: "processing" }
  | { status: "success"; summary: TraderAccountWithdrawSummary }
  | { status: "error"; error: string; details?: string }

const emptyWithdrawFormState = (): WithdrawFormState => ({
  coinType: "",
  amount: ""
})

const normalizeTraderAccountCoinBalances = (
  assetBalances: Awaited<ReturnType<typeof getBalanceManagerAssetBalances>>
): TraderAccountCoinBalanceOption[] =>
  assetBalances
    .map((assetBalance) => ({
      coinType: assetBalance.coinType.trim(),
      totalBalance: assetBalance.balance
    }))
    .filter((assetBalance) => assetBalance.totalBalance > 0n)
    .sort((leftBalance, rightBalance) =>
      leftBalance.coinType.localeCompare(rightBalance.coinType)
    )

const resolveInitialCoinType = ({
  currentCoinType,
  balances
}: {
  currentCoinType: string
  balances: TraderAccountCoinBalanceOption[]
}) => {
  if (balances.length === 0) return ""

  const normalizedCurrentCoinType = currentCoinType.trim()
  if (
    normalizedCurrentCoinType &&
    balances.some((balance) => balance.coinType === normalizedCurrentCoinType)
  ) {
    return normalizedCurrentCoinType
  }

  return balances[0]?.coinType ?? ""
}

const resolveSelectedTraderAccountCoinBalance = ({
  coinType,
  traderAccountCoinBalancesState
}: {
  coinType: string
  traderAccountCoinBalancesState: TraderAccountCoinBalancesState
}) => {
  if (traderAccountCoinBalancesState.status !== "success") return undefined
  if (!coinType) return undefined

  const normalizedCoinType = coinType.trim()
  return traderAccountCoinBalancesState.balances.find(
    (balance) => balance.coinType === normalizedCoinType
  )
}

const resolveWithdrawalAmount = (value: string): bigint =>
  parsePositiveU64(value.trim(), "Withdrawal amount")

const buildFieldErrors = ({
  formState,
  traderAccountCoinBalancesState
}: {
  formState: WithdrawFormState
  traderAccountCoinBalancesState: TraderAccountCoinBalancesState
}): WithdrawFieldErrors => {
  const errors: WithdrawFieldErrors = {}

  if (!formState.coinType.trim()) {
    errors.coinType = "Select a coin."
  } else if (
    traderAccountCoinBalancesState.status === "success" &&
    !resolveSelectedTraderAccountCoinBalance({
      coinType: formState.coinType,
      traderAccountCoinBalancesState
    })
  ) {
    errors.coinType = "Selected coin is not available in this trader account."
  }

  const amountInput = formState.amount.trim()
  if (!amountInput) {
    errors.amount = "Amount is required."
    return errors
  }

  let withdrawalAmount: bigint | undefined
  try {
    withdrawalAmount = resolveWithdrawalAmount(amountInput)
  } catch (error) {
    errors.amount = resolveValidationMessage(
      error,
      "Amount must be a valid positive u64."
    )
    return errors
  }

  const selectedTraderAccountCoinBalance =
    resolveSelectedTraderAccountCoinBalance({
      coinType: formState.coinType,
      traderAccountCoinBalancesState
    })
  if (
    selectedTraderAccountCoinBalance &&
    withdrawalAmount > selectedTraderAccountCoinBalance.totalBalance
  ) {
    errors.amount = "Amount exceeds the trader account balance for this coin."
  }

  return errors
}

export const useWithdrawTraderAccountModalState = ({
  open,
  traderAccountId,
  balanceManagerId
}: {
  open: boolean
  traderAccountId?: string
  balanceManagerId?: string
}) => {
  const currentAccount = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const signAndExecuteTransaction = useSignAndExecuteTransaction()
  const signTransaction = useSignTransaction()
  const suiClient = useSuiClient()
  const { network } = useSuiClientContext()
  const explorerUrl = useExplorerUrl()
  const ammPackageId = useResolvedPackageId()
  const walletAddress = currentAccount?.address

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

  const [traderAccountCoinBalancesState, setTraderAccountCoinBalancesState] =
    useState<TraderAccountCoinBalancesState>({ status: "idle" })
  const [balanceRefreshVersion, setBalanceRefreshVersion] = useState(0)
  const [formState, setFormState] = useState<WithdrawFormState>(
    emptyWithdrawFormState
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
  } = useIdleFieldValidation<keyof WithdrawFormState>({ idleDelayMs: 600 })

  const refreshBalances = useCallback(() => {
    setBalanceRefreshVersion((currentVersion) => currentVersion + 1)
  }, [])

  useEffect(() => {
    if (!open) return
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
    setFormState(emptyWithdrawFormState())
    refreshBalances()
  }, [open, refreshBalances, resetFieldState])

  useEffect(() => {
    let active = true

    if (!open) return () => {}

    if (!balanceManagerId) {
      setTraderAccountCoinBalancesState({ status: "idle" })
      return () => {
        active = false
      }
    }

    setTraderAccountCoinBalancesState({ status: "loading" })

    const loadTraderAccountBalances = async () => {
      try {
        const balances = normalizeTraderAccountCoinBalances(
          await getBalanceManagerAssetBalances(balanceManagerId, suiClient)
        )
        if (!active) return

        setTraderAccountCoinBalancesState({
          status: "success",
          balances
        })
        setFormState((currentState) => ({
          ...currentState,
          coinType: resolveInitialCoinType({
            currentCoinType: currentState.coinType,
            balances
          })
        }))
      } catch (error) {
        if (!active) return

        setTraderAccountCoinBalancesState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load trader account balances."
        })
      }
    }

    void loadTraderAccountBalances()

    return () => {
      active = false
    }
  }, [balanceManagerId, open, balanceRefreshVersion, suiClient])

  const fieldErrors = useMemo(
    () =>
      buildFieldErrors({
        formState,
        traderAccountCoinBalancesState
      }),
    [formState, traderAccountCoinBalancesState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)
  const selectedTraderAccountCoinBalance = useMemo(
    () =>
      resolveSelectedTraderAccountCoinBalance({
        coinType: formState.coinType,
        traderAccountCoinBalancesState
      }),
    [formState.coinType, traderAccountCoinBalancesState]
  )

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

  const walletContext = useMemo(
    () =>
      buildWalletPreflightContext({
        appNetwork: network,
        expectedChain,
        walletName: currentWallet?.name,
        walletVersion: currentWallet?.version,
        accountAddress: walletAddress,
        accountChains,
        chainMismatch,
        localnetSupported
      }),
    [
      accountChains,
      chainMismatch,
      currentWallet?.name,
      currentWallet?.version,
      expectedChain,
      localnetSupported,
      network,
      walletAddress
    ]
  )

  const isSubmissionPending = isLocalnet
    ? signTransaction.isPending
    : signAndExecuteTransaction.isPending

  const canSubmit =
    Boolean(
      walletAddress &&
      ammPackageId &&
      traderAccountId &&
      balanceManagerId &&
      traderAccountCoinBalancesState.status === "success" &&
      !hasFieldErrors
    ) &&
    transactionState.status !== "processing" &&
    !isSubmissionPending

  const resetForm = useCallback(() => {
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
    setFormState((currentState) => ({
      coinType: currentState.coinType,
      amount: ""
    }))
    refreshBalances()
  }, [refreshBalances, resetFieldState])

  const handleInputChange = useCallback(
    <K extends keyof WithdrawFormState>(
      key: K,
      value: WithdrawFormState[K]
    ) => {
      markFieldChange(key)
      setFormState((currentState) => ({
        ...currentState,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof WithdrawFormState>(
      key: K,
      error?: string
    ): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleWithdrawTraderAccount = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to withdraw from the trader account."
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

    if (!traderAccountId || !balanceManagerId) {
      setTransactionState({
        status: "error",
        error: "Trader account and balance manager IDs are required."
      })
      return
    }

    if (traderAccountCoinBalancesState.status !== "success") {
      setTransactionState({
        status: "error",
        error: "Trader account balances are not available yet."
      })
      return
    }

    if (hasFieldErrors) return

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

    const toastId = notification.txLoading()
    setTransactionState({ status: "processing" })

    try {
      const normalizedCoinType = formState.coinType.trim()
      const withdrawalAmount = resolveWithdrawalAmount(formState.amount)
      const balanceManager = await getSuiSharedObject(
        {
          objectId: balanceManagerId,
          mutable: true
        },
        { suiClient }
      )

      const transaction = newTransaction()
      const withdrawnCoin = withdrawTraderAccount({
        transaction,
        ammPackageId,
        traderAccountId,
        balanceManager,
        withdrawAmount: withdrawalAmount,
        coinAssetType: normalizedCoinType
      })

      transaction.transferObjects(
        [withdrawnCoin],
        transaction.pure.address(walletAddress)
      )
      transaction.setSender(walletAddress)

      const { digest, transactionBlock } = await executeTransaction({
        buildTransaction: () => transaction,
        isLocalnet,
        expectedChain,
        localnetExecutor,
        signAndExecuteTransaction: signAndExecuteTransaction.mutateAsync,
        suiClient
      })

      setTransactionState({
        status: "success",
        summary: {
          digest,
          transactionBlock,
          ownerAddress: walletAddress,
          traderAccountId,
          balanceManagerId,
          coinType: normalizedCoinType,
          amount: withdrawalAmount.toString()
        }
      })
      refreshBalances()

      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success("Trader account withdrawal completed.", toastId)
      }
    } catch (error) {
      const errorDetails = extractErrorDetails(error)
      const localnetSupportNote = resolveLocalnetSupportNote({
        isLocalnet,
        localnetSupported
      })
      const errorDetailsRaw = safeJsonStringify(
        {
          summary: errorDetails,
          raw: serializeForJson(error),
          localnetSupportNote,
          walletContext
        },
        2
      )
      const formattedError = formatErrorMessage(error)
      const errorMessage = withOptionalSupportNote({
        message: formattedError,
        supportNote: localnetSupportNote
      })

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
    ammPackageId,
    balanceManagerId,
    chainMismatch,
    currentWallet,
    expectedChain,
    explorerUrl,
    formState.amount,
    formState.coinType,
    hasFieldErrors,
    isLocalnet,
    localnetExecutor,
    localnetSupported,
    network,
    refreshBalances,
    signAndExecuteTransaction,
    suiClient,
    traderAccountCoinBalancesState.status,
    traderAccountId,
    walletAddress,
    walletContext
  ])

  const isSuccessState = transactionState.status === "success"
  const isErrorState = transactionState.status === "error"
  const transactionSummary = isSuccessState
    ? transactionState.summary
    : undefined

  return {
    formState,
    fieldErrors,
    traderAccountCoinBalancesState,
    selectedTraderAccountCoinBalance,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleWithdrawTraderAccount,
    resetForm
  }
}
