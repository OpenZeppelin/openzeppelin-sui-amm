import type { TestUserConfig } from "vitest/config"

type ToolingVitestConfig = {
  test?: TestUserConfig
}

export type ToolingVitestPluginOptions = {
  test?: TestUserConfig
}

const DEFAULT_TEST_OPTIONS: NonNullable<TestUserConfig> = {
  environment: "node",
  restoreMocks: true,
  clearMocks: true,
  unstubEnvs: true
}

const mergeTestOptions = (
  current: TestUserConfig | undefined,
  override: TestUserConfig | undefined
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
