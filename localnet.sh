rm $LOCALNET_FILE

sui client switch --env local

echo "Initializing funds for: $LOCALNET_ADDRESS"
sui client faucet --address $LOCALNET_ADDRESS

sleep 60

sui client balance $LOCALNET_ADDRESS

publish_package() {
  local package_path="$1"
  local build_env="$2"  # optional

  echo "Publishing package: $package_path"

  local output
  output=$(sui client test-publish "$package_path" \
    --json \
    ${build_env:+--build-env "$build_env"} \
    --pubfile-path $LOCALNET_FILE \
    --publish-unpublished-deps 2>/dev/null)

  local package_id
  package_id=$(echo "$output" | jq -r '.objectChanges[] | select(.type == "published") | .packageId')

  echo "Package address for $package_path is: $package_id"
}

publish_package "packages/dapp/contracts/pyth-mock" "testnet" # creates pubfile with build-env=testnet
publish_package "packages/dapp/contracts/coin-mock"
publish_package "vendor/deepbookv3/packages/deepbook" # token will be auto-published as a dependency
