
> [!Warning]
> This is experimental UN-AUDITED code currently under development

# Sui AMM

End-to-end example of a small AMM on **Sui**

A Proprietary Automated Market Maker (Prop AMM) is a new DeFi primitive where a market-making algorithm is embedded on-chain, allowing an individual market maker (not a pool of passive LPs) to provide active liquidity with real-time quote updates. This model shifts away from traditional constant-product or even concentrated AMMs by letting the on-chain program continuously adjust its prices independently of trades. The result is tighter spreads and more competitive pricing that can rival centralized exchanges

This repo is a pnpm workspace containing:
- a Move packages,
- a CLI/script layer for localnet + seeding + amm flows,
- a Next.js UI,

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

## Quickstart (localnet)


```bash
# 1) Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-amm.git && cd openzeppelin-sui-amm
# Initialize submodules (DeepBook)
git submodule update --init --recursive
# (pnpm workspace install from the repo root)
pnpm install

# 2) Create or reuse an address (this will be your publisher address) (note the recovery phrase to import it later in your browser wallet)
sui client new-address ed25519

# 3) Configure this address in Sui config file or export
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>

# 4) Start localnet (new terminal) (--with-faucet is recommended as some script auto fund address if fund is missing)
pnpm script chain:localnet:start --with-faucet

# 5) Run the UI
pnpm ui dev

```

## Localnet setup (scripts)

This section describes the localnet script flow and what each step does. This mirrors the shared‑network flow by keeping DeepBook and its token dependency as separate published packages (no inlining).

```bash
# 1) Publish mocks + DeepBook (token -> DeepBook) and update Move.toml mappings
pnpm --filter dapp mock:setup --re-publish

# 2) Publish PropAmm without inlining dependencies
pnpm --filter dapp move:publish --package-path prop-amm --network localnet --no-with-unpublished-dependencies --re-publish

# 3) Register PropAmm with DeepBook and create the trader account + balance manager
pnpm --filter dapp mock:register --network localnet
```

What each step does:

1) `mock:setup`
   - Publishes mock Pyth and mock coin packages.
   - Publishes DeepBook token, then writes a localnet `dep-replacements` entry into DeepBook’s `Move.toml`.
   - Publishes DeepBook without unpublished dependencies.
   - Ensures both DeepBook and token `Move.toml` files have a localnet environment entry (and removes `[addresses]` if present).
   - Writes localnet artifacts to `packages/dapp/deployments/mock.localnet.json` (DeepBook package/registry/admin cap, token, coins, price feeds).
   - Updates `packages/dapp/move/prop-amm/Move.toml` with the DeepBook published IDs for localnet.

2) `move:publish` (PropAmm)
   - Publishes PropAmm against the **published** DeepBook package (no inlining).
   - Fails fast if the DeepBook/token dep‑replacements are missing.
   - Writes publish artifacts to `packages/dapp/deployments/deployment.localnet.json`.

3) `mock:register`
   - Authorizes `PropAmmApp` in the DeepBook registry (idempotent).
   - Creates the trader account and balance manager, plus the deposit/withdraw/trade caps.
   - Uses the mock artifacts from step 1 if you don’t pass explicit IDs.

Notes:
- After a localnet regenesis, rerun steps 1–3.
- If you keep DeepBook elsewhere, pass `--deepbook-contract-path` and `--deepbook-token-contract-path` to `mock:setup`.

## Shared networks (testnet/mainnet)

These steps assume DeepBook is already deployed on the target network and managed by the DeepBook registry admin.

```bash
# 1) Publish PropAmm (no inlining)
pnpm --filter dapp move:publish --package-path prop-amm --network testnet

# 2) Register PropAmm with DeepBook and create the trader account + balance manager
pnpm --filter dapp owner:amm-register --network testnet
```

Important notes:
- The DeepBook registry admin must authorize `PropAmmApp` and initialize the balance manager map before running `owner:amm-register`.
- `owner:amm-register` defaults to known DeepBook IDs for testnet/mainnet, but you can override them with `--deepbook-package-id` and `--deepbook-registry-id`.

DeepBook IDs (may change with upgrades; verify before use):
- Testnet package: `0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c`
- Testnet registry: `0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1`
- Mainnet package: `0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497`
- Mainnet registry: `0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d`

If these IDs change, update `packages/domain/core/src/models/deepbook.ts` or pass explicit IDs to the script.
