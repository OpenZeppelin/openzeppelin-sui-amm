"use client"

import { formatCoinBalance } from "@sui-amm/tooling-core/utils/formatters"
import { useMemo } from "react"
import useDeploymentArtifacts from "../hooks/useDeploymentArtifacts"
import { useDeepbookMidPrices } from "../hooks/useDeepbookMidPrices"
import {
  useExecutorEventLog,
  type ExecutorEvent
} from "../hooks/useExecutorEventLog"
import useResolvedPackageId from "../hooks/useResolvedPackageId"
import { useTraderAccountContext } from "../providers/TraderAccountProvider"
import Loading from "./Loading"

type SeriesPoint = {
  timestampMs: number
  oracleRaw: bigint
  oracleDisplay: string
  oracleValue: number
  deepbookRaw: bigint | undefined
  deepbookDisplay: string | undefined
  deepbookValue: number | undefined
}

const formatRawPrice = ({
  rawPrice,
  adjustedDecimals
}: {
  rawPrice: bigint
  adjustedDecimals: number
}): string => {
  if (adjustedDecimals < 0) return `${rawPrice.toString()} (raw)`
  return formatCoinBalance({
    balance: rawPrice.toString(),
    decimals: adjustedDecimals,
    maxFractionDigits: 6
  })
}

// Convert a DeepBook fixed-point raw price into a plain JS number for plotting.
// `adjustedDecimals` shifts the decimal point: divide when positive, multiply
// when negative. Lossy for extreme magnitudes but the chart axis only cares
// about the scaled value, not full bigint precision.
const rawPriceToNumber = (
  rawPrice: bigint,
  adjustedDecimals: number
): number =>
  adjustedDecimals < 0
    ? Number(rawPrice) * 10 ** -adjustedDecimals
    : Number(rawPrice) / 10 ** adjustedDecimals

const parseRawPriceField = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  try {
    return BigInt(String(value))
  } catch {
    return undefined
  }
}

const buildSeries = ({
  events,
  baseDecimals,
  quoteDecimals,
  deepbookByEventId
}: {
  events: ExecutorEvent[]
  baseDecimals: number
  quoteDecimals: number
  deepbookByEventId: ReturnType<typeof useDeepbookMidPrices>
}): SeriesPoint[] => {
  const adjustedDecimals = 9 - baseDecimals + quoteDecimals
  const points: SeriesPoint[] = []

  for (const event of events) {
    if (event.type !== "QuoteUpdated") continue
    const oracleRaw = parseRawPriceField(
      (event.data as { price?: unknown }).price
    )
    if (oracleRaw === undefined) continue

    const oracleDisplay = formatRawPrice({
      rawPrice: oracleRaw,
      adjustedDecimals
    })
    const oracleValueRaw = rawPriceToNumber(oracleRaw, adjustedDecimals)

    const deepbookEntry = deepbookByEventId.get(event.id)
    const deepbookRaw =
      typeof deepbookEntry === "bigint" ? deepbookEntry : undefined
    const deepbookDisplay =
      deepbookRaw !== undefined
        ? formatRawPrice({ rawPrice: deepbookRaw, adjustedDecimals })
        : undefined
    const deepbookValueRaw =
      deepbookRaw !== undefined
        ? rawPriceToNumber(deepbookRaw, adjustedDecimals)
        : undefined

    points.push({
      timestampMs: event.timestampMs ?? 0,
      oracleRaw,
      oracleDisplay,
      oracleValue: Number.isFinite(oracleValueRaw) ? oracleValueRaw : 0,
      deepbookRaw,
      deepbookDisplay,
      deepbookValue:
        deepbookValueRaw !== undefined && Number.isFinite(deepbookValueRaw)
          ? deepbookValueRaw
          : undefined
    })
  }

  return points
}

const ORACLE_COLOR = "#4da2ff"
const DEEPBOOK_COLOR = "#f97316"

