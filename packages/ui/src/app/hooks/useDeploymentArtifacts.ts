"use client"

import { useEffect, useState } from "react"

/**
 * Localnet contract IDs sourced at runtime from `packages/dapp/deployments/`,
 * which is symlinked into `packages/ui/public/deployments` so the JSONs are
 * served as static assets. Re-running `pnpm mock:setup` (or `move:publish`)
 * rewrites the JSONs in place; a UI reload picks up the new ids without a
 * rebuild.
 */
export type DeploymentCoinEntry = {
  label: string
  coinType: string
}

export type DeploymentPoolEntry = {
  poolId: string
  baseCoinType: string
  quoteCoinType: string
}

export type DeploymentArtifacts = {
  contractPackageId: string | undefined
  deepbookPackageId: string | undefined
  deepbookRegistryId: string | undefined
  pythMockPackageId: string | undefined
  pythStateId: string | undefined
  coins: DeploymentCoinEntry[]
  pools: DeploymentPoolEntry[]
}

const EMPTY_ARTIFACTS: DeploymentArtifacts = {
  contractPackageId: undefined,
  deepbookPackageId: undefined,
  deepbookRegistryId: undefined,
  pythMockPackageId: undefined,
  pythStateId: undefined,
  coins: [],
  pools: []
}

const AMM_PACKAGE_NAME = "openzeppelin_market_maker"

type MockArtifactCoin = {
  label?: string
  coinType?: string
}

type MockArtifactPool = {
  poolId?: string
  baseCoinType?: string
  quoteCoinType?: string
}

type MockArtifact = {
  pythPackageId?: string
  pythStateId?: string
  deepbookPackageId?: string
  deepbookRegistryId?: string
  coins?: MockArtifactCoin[]
  pools?: MockArtifactPool[]
}

type DeploymentRecord = {
  packageName?: string
  packageId?: string
}

const fetchJson = async <T>(path: string): Promise<T | undefined> => {
  try {
    const response = await fetch(path, { cache: "no-cache" })
    if (!response.ok) return undefined
    return (await response.json()) as T
  } catch {
    return undefined
  }
}

const loadArtifacts = async (): Promise<DeploymentArtifacts> => {
  const [mock, deployment] = await Promise.all([
    fetchJson<MockArtifact>("/deployments/mock.localnet.json"),
    fetchJson<DeploymentRecord[]>("/deployments/deployment.localnet.json")
  ])
  // Pick the most recent AMM publish — the file accumulates an entry per
  // re-publish, and only the latest one matches the deps the AMM bytecode
  // is currently bound to. Iterate from the tail manually to stay ES2020-
  // compatible (Array.prototype.findLast is ES2023; not all Next.js build
  // targets ship a polyfill).
  let ammRecord: DeploymentRecord | undefined
  if (deployment) {
    for (let index = deployment.length - 1; index >= 0; index -= 1) {
      const entry = deployment[index]
      if (entry?.packageName === AMM_PACKAGE_NAME) {
        ammRecord = entry
        break
      }
    }
  }
  const coins =
    mock?.coins?.flatMap((entry) =>
      entry.label && entry.coinType
        ? [{ label: entry.label, coinType: entry.coinType }]
        : []
    ) ?? []
  const pools =
    mock?.pools?.flatMap((entry) =>
      entry.poolId && entry.baseCoinType && entry.quoteCoinType
        ? [
            {
              poolId: entry.poolId,
              baseCoinType: entry.baseCoinType,
              quoteCoinType: entry.quoteCoinType
            }
          ]
        : []
    ) ?? []
  return {
    contractPackageId: ammRecord?.packageId,
    deepbookPackageId: mock?.deepbookPackageId,
    deepbookRegistryId: mock?.deepbookRegistryId,
    pythMockPackageId: mock?.pythPackageId,
    pythStateId: mock?.pythStateId,
    coins,
    pools
  }
}

// Module-scoped cache: a single promise is shared by all hook instances so we
// don't re-fetch the JSONs on every mount. Cleared implicitly on full reload.
let pending: Promise<DeploymentArtifacts> | undefined

const ensureLoad = () => {
  if (!pending) pending = loadArtifacts()
  return pending
}

export const useDeploymentArtifacts = (): DeploymentArtifacts => {
  const [artifacts, setArtifacts] =
    useState<DeploymentArtifacts>(EMPTY_ARTIFACTS)
  useEffect(() => {
    let cancelled = false
    ensureLoad().then((value) => {
      if (!cancelled) setArtifacts(value)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return artifacts
}

export default useDeploymentArtifacts
