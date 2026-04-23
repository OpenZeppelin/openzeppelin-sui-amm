import type { Argv } from "yargs"

const AMM_PACKAGE_ID_DESCRIPTION =
  "Package ID for the PropAmm Move package; inferred from the latest publish entry when omitted."
const OWNER_ADDRESS_DESCRIPTION =
  "Owner address that owns the market maker executor; defaults to the active signer."
const EXECUTOR_ID_DESCRIPTION =
  "Existing market maker executor id; when omitted the flow resolves an owned market maker executor."
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

export const withCommonRegistrationOptions = <T>(yargsInstance: Argv<T>) =>
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
      description: EXECUTOR_ID_DESCRIPTION,
      demandOption: false
    })
    .option("json", {
      type: "boolean",
      default: false,
      description: JSON_OUTPUT_DESCRIPTION
    })

export const withTransactionExecutionOptions = <T>(
  yargsInstance: Argv<T>,
  { includeDebugAlias = false }: { includeDebugAlias?: boolean } = {}
) =>
  yargsInstance
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
