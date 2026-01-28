"use client"

import { useSuiClient } from "@mysten/dapp-kit"
import {
  getAmmConfigOverview,
  type AmmConfigOverview
} from "@sui-amm/domain-core/models/amm"
import { useCallback, useEffect, useState } from "react"

export type AmmConfigStatus = "idle" | "loading" | "success" | "error"

type AmmConfigState = {
  status: AmmConfigStatus
  ammConfig?: AmmConfigOverview
  error?: string
}

const emptyAmmConfigState = (): AmmConfigState => ({
  status: "idle"
})

const useAmmConfigOverview = (ammConfigId?: string) => {
  const suiClient = useSuiClient()
  const [state, setState] = useState<AmmConfigState>(emptyAmmConfigState())
  const [refreshIndex, setRefreshIndex] = useState(0)

  const refreshAmmConfig = useCallback(() => {
    setRefreshIndex((previous) => previous + 1)
  }, [])

  const applyAmmConfigUpdate = useCallback((ammConfig: AmmConfigOverview) => {
    setState({ status: "success", ammConfig, error: undefined })
  }, [])

  useEffect(() => {
    let active = true

    if (!ammConfigId) {
      setState(emptyAmmConfigState())
      return () => {
        active = false
      }
    }

    setState({ status: "loading" })

    const load = async () => {
      try {
        const ammConfig = await getAmmConfigOverview(ammConfigId, suiClient)
        if (!active) return
        setState({ status: "success", ammConfig })
      } catch (error) {
        if (!active) return
        setState({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "Unable to load AMM config."
        })
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [ammConfigId, refreshIndex, suiClient])

  return {
    status: state.status,
    ammConfig: state.ammConfig,
    error: state.error,
    refreshAmmConfig,
    applyAmmConfigUpdate
  }
}

export default useAmmConfigOverview
