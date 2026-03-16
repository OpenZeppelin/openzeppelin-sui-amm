import type { Argv } from "yargs"

const AMM_PACKAGE_ID_DESCRIPTION =
  "Package ID for the PropAmm Move package; inferred from the latest publish entry when omitted."
const OWNER_ADDRESS_DESCRIPTION =
  "Owner address for trader-account creation; defaults to the active signer."
const TRADER_ACCOUNT_ID_DESCRIPTION =
  "Existing trader account id; when omitted the flow reuses an owned trader account first and only creates one if none exists."
const DEV_INSPECT_DESCRIPTION = "Run a dev-inspect and log VM error details."
const DRY_RUN_DESCRIPTION =
  "Run dev-inspect and exit without executing transactions."
const JSON_OUTPUT_DESCRIPTION = "Output results as JSON."

export const withAmmPackageIdOption = <T>(yargsInstance: Argv<T>) =>
  yargsInstance.option("ammPackageId", {
    alias: ["amm-package-id"],
    type: "string",
    description: AMM_PACKAGE_ID_DESCRIPTION,
    demandOption: false
  })

export const withCommonRegistrationOptions = <T>(
  yargsInstance: Argv<T>,
  { includeDebugAlias = false }: { includeDebugAlias?: boolean } = {}
) =>
  yargsInstance
    .option("ownerAddress", {
      alias: ["owner-address"],
      type: "string",
      description: OWNER_ADDRESS_DESCRIPTION,
      demandOption: false
    })
    .option("traderAccountId", {
      alias: ["trader-account-id"],
      type: "string",
      description: TRADER_ACCOUNT_ID_DESCRIPTION,
      demandOption: false
    })
    .option("devInspect", {
      alias: includeDebugAlias ? ["dev-inspect", "debug"] : ["dev-inspect"],
      type: "boolean",
      default: false,
      description: DEV_INSPECT_DESCRIPTION
    })
    .option("dryRun", {
      alias: ["dry-run"],
      type: "boolean",
      default: false,
      description: DRY_RUN_DESCRIPTION
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: JSON_OUTPUT_DESCRIPTION
    })
