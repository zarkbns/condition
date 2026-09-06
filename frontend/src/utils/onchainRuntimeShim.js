// Browser shim for @midnight-ntwrk/onchain-runtime-v3 (wired via a
// next.config.js resolve alias — never imported directly).
//
// Why this exists: the package's browser entry is wasm-bindgen's
// synchronous "web" target — `import * as wasm from './x.wasm'` — which
// webpack must parse as WebAssembly. webpack's wasm parser rejects this
// 1.4MB binary ("parseVec could not cast the value"), so the direct route
// cannot build. The package's own Node entry (midnight_onchain_runtime_wasm_fs.js)
// shows the correct shape: instantiate the binary with the platform
// WebAssembly API, hand the exports object to `__wbg_set_wasm`, then call
// `__wbindgen_start`. This shim does exactly that in the browser:
//
//   1. next.config.js marks the .wasm as `asset/resource` (emitted file,
//      no wasm parsing) and aliases the package to this module.
//   2. Importing the asset yields its URL; ensureRuntime() fetches the
//      bytes and instantiates them with the imports the binary declares
//      (all from the generated bg module — verified against the binary's
//      own import section).
//   3. Everything the bg module exports is re-exported, so code importing
//      the package (compact-runtime) sees the same surface as in Node.
//
// publicChain awaits ensureRuntime() before the first decode call; the
// eager kick below just warms the fetch in parallel with route code.

import * as bg from '../../../node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.js';
import wasmUrl from '../../../node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm';

let readyPromise = null;

export function ensureRuntime() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const bytes = await (await fetch(wasmUrl)).arrayBuffer();
      const instance = (
        await WebAssembly.instantiate(bytes, {
          './midnight_onchain_runtime_wasm_bg.js': bg,
        })
      ).instance;
      bg.__wbg_set_wasm(instance.exports);
      if (typeof instance.exports.__wbindgen_start === 'function') {
        instance.exports.__wbindgen_start();
      }
    })();
  }
  return readyPromise;
}

void ensureRuntime();

export * from '../../../node_modules/@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.js';
