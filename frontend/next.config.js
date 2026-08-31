/** @type {import('next').NextConfig} */
const isAndroidArm64 = process.platform === 'android' && process.arch === 'arm64';

const nextConfig = {
  reactStrictMode: true,
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
