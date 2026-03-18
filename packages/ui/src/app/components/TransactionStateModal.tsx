"use client"

import type { ReactNode } from "react"
import { ModalFrame } from "./ModalPrimitives"

type TransactionStatus = "idle" | "processing" | "success" | "error"

const TransactionStateModal = <Summary,>({
  open,
  onClose,
  status,
  summary,
  error,
  details,
  renderSuccess,
  renderError,
  children
}: {
  open: boolean
  onClose: () => void
  status: TransactionStatus
  summary?: Summary
  error?: string
  details?: string
  renderSuccess: (summary: Summary) => ReactNode
  renderError: (error: string, details?: string) => ReactNode
  children: ReactNode
}) => {
  if (!open) return null

  if (status === "success" && summary) {
    return <ModalFrame onClose={onClose}>{renderSuccess(summary)}</ModalFrame>
  }

  if (status === "error" && error) {
    return (
      <ModalFrame onClose={onClose}>{renderError(error, details)}</ModalFrame>
    )
  }

  return <ModalFrame onClose={onClose}>{children}</ModalFrame>
}

export default TransactionStateModal
