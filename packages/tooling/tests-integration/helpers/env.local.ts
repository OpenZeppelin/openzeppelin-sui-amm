import path from "node:path"
import { fileURLToPath } from "node:url"

import { createSuiLocalnetTestEnv } from "@sui-amm/tooling-node/testing/env"

const localHelperRoot = path.dirname(fileURLToPath(import.meta.url))

const localFixturePath = (...segments: string[]) =>
  path.join(localHelperRoot, "..", "fixtures-local", ...segments)

const resolveKeepTemp = () => process.env.SUI_IT_KEEP_TEMP === "1"

const resolveWithFaucet = () => process.env.SUI_IT_WITH_FAUCET !== "0"

export const createToolingIntegrationTestEnv = () =>
  createSuiLocalnetTestEnv({
    mode: "test",
    keepTemp: resolveKeepTemp(),
    withFaucet: resolveWithFaucet(),
    moveSourceRootPath: localFixturePath("localnet-move")
  })
