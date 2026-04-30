> [!Warning]
> This is experimental UN-AUDITED code currently under development

# Sui AMM

End-to-end example of a small AMM on **Sui**

A Proprietary Automated Market Maker (Prop AMM) is a new DeFi primitive where a market-making algorithm is embedded on-chain, allowing an individual market maker (not a pool of passive LPs) to provide active liquidity with real-time quote updates. This model shifts away from traditional constant-product or even concentrated AMMs by letting the on-chain program continuously adjust its prices independently of trades. The result is tighter spreads and more competitive pricing that can rival centralized exchanges

This repo is a pnpm workspace containing:

- a Move packages,
- a CLI/script layer for localnet + seeding + amm flows,
- a Next.js UI

## DeepBook submodule

Localnet scripts publish DeepBook from a pinned submodule so development is reproducible.

Setup (once per clone):
```bash
git submodule update --init --recursive
```

If you keep DeepBook elsewhere, you can also pass `--deepbook-contract-path`

Update to a newer DeepBook commit:
```bash
cd vendor/deepbookv3
git fetch
git checkout <commit-or-tag>
cd ../..
git add vendor/deepbookv3 .gitmodules
git commit -m "chore: update deepbook submodule"
```

## Prerequisites

- **Sui CLI ≥ 1.70** (1.70.2 verified). Older CLIs use a different `sui client publish` flag set and won't work with this repo.
- `pnpm` (the repo is a workspace).
- Node 20+.

## Quickstart (localnet)

```bash
# 1. Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-amm.git && cd openzeppelin-sui-amm
pnpm install
git submodule update --init --recursive

# 2. Create or reuse a publisher address. Save the recovery phrase so you can
#    import the same address in your browser wallet later.
sui client new-address ed25519 publisher

# 3. Point the scripts at this address. Either set the active client env to
#    `localnet` (`sui client switch --env localnet`) or export the trio below.
export TRADER_ADDRESS=<0x...>
export TRADER_PRIVATE_KEY=<base64 or hex>
export SUI_NETWORK=localnet

# 4. Start localnet in a separate terminal. `--force-regenesis` wipes any
#    previous chain state. Keep this process running.
pnpm --filter dapp chain:localnet:start --force-regenesis --with-faucet

# 5. Publish mock dependencies (pyth-mock, coin-mock, deepbook, deepbook
#    token) and seed the SUI/USD + USDC/USD price feeds. Re-runs are
#    idempotent unless `--re-publish` is passed.
pnpm --filter dapp mock:setup

# 6. Register `0x2::sui::SUI` in the coin registry (one-time per chain;
#    SUI predates the registry so it has to be migrated explicitly).
pnpm --filter dapp mock:sui:migrate

# 7. Create the whitelisted DeepBook SUI/USDC pool (zero fees, zero DEEP
#    cost). The script reads the coin types from `mock.localnet.json`.
pnpm --filter dapp mock:pool:create

# 8. Publish the AMM contract.
#    NOTE: Sui CLI ≥ 1.70 ignores `published-at` directives in
#    dep-replacements during `sui client test-publish`. Until the tooling
#    auto-writes a chained pubfile, you must hand-craft
#    `packages/dapp/contracts/prop-amm/Pub.localnet.toml` with `[[published]]`
#    entries for `deepbook`, `token`, and `pyth-mock` pointing to the actual
#    on-chain ids from `packages/dapp/deployments/mock.localnet.json`. See
#    "Pub.localnet.toml workaround" below.
pnpm --filter dapp move:publish --package-path prop-amm --re-publish --use-cli-publish

# 9. Wire ids into the UI env. Copy from `mock.localnet.json` and from
#    the AMM publish output above.
cp packages/ui/.env.example packages/ui/.env.local
# Then edit packages/ui/.env.local and set:
#   NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=<AMM packageId from step 8>
#   NEXT_PUBLIC_LOCALNET_DEEPBOOK_REGISTRY_ID=<deepbookRegistryId>
#   NEXT_PUBLIC_LOCALNET_DEEPBOOK_PACKAGE_ID=<deepbookPackageId>
#   NEXT_PUBLIC_LOCALNET_PYTH_MOCK_PACKAGE_ID=<pythPackageId>
#   NEXT_PUBLIC_LOCALNET_PYTH_STATE_ID=<pythStateId>

# 10. Run the UI and open http://localhost:3000
pnpm --filter ui dev
```

