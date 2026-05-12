import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  output: "export",
  distDir: "dist",
  reactStrictMode: true,
  // Allow the LAN IP to load Next.js dev resources (HMR websocket lives at
  // `/_next/webpack-hmr`). Without this, opening the dev UI via the LAN IP
  // instead of localhost prints `Blocked cross-origin request` and breaks HMR.
  allowedDevOrigins: ["192.168.88.43"],
  images: {
    unoptimized: true
  },
  transpilePackages: [
    "@mysten/dapp-kit",
    "@mysten/sui.js",
    "@mysten/wallet-standard",
    "@suiware/kit",
    "@radix-ui/themes",
    "@radix-ui/react-select",
    "@radix-ui/react-toggle",
    "@sui-amm/tooling-core",
    "@sui-amm/domain-core"
  ],
  turbopack: {
    resolveExtensions: [".mdx", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"]
  },
  webpack: (config) => {
    config.externals = [...(config.externals || []), "encoding"]
    return config
  }
}

export default nextConfig
