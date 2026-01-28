"use client"

import { useMemo } from "react"
import {
  AMM_CONFIG_ID_NOT_DEFINED,
  AMM_CONFIG_VARIABLE_NAME
} from "../config/network"
import { resolveConfiguredId } from "../helpers/network"
import useNetworkConfig from "./useNetworkConfig"

const useResolvedAmmConfigId = () => {
  const { useNetworkVariable } = useNetworkConfig()
  const rawAmmConfigId = useNetworkVariable(AMM_CONFIG_VARIABLE_NAME)

  return useMemo(
    () => resolveConfiguredId(rawAmmConfigId, AMM_CONFIG_ID_NOT_DEFINED),
    [rawAmmConfigId]
  )
}

export default useResolvedAmmConfigId
