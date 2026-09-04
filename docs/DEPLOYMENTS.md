# Deployments

Durable record of Condition's network deployments and how to re-verify them.
`deploy/deployments.json` is a per-run log written by `npm run deploy` — it is
gitignored and overwritten each run; this file is the committed evidence.

## Midnight Preprod — live

Deployed 2026-09-03 (23:45 UTC) via `npm run deploy` (tier `preprod`), using
the wallet-sdk facade stack (`@midnight-ntwrk/wallet-sdk-facade@3.0.0` →
`ledger-v8@8.1.0`, `wallet-sdk-indexer-client@1.2.x`) with a local
`midnightntwrk/proof-server:8.1.0`.

| Contract | Address | Deploy tx | Block | Indexer tx id |
|----------|---------|-----------|-------|---------------|
| policy | `cc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6` | `7697a8014f5484f44ea2abdeab89351800eef2ceaa24f579f6ab27bd7d681ff7` | 2394413 | 585725 |
| settlement | `dd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360` | `32da87265070a5dcf294c6cc40fa965d9138a3125f49eddaf2d004edffaf9c88` | 2394417 | 585726 |

Both deploy transactions returned `SUCCESS` and were confirmed on the indexer
via `contractAction` by contract address. Deployer wallet (unshielded):
`mn_addr_preprod1fd5srkfs…` — seed is env-only (`MIDNIGHT_WALLET_SEED`), never
committed.

### Re-verification

Anyone can re-confirm the contracts from public data alone (re-checked
2026-09-04):

```bash
curl -sS -X POST https://indexer.preprod.midnight.network/api/v3/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ contractAction(address: \"cc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6\") { ... on ContractDeploy { transaction { hash } } } }"}'
# → {"data":{"contractAction":{"transaction":{"hash":"7697a801…681ff7"}}}

curl -sS -X POST https://indexer.preprod.midnight.network/api/v3/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ contractAction(address: \"dd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360\") { ... on ContractDeploy { transaction { hash } } } }"}'
# → {"data":{"contractAction":{"transaction":{"hash":"32da8726…faf9c88"}}}
```

## Indexer API v3 vs v4

The indexer serves both `/api/v3` and `/api/v4` GraphQL surfaces, and both
currently accept the queries above. The **v3 requirement is a property of the
installed SDK generation, not of the network**:

- `@midnight-ntwrk/wallet-sdk-indexer-client@1.2.x` — pulled in by the whole
  wallet-sdk facade line (`wallet-sdk-facade@3.0.0`, `wallet-sdk-dust-wallet@3.0.0`,
  `wallet-sdk-shielded@2.1.0`, `wallet-sdk-unshielded-wallet@2.1.0`) — is
  generated against the v3-era schema.
- `@midnight-ntwrk/midnight-js-indexer-public-data-provider@4.1.1` (the
  midnight-js read provider) speaks the same v3-era surface.

The Preprod deploy pushed every wallet-stack query (dust tree collapse,
unshielded sync, tx recovery polling) through **v3** — that is the pairing
verified live end-to-end. Nothing in this repo has been verified against v4.
v3-vs-v4 schema deltas do exist (field changes between indexer generations),
so any stack upgrade that moves to v4 must be re-verified query-by-query.

Practical rule: **anything running on the current package set (wallet-sdk
facade 3.x / midnight-js 4.1.1) must use v3 indexer URLs.** The frontend
defaults and `src/utils/preprodRuntime.ts` are aligned to v3 for this reason.

## Re-deploying

```bash
MIDNIGHT_WALLET_SEED=<funded preprod seed> npm run deploy
```

Requirements:

- **Proof server 8.1.0** — must match the ledger-v8 8.1.0 / wallet-sdk 3.x
  line. The 9.0.0-rc line generates DUST spend proofs Preprod nodes reject
  with `Custom error: 170` (InvalidDustSpendProof).
- A funded Preprod seed (env-only). The deployer bootstraps the dust wallet
  on first run (cached locally in `deploy/dust-wallet-snapshot.json`,
  gitignored).
- Midnight network egress; when unreachable, the deployer falls back to local
  real-runtime verification of the same compiled contracts and records the
  honest blocker in `deploy/deployments.json`.
