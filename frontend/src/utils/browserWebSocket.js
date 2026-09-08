// Browser shim for isomorphic-ws (wired via a next.config.js resolve alias —
// never imported directly).
//
// Why this exists: isomorphic-ws@5's browser build exposes the platform
// WebSocket as a `default` export ONLY, but
// @midnight-ntwrk/midnight-js-indexer-public-data-provider does
// `import * as ws from 'isomorphic-ws'` and reads the NAMED binding
// `ws.WebSocket` as its default subscription transport. Bundled for the
// browser that named binding is undefined, so `watchForTxData` — the
// confirmation step of every on-chain write — would silently never open a
// socket. Under Node the package resolves to `ws`, where the named export
// exists, which is why only the browser path is affected.
//
// This shim provides both shapes, backed by the platform WebSocket.
const Impl = globalThis.WebSocket ?? globalThis.MozWebSocket;

export const WebSocket = Impl;
export default Impl;