const Sparkline = ({ points }: { points: SeriesPoint[] }) => {
  const width = 600
  const height = 160
  const padding = 6

  const allValues: number[] = []
  for (const point of points) {
    if (Number.isFinite(point.oracleValue)) allValues.push(point.oracleValue)
    if (point.deepbookValue !== undefined) allValues.push(point.deepbookValue)
  }

  if (allValues.length < 2) {
    return (
      <div className="flex h-[160px] items-center justify-center text-xs text-slate-500 dark:text-slate-200/70">
        Need at least two QuoteUpdated events to plot.
      </div>
    )
  }

  const min = Math.min(...allValues)
  const max = Math.max(...allValues)
  const range = max - min || 1
  const lastIndex = points.length - 1

  const xFor = (index: number) =>
    lastIndex === 0
      ? width / 2
      : padding + (index / lastIndex) * (width - padding * 2)
  const yFor = (value: number) =>
    height - padding - ((value - min) / range) * (height - padding * 2)

  const oraclePolyline = points
    .map(
      (point, index) =>
        `${xFor(index).toFixed(2)},${yFor(point.oracleValue).toFixed(2)}`
    )
    .join(" ")
  const oracleArea = `${padding},${height - padding} ${oraclePolyline} ${width - padding},${height - padding}`

  // DeepBook line: split into segments around missing points so we get gaps
  // instead of straight lines through them. Each contiguous run of points with
  // a defined `deepbookValue` becomes its own polyline.
  const deepbookSegments: string[] = []
  let currentSegment: string[] = []
  points.forEach((point, index) => {
    if (point.deepbookValue !== undefined) {
      currentSegment.push(
        `${xFor(index).toFixed(2)},${yFor(point.deepbookValue).toFixed(2)}`
      )
    } else if (currentSegment.length > 0) {
      deepbookSegments.push(currentSegment.join(" "))
      currentSegment = []
    }
  })
  if (currentSegment.length > 0) deepbookSegments.push(currentSegment.join(" "))

  const lastDeepbookPoint = [...points]
    .reverse()
    .find((point) => point.deepbookValue !== undefined)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-4 text-[0.65rem] uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded"
            style={{ backgroundColor: ORACLE_COLOR }}
          />
          Oracle
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-3 rounded"
            style={{ backgroundColor: DEEPBOOK_COLOR }}
          />
          DeepBook
        </span>
      </div>
      <div className="relative h-[160px] w-full overflow-hidden rounded-lg border border-slate-200/60 bg-white/50 dark:border-slate-50/15 dark:bg-slate-950/40">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          className="h-full w-full"
        >
          <defs>
            <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ORACLE_COLOR} stopOpacity="0.25" />
              <stop offset="100%" stopColor={ORACLE_COLOR} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={oracleArea} fill="url(#sparkline-fill)" />
          <polyline
            points={oraclePolyline}
            fill="none"
            stroke={ORACLE_COLOR}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
          {deepbookSegments.map((segment, segmentIndex) => (
            <polyline
              key={segmentIndex}
              points={segment}
              fill="none"
              stroke={DEEPBOOK_COLOR}
              strokeWidth="2"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[0.65rem] text-slate-500 dark:text-slate-200/70">
          {points[0].oracleDisplay}
        </div>
        <div className="pointer-events-none absolute bottom-2 right-3 flex flex-col items-end gap-0.5 font-mono text-[0.7rem]">
          <span className="font-semibold" style={{ color: ORACLE_COLOR }}>
            {points[lastIndex].oracleDisplay}
          </span>
          {lastDeepbookPoint?.deepbookDisplay ? (
            <span className="font-semibold" style={{ color: DEEPBOOK_COLOR }}>
              {lastDeepbookPoint.deepbookDisplay}
            </span>
          ) : undefined}
        </div>
      </div>
    </div>
  )
}

const PriceChartCard = () => {
  const { resolution, overview } = useTraderAccountContext()
  const packageId = useResolvedPackageId()
  const { deepbookPackageId } = useDeploymentArtifacts()
  const events = useExecutorEventLog({
    packageId,
    executorId: resolution.traderAccountId,
    limit: 200
  })
  const traderAccount = overview.traderAccount

  const deepbookByEventId = useDeepbookMidPrices({
    events,
    deepbookPackageId,
    poolId: traderAccount?.poolId,
    baseCoinType: traderAccount?.baseCoinType,
    quoteCoinType: traderAccount?.quoteCoinType
  })

  const points = useMemo(() => {
    if (!traderAccount) return []
    return buildSeries({
      events,
      baseDecimals: traderAccount.baseDecimals,
      quoteDecimals: traderAccount.quoteDecimals,
      deepbookByEventId
    })
  }, [events, traderAccount, deepbookByEventId])

  const lastPoint = points[points.length - 1]
  const baseSymbol = traderAccount?.baseCoinType.split("::").pop() ?? ""
  const quoteSymbol = traderAccount?.quoteCoinType.split("::").pop() ?? ""

  return (
    <section className="flex h-full w-full max-w-4xl flex-col px-4 lg:px-0">
      <div className="flex flex-1 flex-col rounded-2xl border border-slate-300/80 bg-white/90 shadow-[0_22px_65px_-45px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-50/30 dark:bg-slate-950/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300/70 px-6 py-4 dark:border-slate-50/25">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-sds-dark dark:text-sds-light">
              Mid price
            </h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500 dark:text-slate-200/60">
              {baseSymbol && quoteSymbol
                ? `${baseSymbol} / ${quoteSymbol}`
                : "Oracle vs DeepBook book"}
            </p>
          </div>
          {lastPoint ? (
            <div className="text-right">
              <div
                className="font-mono text-2xl font-semibold"
                style={{ color: ORACLE_COLOR }}
              >
                {lastPoint.oracleDisplay}
              </div>
              <div className="text-[0.6rem] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-200/60">
                {points.length} samples
              </div>
            </div>
          ) : undefined}
        </div>
        <div className="px-6 py-5">
          {!traderAccount ? (
            <Loading />
          ) : points.length === 0 ? (
            <div className="flex h-[120px] items-center justify-center text-xs text-slate-500 dark:text-slate-200/70">
              No QuoteUpdated events yet. Trigger refresh_quotes_permissionless
              on /bot to populate the chart.
            </div>
          ) : (
            <Sparkline points={points} />
          )}
        </div>
      </div>
    </section>
  )
}

export default PriceChartCard
