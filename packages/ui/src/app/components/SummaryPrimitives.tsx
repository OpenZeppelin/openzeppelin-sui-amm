"use client"

import type { ReactNode } from "react"

export const SummaryValueCard = ({
  label,
  value,
  detail,
  detailClassName,
  className
}: {
  label: string
  value: string
  detail?: string
  detailClassName?: string
  className?: string
}) => (
  <div
    className={[
      "rounded-xl border border-slate-200/70 bg-white/80 p-3 text-xs dark:border-slate-50/15 dark:bg-slate-950/60",
      className
    ]
      .filter(Boolean)
      .join(" ")}
  >
    <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
      {label}
    </div>
    <div className="mt-1 text-sm font-semibold text-sds-dark dark:text-sds-light">
      {value}
    </div>
    {detail ? (
      <div
        className={
          detailClassName ??
          "mt-2 break-all text-[0.65rem] text-slate-500 dark:text-slate-200/60"
        }
      >
        {detail}
      </div>
    ) : undefined}
  </div>
)

export const SummaryIdRow = ({
  children,
  className
}: {
  children: ReactNode
  className?: string
}) => (
  <div
    className={["mt-4 flex flex-wrap items-center gap-3 text-xs", className]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </div>
)
