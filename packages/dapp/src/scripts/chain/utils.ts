import { logKeyValueBlue } from "@sui-amm/tooling-node/log"

export const logChainContext = ({
  networkName,
  rpcUrl,
  subjectLabel,
  subjectValue
}: {
  networkName: string
  rpcUrl: string
  subjectLabel: string
  subjectValue: string
}) => {
  logKeyValueBlue("Network")(networkName)
  logKeyValueBlue("RPC")(rpcUrl)
  logKeyValueBlue(subjectLabel)(subjectValue)
  console.log("")
}

export const formatBigInt = (value: bigint) => value.toString()