In the dApp:

- `/setup` → create the executor against the SUI/USDC pool id from step 7, using the real Pyth feed-id hexes (`0x50c67b3f…ea266` for SUI/USD, `0x41f36259…e722` for USDC/USD).
- `/funding` → deposit base + quote into the BalanceManager.
- `/bot` → trigger Refresh quotes.

## Pub.localnet.toml workaround

`sui client test-publish` (Sui ≥ 1.70) inlines local-replaced deps and binds them
to ephemeral addresses unless the deps already appear in the package's
`Pub.<env>.toml`. To make AMM's bytecode reference the *actual* on-chain
DeepBook / pyth-mock / token packages, write a file like this **before** step 8:

```toml
# packages/dapp/contracts/prop-amm/Pub.localnet.toml
build-env = "test-publish"
chain-id = "<localnet chain id, e.g. 305e72d1>"

[[published]]
source = { local = "<absolute path>/vendor/deepbookv3/packages/deepbook" }
published-at = "<deepbookPackageId>"
original-id = "<deepbookPackageId>"
version = 1
toolchain-version = "1.70.2"
build-config = { flavor = "sui", edition = "2024.beta" }
upgrade-capability = "<deepbook upgradeCap from deployment.localnet.json>"

[[published]]
source = { local = "<absolute path>/vendor/deepbookv3/packages/token" }
published-at = "<deepbookTokenPackageId>"
original-id = "<deepbookTokenPackageId>"
version = 1
toolchain-version = "1.70.2"
build-config = { flavor = "sui", edition = "2024.beta" }
upgrade-capability = "<token upgradeCap>"

[[published]]
source = { local = "<absolute path>/packages/dapp/contracts/pyth-mock" }
published-at = "<pythPackageId>"
original-id = "<pythPackageId>"
version = 1
toolchain-version = "1.70.2"
build-config = { flavor = "sui", edition = "2024" }
upgrade-capability = "<pyth-mock upgradeCap>"
```

`packageId`s come from `packages/dapp/deployments/mock.localnet.json`;
matching `upgradeCap`s come from `packages/dapp/deployments/deployment.localnet.json`.
After step 8 succeeds, verify with:

```bash
curl -sX POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"sui_getNormalizedMoveFunction","params":["<AMM packageId>","market","new"]}' \
  http://127.0.0.1:9000 | jq '.result.parameters[0]'
```

— the `Pool` reference's `address` should equal the deepbook packageId, **not**
the AMM packageId.

## Troubleshooting

- **`sui --version` hangs**: stale `sui-test-validator` / `sui` processes
  holding a lock. `pgrep -af sui` and kill them, then retry.
- **`Dry run failed: TypeMismatch in command 0`** when creating an executor:
  the AMM was published without the Pub.localnet.toml workaround, so its
  bytecode references the wrong DeepBook address. Redo step 8 with the
  workaround in place.
- **`Your package is already published`** during `mock:setup`: an ephemeral
  `Pub.<env>.toml` is left over. Delete it (the tooling does this for the
  packages it manages, but stragglers happen):
  `find packages/dapp/contracts vendor/deepbookv3 -name "Pub.*.toml" -delete`.
- **`The package does not define an localnet environment`**: the active
  `sui client` env name (`localnet`) doesn't match any `[environments]` key
  in the package's `Move.toml`. The mock packages declare `test-publish`,
  so the tooling falls back to `sui client test-publish` automatically.
