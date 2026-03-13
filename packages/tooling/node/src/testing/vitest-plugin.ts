type ToolingVitestTestConfig = {
  environment?: string
  restoreMocks?: boolean
  clearMocks?: boolean
  unstubEnvs?: boolean
} & Record<string, unknown>

type ToolingVitestConfig = {
  test?: ToolingVitestTestConfig
}

export type ToolingVitestPluginOptions = {
  test?: ToolingVitestTestConfig
}

const DEFAULT_TEST_OPTIONS: ToolingVitestTestConfig = {
  environment: "node",
  restoreMocks: true,
  clearMocks: true,
  unstubEnvs: true
}

const mergeTestOptions = (
  current: ToolingVitestTestConfig | undefined,
  override: ToolingVitestTestConfig | undefined
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
