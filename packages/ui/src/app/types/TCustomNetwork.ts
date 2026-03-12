export type TCustomNetworkConfig = {
  networkKey: string
  label: string
  rpcUrl: string
  explorerUrl: string
  contractPackageId: string
  ammConfigId?: string
}

export type TCustomNetworkDraft = TCustomNetworkConfig

export type TCustomNetworkErrors = Partial<
  Record<keyof TCustomNetworkDraft, string>
>
