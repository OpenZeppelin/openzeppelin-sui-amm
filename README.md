> [!Warning]
> This is experimental UN-AUDITED code currently under development

# Sui AMM

End-to-end example of a small AMM on **Sui**

A Proprietary Automated Market Maker (Prop AMM) is a new DeFi primitive where a market-making algorithm is embedded on-chain, allowing an individual market maker (not a pool of passive LPs) to provide active liquidity with real-time quote updates. This model shifts away from traditional constant-product or even concentrated AMMs by letting the on-chain program continuously adjust its prices independently of trades. The result is tighter spreads and more competitive pricing that can rival centralized exchanges

This repo is a pnpm workspace containing:

- a Move packages,
- a CLI/script layer for localnet + seeding + amm flows,
- a Next.js UI,

## Quickstart (localnet)

```bash
# Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-amm.git && cd openzeppelin-sui-amm
# (pnpm workspace install from the repo root)
pnpm install

# Initialize submodules (DeepBook)
git submodule update --init --recursive

# Create or reuse an address (this will be your publisher address) (note the recovery phrase to import it later in your browser wallet)
sui client new-address ed25519

# Configure this address in Sui config file or export
export SUI_ACCOUNT_ADDRESS=<0x...>
export SUI_ACCOUNT_PRIVATE_KEY=<base64 or hex>

# Start localnet (new terminal) (--with-faucet is recommended as some script auto fund address if fund is missing)
pnpm script chain:localnet:start --with-faucet

# Run the UI
pnpm ui dev

```

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

## Localnet setup (scripts)

This flow keeps DeepBook and its token dependency as separately published packages on localnet, matching the shared-network publish shape instead of inlining them.

```bash
# 1) Publish mocks + DeepBook (token first, then DeepBook) and update local Move.toml mappings
pnpm --filter dapp mock:setup --re-publish

# 2) Publish PropAmm against the published DeepBook package
pnpm --filter dapp move:publish --package-path prop-amm --network localnet --no-with-unpublished-dependencies --re-publish

# 3) Register PropAmm with DeepBook and create the trader account + balance manager
pnpm --filter dapp mock:register --network localnet
```

What each step does:

1. `mock:setup`
   Publishes mock Pyth and mock coin packages, publishes the DeepBook token package, updates DeepBook/PropAmm dependency mappings for localnet, publishes DeepBook, and writes localnet mock artifacts.
2. `move:publish`
   Publishes PropAmm against the published DeepBook package instead of auto-inlining unpublished dependencies.
3. `mock:register`
   Authorizes `PropAmmApp` in the DeepBook registry and creates the trader account, balance manager, and capability objects.

Notes:

- After a localnet regenesis, rerun steps 1 through 3.
- If DeepBook lives outside `vendor/deepbookv3`, pass `--deepbook-contract-path` and `--deepbook-token-contract-path` to `mock:setup`.

## Shared networks (testnet/mainnet)

These steps assume DeepBook is already deployed on the target network and managed by the DeepBook registry admin.

```bash
# 1) Publish PropAmm with published DeepBook dependencies
pnpm --filter dapp move:publish --package-path prop-amm --network testnet

# 2) Register PropAmm with DeepBook and create the trader account + balance manager
pnpm --filter dapp owner:amm:register --network testnet
```

Important notes:

- The DeepBook registry admin must authorize `PropAmmApp` and initialize the balance manager map before running `owner:amm:register`.
- `owner:amm:register` defaults to the known DeepBook IDs for testnet and mainnet, but you can override them with `--deepbook-package-id` and `--deepbook-registry-id`.

DeepBook IDs:

- Testnet package: `0x22be4cade64bf2d02412c7e8d0e8beea2f78828b948118d46735315409371a3c`
- Testnet registry: `0x7c256edbda983a2cd6f946655f4bf3f00a41043993781f8674a7046e8c0e11d1`
- Mainnet package: `0x337f4f4f6567fcd778d5454f27c16c70e2f274cc6377ea6249ddf491482ef497`
- Mainnet registry: `0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d`

If these IDs change, update `packages/domain/core/src/models/deepbook.ts` or pass explicit IDs to the script.
