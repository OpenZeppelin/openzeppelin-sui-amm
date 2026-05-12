# UI: Sui AMM Dashboard

This UI is a Next.js 16 app that talks directly to Sui via Mysten dapp-kit.

## 1. Prereqs
1. Localnet running (or a target network RPC).
2. A published package and an AMM config object ID.
3. A wallet with the right network selected.

## 2. Run it
```bash
pnpm ui dev
```

## 3. Configure networks (.env)
Localnet IDs are read at runtime from `packages/dapp/deployments/` via the
symlink at `packages/ui/public/deployments`, so re-running `mock:setup` or
`move:publish` is picked up on the next page reload — no manual editing.

For testnet/mainnet/devnet, set the contract package id in `packages/ui/.env`:
```bash
NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=0x...
```

Optional UI labels:
```bash
NEXT_PUBLIC_APP_NAME="Sui AMM"
NEXT_PUBLIC_APP_DESCRIPTION="Sui AMM"
```
