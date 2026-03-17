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
export SUI_NETWORK=localnet

# Start localnet (new terminal) (--with-faucet is recommended as some script auto fund address if fund is missing)
pnpm script chain:localnet:start --with-faucet

# Publish mocks and contracts
pnpm dapp mock:setup 
pnpm dapp move:publish --packagePath contracts/prop-amm/

# Register mocks
pnpm dapp mock:register

# Create and register the AMM
# Note: --deepbook-package-id and --deepbook-registry-id can be found in the output of the previous command.

pnpm dapp owner:amm:create

pnpm dapp owner:amm:register --deepbook-package-id <0x...> --deepbook-registry-id <0x...>


# Create the packages/ui/.env.local file
## Copy the sample .env file
cp packages/ui/.env.example packages/ui/.env.local

## Add required field details - you will find these details in the output of the two last pnpm commands. 
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=<0x...>
NEXT_PUBLIC_LOCALNET_AMM_CONFIG_ID=<0x..>

# Run the UI
pnpm ui dev

```

## Setup (localnet)

```bash
# Setup coins and pyth mocks, deploy local deepbook
pnpm script mock:setup --network localnet

# Publish prop amm
pnpm script move:publish --package-path prop-amm --with-unpublished-dependencies false --network localnet

# Register your amm package against local deepbook
pnpm script mock:register --network localnet

# Create an amm config
pnpm dapp owner:amm:create --network localnet
```