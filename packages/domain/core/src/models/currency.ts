import { normalizeSuiAddress } from "@mysten/sui/utils"

export const ensureSignerOwnsCoin = ({
  coinObjectId,
  coinOwnerAddress,
  signerAddress
}: {
  coinObjectId: string
  coinOwnerAddress: string
  signerAddress: string
}) => {
  if (
    normalizeSuiAddress(coinOwnerAddress) === normalizeSuiAddress(signerAddress)
  )
    return

  throw new Error(
    `Coin ${coinObjectId} is not owned by signer ${signerAddress} (owner ${coinOwnerAddress}).`
  )
}
