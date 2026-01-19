
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
# 1) Clone and install
git clone git@github.com:OpenZeppelin/openzeppelin-sui-amm.git && cd openzeppelin-sui-amm
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
