import { isRecord } from "@sui-amm/tooling-core/utils/utility"

export type MergeArrayFieldResolvers = Record<
  string,
  (entry: unknown) => string | undefined
>

type DedupedEntriesState<TEntry> = {
  dedupedReversed: TEntry[]
  seenKeys: ReadonlySet<string>
}

export const dedupeEntriesByKey = <TEntry>(
  entries: TEntry[],
  resolveKey: (entry: TEntry) => string | undefined
): TEntry[] => {
  const { dedupedReversed } = entries.reduceRight<DedupedEntriesState<TEntry>>(
    (state, entry) => {
      const key = resolveKey(entry)

      if (!key) {
        return {
          dedupedReversed: [...state.dedupedReversed, entry],
          seenKeys: state.seenKeys
        }
      }

      if (state.seenKeys.has(key)) {
        return state
      }

      return {
        dedupedReversed: [...state.dedupedReversed, entry],
        seenKeys: new Set([...state.seenKeys, key])
      }
    },
    {
      dedupedReversed: [],
      seenKeys: new Set<string>()
    }
  )

  return [...dedupedReversed].reverse()
}

const mergeCollectionField = (
  fieldName: string,
  resolveKey: (entry: unknown) => string | undefined,
  currentObject: Record<string, unknown>,
  nextObject: Record<string, unknown>
): [string, unknown] | [] => {
  const currentEntries = Array.isArray(currentObject[fieldName])
    ? currentObject[fieldName]
    : undefined
  const nextEntries = Array.isArray(nextObject[fieldName])
    ? nextObject[fieldName]
    : undefined

  if (!currentEntries && !nextEntries) {
    return []
  }

  return [
    fieldName,
    dedupeEntriesByKey(
      [...(currentEntries ?? []), ...(nextEntries ?? [])],
      resolveKey
    )
  ]
}

const buildCollectionOverrides = (
  currentObject: Record<string, unknown>,
  nextObject: Record<string, unknown>,
  arrayFieldResolvers: MergeArrayFieldResolvers
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(arrayFieldResolvers)
      .map(([fieldName, resolveKey]) =>
        mergeCollectionField(fieldName, resolveKey, currentObject, nextObject)
      )
      .filter((entry): entry is [string, unknown] => entry.length === 2)
  )

export const mergeObjectCollections = <TObject>(
  currentObject: TObject,
  nextObject: TObject,
  arrayFieldResolvers: MergeArrayFieldResolvers = {}
): TObject => {
  if (!isRecord(currentObject) || !isRecord(nextObject)) {
    return nextObject
  }

  return {
    ...currentObject,
    ...nextObject,
    ...buildCollectionOverrides(currentObject, nextObject, arrayFieldResolvers)
  } as TObject
}
