# contracts/managed-compact — committed compiled contract modules

Compiler outputs of `compactc` for the three public Compact sources
(`../policy.compact`, `../settlement.compact`, `../proofs.compact`):

    <name>/contract/index.js     compiled contract API — ledger decoder,
                                 circuits, pure circuits, Contract class
    <name>/contract/index.d.ts   type declarations for the above

Only the `contract/` modules are committed. The heavy artifacts (proving and
verifying keys, zkIR) are NOT here — the browser-facing copies of those live
committed under `frontend/public/contracts/<name>/{keys,zkir}` (served over
HTTP for the wallet's ZK config provider), while the full local layout —
including the uncompressed `.zkir` files the Node deployer needs — is the
gitignored build output `contracts/managed/<name>`.

## Why committed

`/verify` and `/explorer` decode on-chain public state with the authoritative
compiled `ledger()` decoder, and the browser wallet path loads the compiled
`Contract` class. That code must exist in a fresh clone / Vercel checkout,
where `contracts/managed` (gitignored build output) is absent — otherwise
`next build` fails to resolve the module and the public surfaces cannot
decode anything. Committing these modules keeps `contracts/managed` optional
for local development while making the decoder a build-time-resolvable,
always-present source: no fake modules, no webpack aliases hiding the
resolution.

These files are public by construction: they are deterministic compiler
output of the committed public `.compact` sources, contain no witness data
and no secrets, and `index.js` hard-checks the exact
`@midnight-ntwrk/compact-runtime` version it was compiled against
(`checkRuntimeVersion`), so a stale copy cannot silently mismatch the
runtime dependency.

## Refresh flow

`npm run build:contracts` regenerates `contracts/managed/`;
`npm run build:zk-artifacts` (also run by `build:frontend` and `dev`) copies
freshly compiled modules here when present and falls back to keeping these
committed copies otherwise. Runtime loading goes through
`src/utils/managedContracts.ts`, which prefers a freshly compiled local
`contracts/managed` module and falls back to the committed module here.
