type VitestTestConfig = Record<string, unknown>

type ToolingVitestConfig = {
  test?: VitestTestConfig
}

export type ToolingVitestPluginOptions = {
  test?: VitestTestConfig
}

const DEFAULT_TEST_OPTIONS: VitestTestConfig = {
  environment: "node",
  restoreMocks: true,
  clearMocks: true,
  unstubEnvs: true
}

const mergeTestOptions = (
  current: VitestTestConfig | undefined,
  override: VitestTestConfig | undefined
) => ({
  ...DEFAULT_TEST_OPTIONS,
  ...(current ?? {}),
  ...(override ?? {})
})

export const toolingVitestPlugin = (
  options?: ToolingVitestPluginOptions
): {
  name: string
  config: (config: ToolingVitestConfig) => Pick<ToolingVitestConfig, "test">
} => ({
  name: "sui-oracle-market:tooling-vitest",
  config: (config: ToolingVitestConfig) => ({
    test: mergeTestOptions(config.test, options?.test)
  })
})
