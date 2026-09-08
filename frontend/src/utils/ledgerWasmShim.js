// Browser shim for @midnight-ntwrk/ledger-v8 (wired via a next.config.js
// resolve alias — never imported directly).
//
// Why this exists: the package's browser entry is wasm-bindgen's bundler
// target — `import * as wasm from './midnight_ledger_wasm_bg.wasm'` — and
// webpack's wasm parser rejects this binary ("parseVec could not cast the
// value"), so the direct route cannot build. The package's own Node entry
// (midnight_ledger_wasm_fs.js) shows the working shape: build the imports
// map (the generated bg module + the 24 inline JS snippets the binary
// declares), instantiate with the platform WebAssembly API, hand the exports
// to `__wbg_set_wasm`, then `__wbindgen_start`. This shim does exactly that
// in the browser:
//
//   1. next.config.js marks the .wasm as `asset/resource` (emitted file, no
//      wasm parsing) and aliases the package to this module.
//   2. Importing the asset yields its URL; ensureLedger() fetches the bytes
//      and instantiates them with the imports map below.
//   3. Everything the bg module exports is re-exported, so code importing
//      the package (laceConnector, midnight-js-contracts via protocol) sees
//      the same surface as in Node.
//
// laceConnector awaits ensureLedger() before the first ledger call; the
// eager kick below just warms the fetch in parallel with route code. The
// Node build exports no ensureLedger, so that await is a browser-only
// no-op elsewhere.
//
// GENERATED-BY-HAND NOTE: the snippet list mirrors
// node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_fs.js; if the
// package is upgraded and its snippet set changes, regenerate this file.

import * as bg from '../../../node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_bg.js';
import wasmUrl from '../../../node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_bg.wasm';
import * as inline0 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline0.js';
import * as inline1 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline1.js';
import * as inline2 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline2.js';
import * as inline3 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline3.js';
import * as inline4 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline4.js';
import * as inline5 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline5.js';
import * as inline6 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline6.js';
import * as inline7 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline7.js';
import * as inline8 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline8.js';
import * as inline9 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline9.js';
import * as inline10 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline10.js';
import * as inline11 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline11.js';
import * as inline12 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline12.js';
import * as inline13 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline13.js';
import * as inline14 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline14.js';
import * as inline15 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline15.js';
import * as inline16 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline16.js';
import * as inline17 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline17.js';
import * as inline18 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline18.js';
import * as inline19 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline19.js';
import * as inline20 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline20.js';
import * as inline21 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline21.js';
import * as inline22 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline22.js';
import * as inline23 from '../../../node_modules/@midnight-ntwrk/ledger-v8/snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline23.js';

const imports = {
  './midnight_ledger_wasm_bg.js': bg,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline0.js': inline0,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline1.js': inline1,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline2.js': inline2,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline3.js': inline3,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline4.js': inline4,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline5.js': inline5,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline6.js': inline6,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline7.js': inline7,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline8.js': inline8,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline9.js': inline9,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline10.js': inline10,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline11.js': inline11,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline12.js': inline12,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline13.js': inline13,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline14.js': inline14,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline15.js': inline15,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline16.js': inline16,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline17.js': inline17,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline18.js': inline18,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline19.js': inline19,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline20.js': inline20,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline21.js': inline21,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline22.js': inline22,
  './snippets/midnight-ledger-wasm-9f71df61dc0427fb/inline23.js': inline23,
};

let readyPromise = null;

export function ensureLedger() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const bytes = await (await fetch(wasmUrl)).arrayBuffer();
      const instance = (await WebAssembly.instantiate(bytes, imports)).instance;
      bg.__wbg_set_wasm(instance.exports);
      if (typeof instance.exports.__wbindgen_start === 'function') {
        instance.exports.__wbindgen_start();
      }
    })();
  }
  return readyPromise;
}

void ensureLedger();

export * from '../../../node_modules/@midnight-ntwrk/ledger-v8/midnight_ledger_wasm_bg.js';
