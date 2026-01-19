# UI: Sui AMM Dashboard

This UI is a Next.js 16 app that talks directly to Sui via Mysten dapp-kit.

## 1. Prereqs
1. Localnet running (or a target network RPC).
2. A published `` package and a AMM ID.
3. A wallet with the right network selected.

## 2. Run it
```bash
pnpm ui dev
```

## 3. Configure networks (.env.local)
Create `packages/ui/.env.local` and set package + package IDs:
```bash
NEXT_PUBLIC_LOCALNET_CONTRACT_PACKAGE_ID=0x...
NEXT_PUBLIC_TESTNET_CONTRACT_PACKAGE_ID=0x...
```

Optional UI labels:
```bash
NEXT_PUBLIC_APP_NAME="Sui AMM"
NEXT_PUBLIC_APP_DESCRIPTION="Sui AMM"
```
