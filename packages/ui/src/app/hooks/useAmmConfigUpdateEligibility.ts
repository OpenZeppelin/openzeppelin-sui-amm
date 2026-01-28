"use client"

import { useCurrentAccount, useSuiClient } from "@mysten/dapp-kit"
import type { SuiClient } from "@mysten/sui/client"
import {
  deriveRelevantPackageId,
  getSuiObject
} from "@sui-amm/tooling-core/object"
import { useEffect, useState } from "react"
import { resolveAmmAdminCapId } from "../helpers/ammAdminCap"

type EligibilityState = {
  status: "idle" | "loading" | "ready" | "error"
  canUpdate: boolean
}

const emptyEligibilityState = (): EligibilityState => ({
  status: "idle",
  canUpdate: false
})

const fetchAmmPackageId = async ({
  ammConfigId,
  suiClient
}: {
  ammConfigId: string
  suiClient: SuiClient
}): Promise<string> => {
  const { object } = await getSuiObject(
    { objectId: ammConfigId },
    { suiClient }
  )
  return deriveRelevantPackageId(object.type)
}

const useAmmConfigUpdateEligibility = (ammConfigId?: string) => {
  const currentAccount = useCurrentAccount()
  const suiClient = useSuiClient()
  const walletAddress = currentAccount?.address
  const [state, setState] = useState<EligibilityState>(emptyEligibilityState())

  useEffect(() => {
    let active = true

    if (!walletAddress || !ammConfigId) {
      setState(emptyEligibilityState())
      return () => {
        active = false
      }
    }

    setState({ status: "loading", canUpdate: false })

    const load = async () => {
      try {
        const packageId = await fetchAmmPackageId({ ammConfigId, suiClient })
        const adminCapId = await resolveAmmAdminCapId({
          ownerAddress: walletAddress,
          packageId,
          suiClient
        })

        if (!active) return
        setState({
          status: "ready",
          canUpdate: Boolean(adminCapId)
        })
      } catch {
        if (!active) return
        setState({ status: "error", canUpdate: false })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [ammConfigId, suiClient, walletAddress])

  return {
    canUpdateConfig: state.canUpdate
  }
}

export default useAmmConfigUpdateEligibility
