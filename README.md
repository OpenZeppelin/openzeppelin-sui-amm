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
export TRADER_PRIVATE_KEY=<bech32 or base64>
export SUI_NETWORK=localnet

# 4. Start localnet in a separate terminal. `--force-regenesis` wipes any
#    previous chain state. Keep this process running.
pnpm --filter dapp chain:localnet:start --force-regenesis --with-faucet

# 5. Publish the AMM. With `--with-unpublished-dependencies` (auto-enabled
#    on localnet) Sui CLI inlines deepbook + token + pyth-mock bytecode into
#    the AMM's package address, and those deps' `init` functions auto-share
#    `DeepBook::Registry`, `DeepbookAdminCap`, and `pyth_state::State` in the
#    same publish. mock:setup discovers them rather than republishing.
pnpm --filter dapp move:publish --package-path prop-amm --re-publish

# 6. Publish coin-mock + mint USDC, discover the merged-AMM shared objects,
#    and seed the SUI/USD + USDC/USD Pyth price feeds. Re-runs are idempotent
#    unless `--re-publish` is passed.
pnpm --filter dapp mock:setup

# 7. Register `0x2::sui::SUI` in the coin registry (one-time per chain;
#    SUI predates the registry so it has to be migrated explicitly).
pnpm --filter dapp mock:sui:migrate

# 8. Create the whitelisted DeepBook SUI/USDC pool against the merged AMM's
#    deepbook modules. The script reads the coin types from `mock.localnet.json`.
pnpm --filter dapp mock:pool:create

# 9. Run the UI and open http://localhost:3000. Localnet ids are read at
#    runtime from `packages/dapp/deployments/{mock,deployment}.localnet.json`
#    via the symlink at `packages/ui/public/deployments`, so re-running
#    move:publish or mock:setup is picked up on the next page reload — no
#    manual `.env` editing.
pnpm --filter ui dev
```

In the dApp:

- `/setup` → create the executor against the SUI/USDC pool id from step 8, using the real Pyth feed-id hexes (`0x50c67b3f…ea266` for SUI/USD, `0x41f36259…e722` for USDC/USD).
- `/funding` → deposit base + quote into the BalanceManager.
- `/bot` → trigger Refresh quotes.

## Why move:publish runs before mock:setup

Sui CLI ≥ 1.70 ignores `published-at` directives in `[dep-replacements]`
during `sui client test-publish` whenever a `local = ...` is also present.
That means publishing deepbook/pyth standalone first and then "linking" the
AMM to those addresses doesn't work — the AMM publish would re-merge new
copies and produce a `Pool<...>` type incompatible with the standalone Pool.

So the AMM is published first with `--with-unpublished-dependencies`,
inlining deepbook + token + pyth-mock into its own package address. The
deps' `init` functions auto-share `DeepBook::Registry`, `DeepbookAdminCap`,
and `pyth_state::State` in the same publish transaction. mock:setup then
reads those shared-object ids out of the AMM publish's `objectChanges` and
records them in `mock.localnet.json` with `deepbookPackageId` /
`pythPackageId` / `deepbookTokenPackageId` all collapsed to the AMM id.

coin-mock isn't a dep of the AMM, so it stays a standalone publish.

## Troubleshooting

- **`sui --version` hangs**: stale `sui-test-validator` / `sui` processes
  holding a lock. `pgrep -af sui` and kill them, then retry.
- **`AMM not yet published`** during `mock:setup`: run step 5
  (`move:publish --package-path prop-amm --re-publish`) first.
- **`Dry run failed: TypeMismatch in command 0`** when creating an executor:
  the AMM and the on-chain Pool came from different deepbook copies. Re-run
  steps 5–8 in order; verify with `curl … sui_getNormalizedMoveFunction
  market new` that `result.parameters[0]` references `Pool` at the AMM
  packageId.
- **`Your package is already published`**: an ephemeral `Pub.<env>.toml`
  is left over. Delete it (the tooling does this for the packages it
  manages, but stragglers happen):
  `find packages/dapp/contracts vendor/deepbookv3 -name "Pub.*.toml" -delete`.
- **`MoveAbort … dynamic_field … add` while seeding price feeds**: the on-chain
  pyth-mock `State` already has the SUI/USD or USDC/USD entry from a prior
  `mock:setup` run, but `mock.localnet.json` was wiped and forgot about it.
  The fix is to re-publish the AMM (which mints a fresh empty `State`)
  before re-running `mock:setup`: `pnpm --filter dapp move:publish
  --package-path prop-amm --re-publish`.
- **`The package does not define an localnet environment`**: the active
  `sui client` env name (`localnet`) doesn't match any `[environments]` key
  in the package's `Move.toml`. The mock packages declare `test-publish`,
  so the tooling falls back to `sui client test-publish` automatically.
