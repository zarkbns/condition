/** @type {import('next').NextConfig} */
const isAndroidArm64 = process.platform === 'android' && process.arch === 'arm64';

// Preprod endpoint vars — inlined into the browser bundle at build time so
// ConditionProvider/preprodRuntime can read them without a runtime .env.
// Each can be overridden at build time (shell env or frontend/.env*.local);
// the defaults mirror PREPROD_ENDPOINTS in src/utils/preprodRuntime.ts
// (Midnight testnet-02). MIDNIGHT_WALLET_SEED is deliberately absent — it is
// server/CLI-only and must never be inlined into the client bundle.
const PREPROD_ENDPOINT_DEFAULTS = {
  NEXT_PUBLIC_MIDNIGHT_INDEXER: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  NEXT_PUBLIC_MIDNIGHT_INDEXER_WS: 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  NEXT_PREPROD_PROVER: 'https://prover.testnet-02.midnight.network',
  NEXT_PREPROD_NODE: 'https://rpc.testnet-02.midnight.network',
  NEXT_PUBLIC_MIDNIGHT_NETWORK: 'Preprod TestNet',
};

const preprodEnv = Object.fromEntries(
  Object.entries(PREPROD_ENDPOINT_DEFAULTS).map(([key, fallback]) => [
    key,
    process.env[key] ?? fallback,
  ]),
);

const nextConfig = {
  reactStrictMode: true,
  // Preprod endpoints for the dual-mode runtime (see src/utils/preprodRuntime.ts).
  env: preprodEnv,
  // Android/Termux (aarch64-linux-android) has no native SWC binary on npm;
  // scripts/postinstall.mjs shims @next/swc-android-arm64 to the wasm build.
  // The wasm minifier throws on the options Next passes, so fall back to
  // Terser for minification there. On other platforms everything is native.
  ...(isAndroidArm64 ? { swcMinify: false } : {}),
  experimental: {
    useWasmBinary: true,
    // The protocol core lives in ../src (outside this frontend dir) and is
    // imported directly so the browser bundles the exact reference runtime.
    externalDir: true,
    // The core uses NodeNext-style .js specifiers that resolve to .ts files.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  // The reference runtime is browser-first: proof generation MUST run
  // client-side (BUILD_SPEC §10, Invariant 2), so no server-side bundling of
  // protocol state is ever needed.
};

module.exports = nextConfig;
