"use client"

import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSignTransaction,
  useSuiClient,
  useSuiClientContext
} from "@mysten/dapp-kit"
import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import type { Transaction, TransactionArgument } from "@mysten/sui/transactions"
import { fundTraderAccount } from "@sui-amm/domain-core/ptb/deepbook"
import {
  getCoinBalances,
  type CoinBalanceSummary
} from "@sui-amm/tooling-core/address"
import { selectRichestCoin } from "@sui-amm/tooling-core/coin"
import { getSuiSharedObject } from "@sui-amm/tooling-core/shared-object"
import {
  newTransaction,
  resolveSplitCoinResult
} from "@sui-amm/tooling-core/transactions"
import { ENetwork } from "@sui-amm/tooling-core/types"
import { parseTypeNameFromString } from "@sui-amm/tooling-core/utils/type-name"
import { parsePositiveU64 } from "@sui-amm/tooling-core/utils/utility"
import { useCallback, useEffect, useMemo, useState } from "react"
import { resolveValidationMessage } from "../helpers/inputValidation"
import {
  getLocalnetClient,
  makeLocalnetExecutor
} from "../helpers/localnet"
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
import useExplorerUrl from "./useExplorerUrl"
import { useIdleFieldValidation } from "./useIdleFieldValidation"
import useResolvedPackageId from "./useResolvedPackageId"

type FundFormState = {
  coinType: string
  amount: string
}

type FundFieldErrors = Partial<Record<keyof FundFormState, string>>

export type WalletCoinBalanceOption = {
  coinType: string
  totalBalance: bigint
  coinObjectCount: number
}

type WalletCoinBalancesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; balances: WalletCoinBalanceOption[] }
  | { status: "error"; error: string }

