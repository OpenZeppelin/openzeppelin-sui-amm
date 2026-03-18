import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client"
import { ensureCreatedObject } from "@sui-amm/tooling-node/transactions"

export const loadPublishTransaction = async ({
  publishDigest,
  suiClient
}: {
  publishDigest: string
  suiClient: SuiClient
}): Promise<SuiTransactionBlockResponse> =>
  suiClient.getTransactionBlock({
    digest: publishDigest,
    options: { showObjectChanges: true }
  })

export const resolveCreatedObjectFromPublishTransaction = ({
  publishTransaction,
  objectTypeSuffix
}: {
  publishTransaction: SuiTransactionBlockResponse
  objectTypeSuffix: string
}) => ensureCreatedObject(objectTypeSuffix, publishTransaction)

export const resolveCreatedObjectFromPublishDigest = async ({
  publishDigest,
  suiClient,
  objectTypeSuffix
}: {
  publishDigest: string
  suiClient: SuiClient
  objectTypeSuffix: string
}) =>
  resolveCreatedObjectFromPublishTransaction({
    publishTransaction: await loadPublishTransaction({
      publishDigest,
      suiClient
    }),
    objectTypeSuffix
  })
