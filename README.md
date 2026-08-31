# Condition – Privacy-Preserving Parametric Insurance on Midnight

**Status:** Wave 1 complete — full loop implemented, 146 tests green, frontend builds.

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
- **Testing:** Vitest (146 tests incl. adversarial privacy suite)
- **Hashing:** Hand-rolled SHA-256, pinned to NIST FIPS 180-4 vectors, zero runtime deps

### Why two layers?

The Compact compiler is a native OCaml binary (glibc platforms). This repo is developed on Android/Termux, so it ships the canonical Compact sources **plus** a TypeScript reference runtime that implements the identical state machine, hash schemes, and privacy boundary. The test suite drives the reference runtime; `npm run build:contracts` compiles the real contracts wherever the toolchain exists. `tests/compactParity.test.ts` pins the digests both layers must reproduce.

---

## Quick Start

```bash
npm install        # deps + android swc shim (no-op elsewhere)
npm test           # 146 tests: policy, trigger, claim, settlement, zk, privacy, parity
npm run build      # typecheck + compile TS + contracts (if toolchain present)
npm run build:frontend
npm run dev        # http://localhost:3000
```

Then in the browser:
1. `/policy` — create + fund a policy (public)
2. `/claim` — enroll, record a 2-source trigger, generate the proof client-side, settle
3. `/receipt` — browse + verify public receipts

`npm run deploy` runs a full-loop dry-run against the reference runtime on any platform (writes `deploy/deployments.json`).

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
│   ├── compactParity.test.ts    # NIST vectors + golden digest pins
│   ├── policy / trigger / claim / settlement / zk
│   └── helpers.ts               # fullFlow() fixture
│
├── deploy/deploy.ts             # Reference dry-run / testnet deploy entry
└── scripts/                     # build-contracts, postinstall (android swc shim), gen-vectors
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
npm test                                 # full suite (146 tests)
npx vitest run tests/privacy.test.ts     # just the invariant suite
```

Covers: policy lifecycle, trigger semantics + conflicts, claim windows, proof
generation/tampering, double-claims, funding guards, DENIED paths, finality,
atomicity, and the six privacy invariants.

---

## Deployment

```bash
npm run deploy
```

On platforms with the Compact toolchain: compiles contracts, deploys to testnet
(`MIDNIGHT_NODE_URL`). Elsewhere: runs the full Wave 1 loop against the
reference runtime as a dry-run and records the result. Secrets are read only
from `process.env` — never committed.

---

## Key Files to Read

- `BUILD_SPEC.md` — complete protocol spec (start here)
- `tests/privacy.test.ts` — the thesis, mechanically enforced
- `src/core/hashing.ts` — domain-separated digest scheme
- `contracts/settlement.compact` — the private settlement circuit
- `docs/MIDNIGHT_NOTES.md` — platform + toolchain reality

---

**Built for Midnight Buildathon 2026 — Privacy Track**