export type TraderAccountFundSummary = {
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
  | { status: "success"; summary: TraderAccountFundSummary }
  | { status: "error"; error: string; details?: string }

const emptyFundFormState = (): FundFormState => ({
  coinType: "",
  amount: ""
})

const normalizeWalletCoinBalances = (
  balances: CoinBalanceSummary[]
): WalletCoinBalanceOption[] =>
  balances
    .map((balance) => ({
      coinType: balance.coinType.trim(),
      totalBalance: balance.totalBalance,
      coinObjectCount: balance.coinObjectCount
    }))
    .filter((balance) => balance.totalBalance > 0n)
    .sort((leftBalance, rightBalance) =>
      leftBalance.coinType.localeCompare(rightBalance.coinType)
    )

const resolveInitialCoinType = ({
  currentCoinType,
  balances
}: {
  currentCoinType: string
  balances: WalletCoinBalanceOption[]
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

const resolveSelectedWalletCoinBalance = ({
  coinType,
  walletCoinBalancesState
}: {
  coinType: string
  walletCoinBalancesState: WalletCoinBalancesState
}) => {
  if (walletCoinBalancesState.status !== "success") return undefined
  if (!coinType) return undefined

  const normalizedCoinType = coinType.trim()
  return walletCoinBalancesState.balances.find(
    (balance) => balance.coinType === normalizedCoinType
  )
}

const resolveFundingAmount = (value: string): bigint =>
  parsePositiveU64(value.trim(), "Funding amount")

const isSuiCoinType = (coinType: string) => {
  try {
    const typeName = parseTypeNameFromString(coinType)
    return (
      typeName.packageId ===
        "0x0000000000000000000000000000000000000000000000000000000000000002" &&
      typeName.moduleName === "sui" &&
      typeName.structName === "SUI"
    )
  } catch {
    return false
  }
}

const fetchOwnedCoinBalances = async ({
  ownerAddress,
  coinType,
  suiClient
}: {
  ownerAddress: string
  coinType: string
  suiClient: SuiClient
}) => {
  const balances: {
    coinObjectId: string
    balance: bigint
  }[] = []
  let cursor: string | undefined

  do {
    const page = await suiClient.getCoins({
      owner: ownerAddress,
      coinType,
      limit: 50,
      cursor
    })

    page.data.forEach((coin) => {
      balances.push({
        coinObjectId: coin.coinObjectId,
        balance: BigInt(coin.balance)
      })
    })

    cursor = page.hasNextPage ? (page.nextCursor ?? undefined) : undefined
  } while (cursor)

  return balances
}

const buildFieldErrors = ({
  formState,
  walletCoinBalancesState
}: {
  formState: FundFormState
  walletCoinBalancesState: WalletCoinBalancesState
}): FundFieldErrors => {
  const errors: FundFieldErrors = {}

  if (!formState.coinType.trim()) {
    errors.coinType = "Select a coin."
  } else if (
    walletCoinBalancesState.status === "success" &&
    !resolveSelectedWalletCoinBalance({
      coinType: formState.coinType,
      walletCoinBalancesState
    })
  ) {
    errors.coinType = "Selected coin is not available in this wallet."
  }

  const amountInput = formState.amount.trim()
  if (!amountInput) {
    errors.amount = "Amount is required."
    return errors
  }

  let fundingAmount: bigint | undefined
  try {
    fundingAmount = resolveFundingAmount(amountInput)
  } catch (error) {
    errors.amount = resolveValidationMessage(
      error,
      "Amount must be a valid positive u64."
    )
    return errors
  }

  const selectedWalletCoinBalance = resolveSelectedWalletCoinBalance({
    coinType: formState.coinType,
    walletCoinBalancesState
  })
  if (
    selectedWalletCoinBalance &&
    fundingAmount > selectedWalletCoinBalance.totalBalance
  ) {
    errors.amount = "Amount exceeds the wallet balance for this coin."
  }

  return errors
}

const resolveFundingCoinArgument = async ({
  transaction,
  ownerAddress,
  coinType,
  fundingAmount,
  suiClient
}: {
  transaction: Transaction
  ownerAddress: string
  coinType: string
  fundingAmount: bigint
  suiClient: SuiClient
}): Promise<TransactionArgument> => {
  const normalizedCoinType = coinType.trim()

  if (isSuiCoinType(normalizedCoinType)) {
    const splitResult = transaction.splitCoins(transaction.gas, [
      transaction.pure.u64(fundingAmount)
    ])
    return resolveSplitCoinResult(splitResult, 0)
  }

  const walletCoins = await fetchOwnedCoinBalances({
    ownerAddress,
    coinType: normalizedCoinType,
    suiClient
  })

  const eligibleCoin = selectRichestCoin(
    walletCoins.filter((coin) => coin.balance >= fundingAmount)
  )

  if (!eligibleCoin) {
    throw new Error(
      "No single coin object can cover this funding amount. Merge coin objects first, then retry."
    )
  }

  const splitResult = transaction.splitCoins(
    transaction.object(eligibleCoin.coinObjectId),
    [transaction.pure.u64(fundingAmount)]
  )

  return resolveSplitCoinResult(splitResult, 0)
}

export const useFundTraderAccountModalState = ({
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

  const [walletCoinBalancesState, setWalletCoinBalancesState] =
    useState<WalletCoinBalancesState>({ status: "idle" })
  const [walletBalanceRefreshVersion, setWalletBalanceRefreshVersion] =
    useState(0)
  const [formState, setFormState] = useState<FundFormState>(emptyFundFormState)
  const [transactionState, setTransactionState] = useState<TransactionState>({
    status: "idle"
  })
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const {
    markFieldChange,
    markFieldBlur,
    resetFieldState,
    shouldShowFieldFeedback
  } = useIdleFieldValidation<keyof FundFormState>({ idleDelayMs: 600 })

  const refreshWalletBalances = useCallback(() => {
    setWalletBalanceRefreshVersion((currentVersion) => currentVersion + 1)
  }, [])

  useEffect(() => {
    if (!open) return
    setTransactionState({ status: "idle" })
    setHasAttemptedSubmit(false)
    resetFieldState()
    setFormState(emptyFundFormState())
    refreshWalletBalances()
  }, [open, refreshWalletBalances, resetFieldState])

  useEffect(() => {
    let active = true

    if (!open) return () => {}

    if (!walletAddress) {
      setWalletCoinBalancesState({ status: "idle" })
      return () => {
        active = false
      }
    }

    setWalletCoinBalancesState({ status: "loading" })

    const loadWalletBalances = async () => {
      try {
        const normalizedBalances = normalizeWalletCoinBalances(
          await getCoinBalances({ address: walletAddress }, { suiClient })
        )
        if (!active) return

        setWalletCoinBalancesState({
          status: "success",
          balances: normalizedBalances
        })
        setFormState((currentState) => ({
          ...currentState,
          coinType: resolveInitialCoinType({
            currentCoinType: currentState.coinType,
            balances: normalizedBalances
          })
        }))
      } catch (error) {
        if (!active) return

        setWalletCoinBalancesState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load wallet coin balances."
        })
      }
    }

    void loadWalletBalances()

    return () => {
      active = false
    }
  }, [open, suiClient, walletAddress, walletBalanceRefreshVersion])

  const fieldErrors = useMemo(
    () =>
      buildFieldErrors({
        formState,
        walletCoinBalancesState
      }),
    [formState, walletCoinBalancesState]
  )
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean)
  const selectedWalletCoinBalance = useMemo(
    () =>
      resolveSelectedWalletCoinBalance({
        coinType: formState.coinType,
        walletCoinBalancesState
      }),
    [formState.coinType, walletCoinBalancesState]
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
      network,
      localnetSupported,
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
      walletCoinBalancesState.status === "success" &&
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
    refreshWalletBalances()
  }, [refreshWalletBalances, resetFieldState])

  const handleInputChange = useCallback(
    <K extends keyof FundFormState>(key: K, value: FundFormState[K]) => {
      markFieldChange(key)
      setFormState((currentState) => ({
        ...currentState,
        [key]: value
      }))
    },
    [markFieldChange]
  )

  const shouldShowFieldError = useCallback(
    <K extends keyof FundFormState>(key: K, error?: string): error is string =>
      Boolean(error && shouldShowFieldFeedback(key, hasAttemptedSubmit)),
    [hasAttemptedSubmit, shouldShowFieldFeedback]
  )

  const handleFundTraderAccount = useCallback(async () => {
    setHasAttemptedSubmit(true)

    if (!walletAddress) {
      setTransactionState({
        status: "error",
        error: "Connect a wallet to fund the trader account."
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

    if (walletCoinBalancesState.status !== "success") {
      setTransactionState({
        status: "error",
        error: "Wallet coin balances are not available yet."
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
      const fundingAmount = resolveFundingAmount(formState.amount)
      const balanceManager = await getSuiSharedObject(
        {
          objectId: balanceManagerId,
          mutable: true
        },
        { suiClient }
      )
      const transaction = newTransaction()
      const fundingCoin = await resolveFundingCoinArgument({
        transaction,
        ownerAddress: walletAddress,
        coinType: normalizedCoinType,
        fundingAmount,
        suiClient
      })

      fundTraderAccount({
        transaction,
        ammPackageId,
        traderAccountId,
        balanceManager,
        fundingCoin,
        coinAssetType: normalizedCoinType
      })
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
          amount: fundingAmount.toString()
        }
      })
      refreshWalletBalances()

      if (explorerUrl) {
        notification.txSuccess(transactionUrl(explorerUrl, digest), toastId)
      } else {
        notification.success("Trader account funded.", toastId)
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
    refreshWalletBalances,
    signAndExecuteTransaction,
    suiClient,
    traderAccountId,
    walletAddress,
    walletCoinBalancesState.status,
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
    walletCoinBalancesState,
    selectedWalletCoinBalance,
    transactionState,
    transactionSummary,
    isSuccessState,
    isErrorState,
    canSubmit,
    handleInputChange,
    markFieldBlur,
    shouldShowFieldError,
    handleFundTraderAccount,
    resetForm
  }
}
