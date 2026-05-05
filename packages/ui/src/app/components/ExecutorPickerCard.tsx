"use client"

import { useRouter } from "next/navigation"
import { useCallback } from "react"
import { writeSelectedAdminCapId } from "../helpers/selectedAdminCap"
import useOwnedExecutors from "../hooks/useOwnedExecutors"
import CopyableId from "./CopyableId"

const cardClassName =
  "rounded-2xl border border-slate-200/70 bg-white/90 p-5 shadow-[0_14px_35px_-30px_rgba(15,23,42,0.4)] dark:border-slate-50/15 dark:bg-slate-950/70"

const ExecutorPickerCard = ({
  selectedAdminCapId
}: {
  selectedAdminCapId?: string
}) => {
  const router = useRouter()
  const owned = useOwnedExecutors()

  const handleSelect = useCallback(
    (adminCapId: string) => {
      writeSelectedAdminCapId(adminCapId)
      router.replace("/dashboard")
    },
    [router]
  )

  if (owned.status === "loading" || owned.status === "idle") {
    return (
      <section className={cardClassName}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          Your amm executors
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          Loading owned `AdminCap` objects…
        </p>
      </section>
    )
  }

  if (owned.status === "wallet-required" || owned.status === "missing-config") {
    return null
  }

  if (owned.status === "error") {
    return (
      <section className={cardClassName}>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          Your amm executors
        </h2>
        <p className="text-xs text-rose-700/90 dark:text-rose-200/90">
          {owned.error}
        </p>
      </section>
    )
  }

  if (owned.entries.length === 0) {
    return null
  }

  return (
    <section className={cardClassName}>
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-sds-dark dark:text-sds-light">
          Your amm executors
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-200/70">
          Pick an existing executor to manage. Sourced from `AdminCap` objects
          owned by the connected wallet — selection is remembered across
          reloads.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-slate-200/60 dark:divide-slate-50/10">
        {owned.entries.map((entry) => {
          const isSelected = entry.adminCapId === selectedAdminCapId
          return (
            <li
              key={entry.adminCapId}
              className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-200/80">
                <div className="flex items-center gap-2">
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    Executor
                  </span>
                  <CopyableId value={entry.executorId} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                    AdminCap
                  </span>
                  <CopyableId value={entry.adminCapId} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleSelect(entry.adminCapId)}
                className={[
                  "self-start rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors lg:self-auto",
                  isSelected
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
                    : "border-sds-blue/30 bg-sds-blue/10 hover:bg-sds-blue/20 dark:border-sds-blue/40 dark:bg-sds-blue/20 text-sds-blue"
                ].join(" ")}
              >
                {isSelected ? "Open dashboard" : "Use this executor"}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default ExecutorPickerCard
