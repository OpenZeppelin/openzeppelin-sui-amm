import { normalizeSuiObjectId } from "@mysten/sui/utils"

const STORAGE_KEY = "sui-amm:selected-admin-cap-id"
// Custom DOM event the writer fires after touching localStorage so the
// resolver hook reacts in-tab. The native `storage` event only fires for
// cross-tab updates.
const CHANGE_EVENT = "sui-amm:selected-admin-cap-id-change"

const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof window.localStorage !== "undefined"

export const readSelectedAdminCapId = (): string | undefined => {
  if (!isBrowser()) return undefined
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return undefined
    return normalizeSuiObjectId(raw)
  } catch {
    return undefined
  }
}

export const writeSelectedAdminCapId = (adminCapId: string | undefined) => {
  if (!isBrowser()) return
  try {
    if (!adminCapId) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, normalizeSuiObjectId(adminCapId))
    }
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // localStorage may throw under privacy-mode/quota errors. Swallow — the
    // resolver falls back to the first owned cap when no preference is stored.
  }
}

export const subscribeToSelectedAdminCapIdChanges = (
  listener: () => void
): (() => void) => {
  if (!isBrowser()) return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, listener)
  window.addEventListener("storage", onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener)
    window.removeEventListener("storage", onStorage)
  }
}
