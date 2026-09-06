# Deployments

Durable record of Condition's network deployments and how to re-verify them.
`deploy/deployments.json` is a per-run log written by `npm run deploy` — it is
gitignored and overwritten each run; this file is the committed evidence.

## Midnight Preprod — full on-chain lifecycle (2026-09-05)

The complete parametric-insurance loop executed live on Preprod through the
same runtime the frontend drives (`PreprodConditionRuntime` over the facade
stack), split across three processes for the memory-constrained dev host
(`scripts/e2e-preprod.ts --stage=public|claim|settle`). Every transaction
below returned `SUCCESS` (verifiable via the indexer v3 block queries shown
at the end). The claim proof was generated client-side; the settle circuit
consumed the holder secret via in-process witnesses only.

| # | Step | Contract | Block | Time (UTC) | Tx hash |
|---|------|---------|-------|------------|---------|
| 1 | PolicyContract deploy | `00147690…d08a01` | 2421479 | 20:51:12 | `cee2633c1808f1530c770b48be3e4f3c22da36ca9396df54312501307388aa08` |
| 2 | `create()` | `00147690…d08a01` | 2421490 | 20:52:18 | `2662db289b7c7bc92fd0ef75041c15e88105971eea12cebf237ba96989871349` |
| 3 | `fund()` (5,000,000,000 escrow) | `00147690…d08a01` | 2421495 | 20:52:48 | `c71b7d1c68e663076c3d92bf8ddd0913f25f0994844dcd5b3b7c8a206cb4eeb5` |
| 4 | `enroll()` — commitment only | `00147690…d08a01` | 2421514 | 20:54:42 | `80229a2cee27be6664471c75547ff956277b2ce0c7dd0bb031d6c66d52337591` |
| 5 | `record_trigger()` — 2 sources agree (observed 3600 ≥ 3500) | `00147690…d08a01` | 2421519 | 20:55:12 | `0d0b5c726ac4eac07381fa4f7df152ce9047b2420f6a0665ea3d8a2e269fab4b` |
| 6 | SettlementContract deploy | `90f1d7ae…2a8297c` | 2421538 | 20:57:06 | `fe33fce466b6222e08c2ebebcac0a6349fb61887ce42af74e0f672f84f2b474a` |
| 7 | `link()` — public policy facts | `90f1d7ae…2a8297c` | 2421543 | 20:57:36 | `200cb2af50114a331e2d981badbe430785f6334f5f4845e1550d12151fc99a9f` |
| 8 | `settle()` — private circuit, public receipt | `90f1d7ae…2a8297c` | 2421557 | 20:59:00 | `e1038fdba8279698c2ccb7ebbc1ba1da62131c93c23c412ffbc2657b6b314aad` |

Policy: id `0xc78d5715f8befa155b0e793fedf1fa333a2433a18a1366fb5b03a7e0dea78361`,
termsDigest `0x86a3f5181ffe5cc8ea50f8f9a9a7fd9f606beb66f6987d53b1a4e66877d5479b`
(TEMPERATURE ≥ 3500, payout 5,000,000,000, premium 100,000,000, 30-day cover).

Private side (client-side only, never on-chain): enrollment commitment
`0xca766b24ea78c82559fe055fce6dbe7dc9bb2e864d2e96481c5a46de3c576ab1`,
claim nullifier `0xae4391b32109f936cb4bb6dd9ea404b2289f8509c9092cb57dce4260265a8d1b`,
proof hash `0xf3c106f1e21ce7a5a020f839db66a0d98a7b2627ee06730121e216baf508efe5`.

Public receipt: id `0x20acedd59572ddc0b582bffcf236e43c414e005609bbef200a1ebf95998608a2`,
status `SETTLED` — deterministic from public data
(`receiptIdDigest(policyId, proofHash, outcome, settled, timestamp)`), so
anyone can recompute it and match the on-chain settle circuit's output.

Browse the same two contracts on the
[Midnight Preprod Explorer](https://preprod.midnightexplorer.com):
[policy `00147690…d08a01`](https://preprod.midnightexplorer.com/contracts/0x00147690d83e6501e237774fbd934956253032010e3a7e3258e1c162f4d08a01)
·
[settlement `90f1d7ae…2a8297c`](https://preprod.midnightexplorer.com/contracts/0x90f1d7ae19bdb9c531b003d95fd35ef4c507050390ad31e4289d172d72a8297c)

Re-verify any step (indexer v3; `transactions`/`block` queries — the
`contractAction(address)` lookup can return null for recent contracts):

```bash
curl -sS -X POST https://indexer.preprod.midnight.network/api/v3/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{block(offset:{height:2421557}){height timestamp transactions{hash contractActions{address} ... on RegularTransaction{transactionResult{status}}}}}"}'
# → the settle tx e1038fdb…b314aad on contract 90f1d7ae…, transactionResult status SUCCESS
```

## Midnight Preprod — contract deployments (2026-09-03)

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

Explorer:
[policy `cc7f513d…268fe6`](https://preprod.midnightexplorer.com/contracts/0xcc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6)
·
[settlement `dd817438…d65c360`](https://preprod.midnightexplorer.com/contracts/0xdd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360)

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
