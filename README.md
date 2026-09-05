# Condition – Privacy-Preserving Parametric Insurance on Midnight

**Status:** Deployed on Midnight Preprod (policy + settlement contracts live, both txs `SUCCESS`). 156 tests green, live two-layer lifecycle demo (CLI), full cross-layer digest parity. Real on-chain writes run via the CLI — see [What runs where](#what-runs-where-browser-vs-cli).

## What is Condition?

Condition is a parametric insurance protocol where policies are transparent, claims settle privately, and fairness is proven publicly without revealing claimant identity.

```
Policy Created → Funded → Holder Enrolls (commitment only) → Trigger Cross-Verified (2 sources, public)
  → Claim Submitted (private) → Proof Generated (client-side ZK) → Settlement Executed (private)
  → Proof Receipt Published (public: proof hash + status — no amounts, no identities)
```

**Core thesis:** prove settlement fairness without revealing who claimed.

---

## The Problem

Traditional parametric insurance (e.g., Etherisc):
- ✅ Fast automatic payouts when triggers activate
- ✅ Clear, transparent trigger conditions
- ❌ Everything is public — privacy violation for claimants

Web2 insurance:
- ✅ Privacy (your claim is private)
- ❌ You have to trust the company
- ❌ No proof of fair settlement

**Condition solves this:** ZK proofs prove settlement is fair without revealing who claimed.

---

## How It Works

| Layer | Contents | Visibility |
|-------|----------|------------|
| **Public Ledger** | Policies, terms, escrow totals, trigger events, nullifiers, proof receipts | Everyone |
| **Private Ledger** | Holder secret, settlement amounts, shielded balances | Only the claimant |
| **ZK Proofs** | Eligibility + nullifier + payout binding; witness never revealed | Proof hash only |

**Claim flow:**
1. Insurer creates a policy — terms are public and immutable
2. Holder enrolls locally — only `H(policyId, secret)` is published
3. Trigger fires — two independent sources must agree (fail-closed)
4. Holder claims — proof generated **in their browser**: "I hold the secret for this policy's commitment; the nullifier is fresh; the payout matches the deterministic terms"
5. Settlement publishes a receipt — proof hash + status + timestamp, nothing else
6. Anyone verifies the receipt from public data alone

**The payout is deterministic from public terms** — nobody, not even the claimant, chooses the amount. The proof binds the holder to exactly that amount via a commitment, so receipts never need to reveal it.

---

## Tech Stack

- **Contracts:** Midnight Compact (`contracts/*.compact`, language_version 0.16–0.22)
- **Reference runtime:** TypeScript (`src/core` + `src/services`) — the executable spec
- **Frontend:** Next.js 14 (Pages Router), React 18
- **ZK proofs:** Client-side generation (browser, in-process; zero API routes)
- **Testing:** Vitest (156 tests incl. adversarial privacy suite)
- **Hashing:** Hand-rolled SHA-256, pinned to NIST FIPS 180-4 vectors, zero runtime deps

### Why two layers?

The canonical Compact sources are the deployed truth; the TypeScript reference runtime is the executable specification used by the frontend and the test suite. **The two layers are proven identical**: `tests/twoLayerParity.test.ts` runs the complete lifecycle on BOTH the TS reference runtime AND the real compiled Compact circuits executing on the real `@midnight-ntwrk/compact-runtime`, asserting byte-identical digests at every stage — policyId, termsDigest, enrollment commitment, nullifier, statement, proof hash, and settlement receipt id.

`npm run build:contracts` compiles the real contracts with compactc 0.30.0 (works on Android/Termux via proot, and on any glibc/macOS host). Circuit identities (sha256 of each verifier key + zkir) are recorded in `deploy/artifacts.json`.

---

## Live End-to-End Proof (CLI demo)

```bash
npx tsx scripts/demo-lifecycle.ts
```

**This is a local CLI demo** — the compiled circuits execute on the real `@midnight-ntwrk/compact-runtime` on your machine, not on the Preprod network and not in a browser. The actual Preprod deployment (contract addresses, tx hashes) is recorded under [Deployment](#deployment); the browser experience is mapped in [What runs where](#what-runs-where-browser-vs-cli).

Runs the full claim state machine on both layers with per-stage parity checks and live output:

```
policy ACTIVE → claim SUBMITTED → ZK VERIFIED → settlement EXECUTED → payout CONFIRMED (PAID)
```

Every stage shows the real compiled circuit executing on the real Midnight runtime (`create()`, `fund()`, `enroll()`, `record_trigger()`, `link()`, `settle()`) and asserts the digest it produced equals the TS reference runtime's — including the receipt id and the on-chain proof hash. A double-claim attempt against the same nullifier is rejected live. `--json` emits machine-readable output.

---

## Quick Start

```bash
npm install        # deps + android swc shim (no-op elsewhere)
npm test           # 156 tests: policy, trigger, claim, settlement, zk, privacy, parity, two-layer, fail-loud, frontend
npm run build      # typecheck + compile TS + contracts (compactc, incl. Termux via proot)
npm run build:frontend
npx tsx scripts/demo-lifecycle.ts   # live two-layer lifecycle demo
npm run dev        # http://localhost:3000
```

Then in the browser:
1. `/policy` — create + fund a policy (public)
2. `/claim` — enroll, record a 2-source trigger, generate the proof client-side, settle
3. `/receipt` — browse + verify public receipts

These pages run the protocol client-side. Without a connected wallet they operate on the LOCAL DEV reference runtime (an explicit opt-in); connecting a Midnight wallet in the browser is detected where implemented but does not yet submit transactions — see [What runs where](#what-runs-where-browser-vs-cli).

`npm run deploy` performs a real Preprod deployment (Midnight wallet-sdk facade stack: unshielded + bootstrapped dust wallets → `deployContract`), recording contract addresses and tx hashes. When Midnight endpoints are unreachable (e.g. this build environment's network), it falls back to local real-runtime verification of the same compiled contracts and records the honest blocker with evidence. Every run writes `deploy/deployments.json`; circuit identities live in `deploy/artifacts.json`. Secrets are read only from `process.env` — never committed.

### What runs where: browser vs CLI

The "live end-to-end" capabilities in this README are CLI capabilities. The deployed frontend (Vercel) showcases the protocol — pages, client-side proof generation, receipt verification, and the LOCAL DEV reference loop — but does not execute real Preprod writes from a visitor's browser:

| Capability | Where it runs |
|------------|---------------|
| Real Preprod contract deployment + on-chain lifecycle (`create → fund → enroll → record_trigger → link → settle`) | **CLI only** — `npm run deploy`, `scripts/e2e-preprod.ts` (seed-backed provider stack on the developer's machine) |
| Live two-layer lifecycle demo (compiled circuits on the real compact-runtime, both layers in lockstep) | **CLI only** — `npx tsx scripts/demo-lifecycle.ts` (local execution, not the Preprod network) |
| Deployed frontend (Vercel) — pages, client-side proof generation, receipt verification, LOCAL DEV reference loop | **Browser** |
| Midnight wallet detection (Lace) in the browser | **Browser** — the frontend detects/connects the supported wallet path where implemented, but connecting a wallet is **not** browser transaction submission: on-chain writes are not wired in the browser and fail loud (explicit error) rather than simulate |
| Proof server (`http://127.0.0.1:6300`) | **Developer-local only** — required by the CLI deployer/e2e for contract proving. There is no hosted Preprod prover, a Vercel visitor cannot reach the developer's localhost, and the deployed frontend neither uses nor depends on it |

---

## Project Structure

```
condition/
├── AGENTS.md                    # Agent operational contract
├── BUILD_SPEC.md                # Complete technical spec (source of truth)
├── README.md                    # This file
│
├── contracts/                   # Canonical Compact sources (compile on glibc)
│   ├── policy.compact           # Policy lifecycle, escrow, enrollment commitment
│   ├── settlement.compact       # Nullifier registry, private settle circuit, receipts
│   └── proofs.compact           # ZK circuit library (digests, payout function)
│
├── src/
│   ├── core/                    # Reference runtime core
│   │   ├── sha256.ts            # FIPS 180-4, NIST-pinned, zero deps
│   │   ├── hashing.ts           # Domain-separated digests (the privacy boundary primitive)
│   │   ├── zkProver.ts          # Client-side proof generation/verification
│   │   ├── payout.ts            # Deterministic payout function
│   │   ├── publicLedger.ts      # Public state machine + event trail
│   │   └── privateLedger.ts     # Holder secrets, shielded balances (claimant-side)
│   ├── services/                # Protocol flows (policy, trigger, claim, settlement)
│   ├── types/                   # Shared domain model + error catalog
│   └── utils/midnight.ts        # Runtime context factory
│
├── frontend/                    # Next.js Pages Router (zero API routes by design)
│   ├── pages/                   # /, /policy, /claim, /receipt
│   └── src/components/          # ConditionProvider (in-browser runtime context)
│
├── tests/                       # Vitest suites (BUILD_SPEC §9)
│   ├── privacy.test.ts          # ⭐ adversarial invariant enforcement
│   ├── twoLayerParity.test.ts   # ⭐ compiled circuits vs TS runtime, digest-identical
│   ├── compactParity.test.ts    # NIST vectors + golden digest pins
│   ├── policy / trigger / claim / settlement / zk
│   └── helpers.ts               # fullFlow() fixture
│
├── deploy/deploy.ts             # Preprod deploy (midnight-js) / local real-runtime verification
├── deploy/artifacts.json        # Circuit identities (verifier key + zkir hashes) — committed
└── scripts/                     # build-contracts, demo-lifecycle, gen-artifacts, postinstall, gen-vectors
```

---

## Privacy Invariants (mechanically enforced)

`tests/privacy.test.ts` serializes everything an outside observer can ever see and fails if any private field, value, or derivation appears:

1. **Privacy boundary** — public ledger holds only allow-listed data; the holder secret never appears in any representation
2. **ZK proof correctness** — proofs carry public inputs + digests only; witness never serialized, logged, or transmitted
3. **Public receipt auditability** — receipts verifiable from public data alone; structurally amount-free
4. **Settlement finality** — published receipts immutable; event trail append-only; failed settles revert atomically
5. **Policy transparency** — full terms reconstructible from public events
6. **No private data in contracts** — claimant-derived values cross the boundary only as domain-separated digests

The suite is adversarial: forged proofs, wrong-secret griefing, nullifier replays, tampered statement/payout commitments, malicious single-oracle trigger attacks, linking attempts against the observer view.

---

## Wave Roadmap

### Wave 1 — Privacy + Fraud Prevention ✅ (this repo)
- Private claim submission, client-side ZK proof generation, public receipts
- 2-source trigger cross-verification (fail-closed)
- Nullifier double-claim protection, griefing resistance
- Full adversarial test suite; frontend demo

### Wave 2 — Verifiable Fairness + Audit Trail
- Basis-risk calculator, ZK dispute resolution, Merkle multi-holder, on-chain time quorum

### Wave 3 — Adoption + Compliance
- PWA, education dashboard, compliance receipts

Details: `docs/WAVES.md` · Spec: `BUILD_SPEC.md`

---

## Why Midnight?

| Feature | Benefit |
|---------|---------|
| Private + Public Ledger | Claims private, receipts public; clean split |
| Client-Side ZK | Proof generation local; no server sees the witness |
| Compact Language | Small auditable circuits; digests mirror across layers |
| Native Privacy | No external ZK libraries needed |

---

## Testing

```bash
npm test                                 # full suite (156 tests)
npx vitest run tests/privacy.test.ts     # just the invariant suite
npx vitest run tests/twoLayerParity.test.ts   # compiled-circuit vs reference parity
```

Covers: policy lifecycle, trigger semantics + conflicts, claim windows, proof
generation/tampering, double-claims, funding guards, DENIED paths, finality,
atomicity, and the six privacy invariants.

---

## Deployment

```bash
npm run deploy
```

Three tiers, best-first:

1. **Preprod** — needs `MIDNIGHT_NODE_URL` reachable + `MIDNIGHT_WALLET_SEED` (funded preprod seed, env-only), plus a local proof server (no hosted Preprod prover exists) at `MIDNIGHT_PROVER_URL` (default `http://127.0.0.1:6300`). Deploys the compiled contracts via the real Midnight wallet-sdk facade stack and records contract addresses + tx hashes.
2. **Local real-runtime** — when Midnight endpoints are unreachable, the same compiled contracts execute on the real `@midnight-ntwrk/compact-runtime` locally: full lifecycle, digest parity, recorded as evidence in `deploy/deployments.json`.
3. **Reference dry-run** — no compiled contracts: TS reference loop only.

### Live on Preprod (deployed 2026-09-03)

#### Contracts — view on the Midnight Preprod Explorer

| Contract | Explorer link |
|----------|---------------|
| **Policy** | [`cc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6`](https://preprod.midnightexplorer.com/contracts/0xcc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6) |
| **Settlement** | [`dd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360`](https://preprod.midnightexplorer.com/contracts/0xdd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360) |

Open either link to inspect the live contract on-chain — its state, deploy transaction, and circuit calls.

Deployment details:

| Contract | Address | Block | Tx hash |
|----------|---------|-------|---------|
| policy | `cc7f513d5aed49bd51b8836e000f0ab2250efc1c882a10a0bccaa21e9b268fe6` | 2394413 | `7697a8014f5484f44ea2abdeab89351800eef2ceaa24f579f6ab27bd7d681ff7` |
| settlement | `dd8174380525cb46b7691f7502850ce701bc5cd5b7f29f76f20e7f8f3d65c360` | 2394417 | `32da87265070a5dcf294c6cc40fa965d9138a3125f49eddaf2d004edffaf9c88` |

Both transactions `SUCCESS`, independently verified via the Preprod indexer (`contractAction` by address). Full evidence (blocks, indexer tx ids, re-verification commands, indexer v3/v4 rationale): **`docs/DEPLOYMENTS.md`**.

**Proof-server version requirement:** the local proof server must be **`midnightntwrk/proof-server:8.1.0`** — matching the ledger-v8 8.1.0 / wallet-sdk 3.0.0 line this repo uses. The 9.0.0-rc line produces DUST spend proofs the node rejects with `Custom error: 170` (InvalidDustSpendProof).

### Deploying the frontend (Vercel)

`vercel.json` at the repo root carries the full configuration. When importing the Git repository into Vercel, keep **Root Directory = repository root** (not `frontend/`) — the frontend imports shared protocol code from `../src` and the root owns `package.json` / `package-lock.json`. The pinned settings:

- **Build Command:** `npm run build:frontend` (never the root `npm run build` — that also compiles the Compact contracts, which a frontend deploy neither needs nor should run)
- **Output Directory:** `frontend/.next` (the Next.js builder looks for output at `entryPath + outputDirectory`; without this it would search for `<root>/.next` and fail)
- **Node.js version:** 22.x (`engines.node` in package.json; Vercel reads it automatically)
- **Environment variables:** none required — all public endpoint defaults are baked into `frontend/next.config.js`, and nothing secret is used browser-side. `MIDNIGHT_WALLET_SEED` is CLI-only and must never be added as a Vercel env var.

The browser bundle is audited to contain no Node-only Midnight packages, no wallet SDK internals, and no secrets.

**What a Vercel visitor can and cannot do:** the frontend detects and connects the supported Midnight wallet path where implemented (Lace), but wallet connection is not browser transaction submission — on-chain writes are not wired in the browser and fail loud (explicit error) rather than simulate. The live on-chain path runs through the CLI (`npm run deploy`, `scripts/e2e-preprod.ts`), where the seed-backed provider stack executes locally on the developer's machine. Likewise, the proof server at `http://127.0.0.1:6300` is the developer's local server — there is no hosted Preprod prover, a Vercel visitor cannot reach the developer's localhost, and the deployed frontend neither uses nor depends on it (its endpoint status honestly reports the prober as unreachable rather than implying it is usable).

---

## Key Files to Read

- `BUILD_SPEC.md` — complete protocol spec (start here)
- `tests/privacy.test.ts` — the thesis, mechanically enforced
- `tests/twoLayerParity.test.ts` — compiled circuits == reference runtime, proven
- `scripts/demo-lifecycle.ts` — the live two-layer lifecycle demo
- `src/core/hashing.ts` — domain-separated digest scheme
- `contracts/settlement.compact` — the private settlement circuit
- `docs/MIDNIGHT_NOTES.md` — platform + toolchain reality

---

**Built for Midnight Buildathon 2026 — Privacy Track**
