/** @type {import('next').NextConfig} */
const isAndroidArm64 = process.platform === 'android' && process.arch === 'arm64';

// Preprod endpoint vars — inlined into the browser bundle at build time so
// ConditionProvider/preprodRuntime can read them without a runtime .env.
// Each can be overridden at build time (shell env or frontend/.env*.local);
// the defaults mirror PREPROD_ENDPOINTS in src/utils/preprodRuntime.ts
// (Midnight Preprod, indexer API v3 — the surface this repo's SDK
// generation is verified against; see docs/DEPLOYMENTS.md).
// NEXT_PREPROD_PROVER is deliberately absent: the loopback proof server is
// CLI-only configuration. Browser proving is wallet-delegated (DApp
// Connector), and inlining the 127.0.0.1 URL into a public bundle only
// invites a private-network fetch — the thing that raises Chrome's Local
// Network Access permission prompt. MIDNIGHT_WALLET_SEED is absent too —
// it is server/CLI-only and must never be inlined into the client bundle.
const PREPROD_ENDPOINT_DEFAULTS = {
  NEXT_PUBLIC_MIDNIGHT_INDEXER: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  NEXT_PUBLIC_MIDNIGHT_INDEXER_WS: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  NEXT_PREPROD_NODE: 'https://rpc.preprod.midnight.network',
  NEXT_PUBLIC_MIDNIGHT_NETWORK: 'Preprod',
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
  // /verify and /explorer decode on-chain contract state with the compiled
  // contract artifacts (@midnight-ntwrk/compact-runtime over the
  // onchain-runtime-v3 wasm). webpack's wasm parser cannot handle that
  // binary, so it is emitted as an asset and instantiated with the platform
  // WebAssembly API by frontend/src/utils/onchainRuntimeShim.js (aliased in
  // below). The chunk loads only on those routes (dynamic import inside
  // src/utils/publicChain.ts).
  webpack: (config) => {
    config.resolve.alias['@midnight-ntwrk/onchain-runtime-v3'] = require('node:path').resolve(
      __dirname,
      'src/utils/onchainRuntimeShim.js',
    );
    // isomorphic-ws' browser build has no named `WebSocket` export, which is
    // the binding the indexer provider uses as its subscription transport.
    config.resolve.alias['isomorphic-ws'] = require('node:path').resolve(
      __dirname,
      'src/utils/browserWebSocket.js',
    );
    // The DApp Connector stack needs ledger-v8 in the browser (transaction
    // serialize/deserialize, cost model). Its browser entry is wasm-bindgen's
    // bundler target — `import * as wasm from './x.wasm'` — and webpack's wasm
    // parser rejects that binary, so the package is routed through the same
    // asset + platform-WebAssembly treatment as the onchain runtime above.
    // The generated snippets resolve their self-reference (`#self`, which the
    // package maps to its browser entry) to the generated bg module, which is
    // what they actually read; onchain-runtime-v3 declares `#self` too but no
    // file imports it, so this stays ledger-only in practice.
    config.resolve.alias['@midnight-ntwrk/ledger-v8'] = require('node:path').resolve(
      __dirname,
      'src/utils/ledgerWasmShim.js',
    );
    config.resolve.alias['#self'] = require('node:path').resolve(
      __dirname,
      '../node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_bg.js',
    );
    config.module.rules.push({
      test: /midnight_onchain_runtime_wasm_bg\.wasm$/,
      type: 'asset/resource',
    });
    config.module.rules.push({
      test: /midnight_ledger_wasm_bg\.wasm$/,
      type: 'asset/resource',
    });
    return config;
  },
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
