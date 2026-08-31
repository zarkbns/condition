# BUILD_SPEC.md — Condition Technical Specification

**Version:** 1.0 (Wave 1 MVP)
**Status:** Implemented
**Primary audience:** engineers and auditors. This document is the source of truth for protocol behavior.

---

## 1. Overview

Condition is a privacy-preserving parametric insurance protocol on Midnight.

- **Policies are transparent:** trigger terms, payout schedule, and expiry are public and deterministic.
- **Claims settle privately:** claimant identity and claim amount never touch the public ledger.
- **Fairness is proven publicly:** every settlement publishes a receipt containing a ZK proof hash; anyone can verify settlement correctness without learning *who* claimed or *how much* was paid.

```
Policy Created → Funded → Holder Enrolls (commitment only) → Trigger Cross-Verified (public)
  → Claim Submitted (private, ZK) → Settlement Executed (private)
  → Proof Receipt Published (public: proof hash + status, no amounts, no identities)
```

### 1.1 Wave 1 scope

| In scope | Out of scope (Wave 2/3) |
|---|---|
| Single-holder policies (one enrolled claimant per policy) | Multi-holder enrollment sets (Merkle accumulator) |
| Binary trigger → full payout | Tiered/partial payouts, basis-risk calculator |
| 2-source trigger cross-verification | N-of-M oracle committees, on-chain time |
| Client-side proof generation & verification | Dispute resolution, batch analytics |
| Testnet deployment path | Mainnet, mobile native proofs |

---

## 2. Privacy Invariants (non-negotiable)

These six invariants govern every code path. `tests/privacy.test.ts` mechanically enforces the public-ledger ones.

1. **Privacy boundary** — claimant identity, claim secrets, and settlement amounts exist only on the private ledger. The public ledger contains: policy terms, funding totals, trigger events, nullifiers, proof hashes, receipt statuses, timestamps. Nothing else.
2. **ZK proof correctness** — proofs are generated client-side from private witnesses; the public ledger stores only the proof hash and public inputs. A proof asserts: (a) holder eligibility, (b) correct nullifier derivation, (c) correct deterministic payout given public terms.
3. **Public receipt auditability** — a receipt is verifiable by anyone using only public data: proof hash, policy terms, trigger outcome, status. No amounts. No identities.
4. **Settlement finality** — once a receipt is published, the settlement is irreversible. Refunds only via new policies or Wave 2 disputes.
5. **Policy transparency** — trigger type, operator, threshold, payout, coverage window are public at policy creation and immutable afterward.
6. **No private data in contracts** — settlement logic references proof hashes, commitment digests, and nullifiers — never claimant data.

### 2.1 What is deliberately public

| Public | Why it's safe |
|---|---|
| Policy terms | Transparency is the product. |
| Policy funding total | Aggregate escrow; no claimant linkage. |
| Trigger events (value, outcome, sources) | Verifiable fairness of trigger. |
| Enrollment commitment `H(secret, policyId)` | One-way; unlinkable to identity. |
| Nullifier `H(secret, policyId, tag)` | Prevents double-claims; unlinkable to commitment. |
| Proof hash, receipt status, receipt timestamp | Audit trail; no amounts, no identities. |

---

## 3. Architecture

```
┌────────────────────────────── Client (browser / trusted local runtime) ──────────────────────────────┐
│  policyService        claimService           settlementService         triggerService                │
│      │                     │                        │                       │                        │
│      │        ┌────────────┴────────────┐   ┌───────┴────────┐   ┌────────┴─────────┐               │
│      │        │  zkProver (client-side) │   │ receipt builder│   │ source registry  │               │
│      │        │  witness → proof        │   │ (public)       │   │ (cross-verify)   │               │
│      │        └─────────────────────────┘   └────────────────┘   └──────────────────┘               │
└──────────┬──────────────────┬───────────────────────┬──────────────────────┬─────────────────────────┘
           │ public ops       │ private ops (ZK)      │ public ops           │ public ops
┌──────────┴──────────────────┴───────────────────────┴──────────────────────┴─────────────────────────┐
│                                   Midnight network                                                   │
│   PUBLIC LEDGER:  policy.compact   settlement.compact (receipts, nullifiers, proof hashes)            │
│   PRIVATE LEDGER: claimant secrets, eligibility commitments, settlement amounts, shielded balances     │
│   ZK:             proofs verified via circuits; witness data never leaves the client                  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Component map

| Component | Location | Responsibility |
|---|---|---|
| Policy contract | `contracts/policy.compact` | Policy terms, escrow, enrollment commitment, trigger recording |
| Settlement contract | `contracts/settlement.compact` | Nullifier registry, proof-hash verification, receipts, payout authorization |
| Circuit library | `contracts/proofs.compact` | Canonical ZK statement definitions (eligibility, nullifier, payout) |
| Types | `src/types/index.ts` | Shared domain model (single source for TS side) |
| Hashing | `src/core/hashing.ts` | Domain-separated digests mirroring Compact circuits |
| ZK prover | `src/core/zkProver.ts` | Client-side proof generation/verification |
| Public ledger | `src/core/publicLedger.ts` | Reference implementation of public state + audit view |
| Private ledger | `src/core/privateLedger.ts` | Reference implementation of private state (claimant-side) |
| Services | `src/services/*.ts` | Protocol flows orchestrating ledgers + proofs |
| Midnight context | `src/utils/midnight.ts` | Runtime environment/config factory |

### 3.2 Reference runtime (why `src/core` exists)

The Midnight Compact compiler (`compact compile`) is a native OCaml binary distributed for glibc Linux/macOS/Windows. It does not run on Android/Termux (bionic libc). This repo therefore contains **two faithful layers**:

1. **`contracts/*.compact`** — canonical contract sources in Compact `language_version 0.16–0.22`, compilable with `compact compile` in a standard environment (`npm run build:contracts` auto-detects availability).
2. **`src/core` + `src/services`** — a TypeScript *reference runtime* that implements the identical state machine, the identical domain-separated hash schemes, and the identical privacy boundary. It is the executable specification used by the test suite, the frontend in dev mode, and CI on constrained platforms.

Every behavioral decision (state transitions, error conditions, privacy rules) is made once here and mirrored in both layers. When both layers can run, their digests must agree (see `tests/compactParity.test.ts`).

---

## 4. Domain Model

All byte values are 32-byte digests, hex-encoded. All integers are 64-bit. Amounts are in dust (1e-9 tDUST) as `bigint`. Times are Unix seconds.

```ts
enum PolicyStatus { ACTIVE, TRIGGERED, SETTLING, SETTLED, DENIED, EXPIRED, CLOSED }

interface PolicyTerms {
  triggerType: TriggerType;        // TEMPERATURE | RAINFALL_MM | FLIGHT_DELAY_MIN | EARTHQUAKE_MAG
  operator: ComparisonOp;          // GT | GTE | LT | LTE | EQ
  threshold: number;               // scaled x100 (e.g. 3500 = 35.00°C)
  payoutAmount: bigint;            // dust
  premium: bigint;                 // dust, collected at enrollment
  coverageStart: number;           // unix seconds
  expiry: number;                  // unix seconds, claims after this are rejected
}

interface Policy {
  policyId: Bytes32;
  insurer: Address;                // public
  terms: PolicyTerms;              // public (Invariant 5)
  termsDigest: Bytes32;            // H("condition:terms:v1", id, triggerType, op, threshold, payout, premium, start, expiry)
  status: PolicyStatus;            // public state machine
  fundedAmount: bigint;            // public escrow total
  enrollmentCommitment: Bytes32;   // public, H("condition:elig:v1", policyId, holderSecret)
  trigger: TriggerRecord | null;   // public once recorded
}

interface TriggerSourceReading { sourceId: Bytes32; value: number; }
interface TriggerRecord {
  readings: TriggerSourceReading[];  // ≥2 distinct sources required
  outcome: boolean;                  // operator(value, threshold) over cross-verified value
  observedValue: number;             // median of agreeing readings
  recordedAt: number;
}

interface ClaimWitness {            // NEVER leaves the client (Invariant 2)
  policyId: Bytes32;
  holderSecret: Bytes32;
  settlementAmount: bigint;
  triggerEvidence: TriggerRecord;   // private copy of trigger data used in proof
}

interface ClaimProof {              // public representation
  statement: Bytes32;               // digest of public inputs
  proofHash: Bytes32;               // H("condition:proof:v1", statement, witnessDigest)
  publicInputs: {
    policyId: Bytes32;
    termsDigest: Bytes32;
    nullifier: Bytes32;             // H("condition:null:v1", policyId, holderSecret)
    triggerOutcome: boolean;
    expectedPayoutCommitment: Bytes32; // H(payoutAmount) — hides amount, binds proof to it
  };
}

interface Receipt {                 // fully public (Invariant 3)
  receiptId: Bytes32;
  policyId: Bytes32;
  proofHash: Bytes32;
  triggerOutcome: boolean;
  status: 'SETTLED' | 'DENIED';
  timestamp: number;                // NO amount, NO claimant fields — enforced by tests
}
```

### 4.1 Policy lifecycle

```
ACTIVE ──funds──▶ ACTIVE(funded)
ACTIVE ──enroll──▶ ACTIVE(enrolled)          // commitment published, premium collected
ACTIVE ──trigger(2 sources)──▶ TRIGGERED
TRIGGERED ──claim──▶ SETTLING
SETTLING ──settle ok──▶ SETTLED              // payout released privately
SETTLING ──settle denied──▶ DENIED           // trigger false / outside window
any ──now > expiry──▶ EXPIRED                // lazily enforced, irreversible
SETTLED|DENIED|EXPIRED ──withdraw remainder──▶ CLOSED
```

Invalid transitions raise typed errors (see §8 error catalog).

---

## 5. ZK Proof Pipeline

### 5.1 Statement

For policy `P`, holder secret `s`, trigger record `T`, timestamp `now`:

> I know `s` such that
> 1. **Eligibility:** `H("condition:elig:v1", policyId, s) = P.enrollmentCommitment`
> 2. **Nullifier binding:** `nullifier = H("condition:null:v1", policyId, s)`
> 3. **Correct payout:** `amount = expectedPayout(P.terms, T.outcome, now ∈ [P.start, P.expiry])`
>    where `amount = T.outcome ∧ inWindow ? P.payoutAmount : 0`
> 4. **Amount binding:** `H(amount) = expectedPayoutCommitment`

Public outputs: `nullifier`, `expectedPayoutCommitment`, `proofHash`. The proof reveals nothing about `s` or `amount`.

### 5.2 Generation and verification

- **Generation:** client-side only — `src/core/zkProver.ts`. The witness (`ClaimWitness`) is held in memory during proof construction and never serialized, logged, or transmitted (Invariant 2).
- **Verification:** the settlement flow verifies (i) proof-hash recomputation from public inputs, (ii) eligibility binding against the policy's enrollment commitment, (iii) nullifier freshness, (iv) payout-commitment binding against the deterministic payout recomputed from **public** terms and trigger. On Midnight, (i)–(iv) are enforced by the circuits in `contracts/proofs.compact` / `settlement.compact`; the reference runtime enforces the same checks in TS.
- **On-chain footprint:** nullifier + proof hash + status only.

### 5.3 Double-claim protection

The nullifier is deterministic in `(policyId, holderSecret)`. A second claim with the same secret yields the same nullifier and is rejected by the nullifier registry (`used_nullifiers` / `spent_root` accumulator). A different secret for the same policy fails eligibility (Wave 1 single-holder; see §1.1).

### 5.4 Security assumptions

- Holder secret has ≥128 bits of entropy, generated locally (`crypto.getRandomValues`).
- Trigger data is cross-verified from ≥2 independent sources before outcome is recorded (§6).
- `now` is provided to settlement as a disclosed argument; for the MVP reference runtime it is taken from the caller clock and sanity-checked against policy expiry. Full on-chain time is a Wave 2 dependency (oracle time digest). This is a documented limitation, not a silent one.
- Proof generation runs in the claimant's client ("trusted local runtime"). No API ever receives the witness.

---

## 6. Trigger Cross-Verification

A trigger record is only accepted when **at least two distinct registered sources** report readings whose *outcome* (per the policy's operator/threshold) agrees. The recorded `observedValue` is the median of agreeing readings.

- Source registry: `triggerService` — sources are identified by `H("condition:source:v1", name)` and must be registered before use.
- Same-source duplicate readings are deduplicated by `sourceId`.
- Conflicting outcomes from different sources → trigger NOT recorded (fail-closed); the disagreement itself is public event data.

Fail-closed rationale: a malicious single oracle must not be able to either force or suppress a payout alone (AGENTS.md: never trust trigger data from a single source).

---

## 7. Contract Specifications

Compact sources live in `contracts/`. One contract instance per policy for both contracts (Compact ledgers hold primitive state; per-policy instances avoid unbounded state).

### 7.1 `policy.compact` — Policy

**Ledgers (public):** `insurer_key`, `terms_digest`, `trigger_type`, `operator`, `threshold`, `payout`, `premium`, `start`, `expiry`, `funded`, `enrollment_commitment`, `enrolled`, `trigger_fired`, `trigger_value`, `trigger_source1`, `trigger_source2`, `status`.

**Pure circuits:** `terms_digest(...)` — canonical terms hash (matches `termsDigest` in §4).

**Circuits:**
- `create(...)` — insurer initializes terms; status ACTIVE. Only once.
- `fund(amount)` — disclosed; adds to escrow.
- `enroll(commitment)` — publishes the holder's eligibility commitment (private input; only the commitment is disclosed). Requires premium paid into escrow. Single enrollment (Wave 1).
- `record_trigger(value, outcome, source_digest)` — two distinct source digests with agreeing outcome required; sets `trigger_fired`/`trigger_value`; transitions ACTIVE → TRIGGERED.
- `expected_payout(trigger_fired, in_window, payout)` — pure, deterministic payout function (§5.1 rule 3).
- `expire(now)` / `withdraw(now)` — expiry enforcement and insurer withdrawal of unclaimed escrow after settlement or expiry.

### 7.2 `settlement.compact` — Settlement

**Ledgers (public):** `policy_ref` (policy id + terms digest), `spent_root` (nullifier accumulator), `settled_count`, `denied_count`, `last_receipt_hash`, `last_status`, `last_timestamp`.

**Pure circuits:** `derive_eligibility(secret, policy_id)`, `derive_nullifier(secret, policy_id)`, `expected_payout(trigger_fired, in_window, payout)`, `receipt_digest(...)`.

**Circuits:**
- `link(policy_id, terms_digest, enrollment_commitment, payout, expiry, start, trigger_fired)` — binds a settlement instance to one policy (public).
- `settle(now, nullifier)` — the core private circuit:
  1. witness `holder_secret` → derive eligibility commitment, assert equals `enrollment_commitment` (ZK-enforced);
  2. derive nullifier, assert matches the submitted one and is not in `spent_root` (accumulator update);
  3. recompute payout from public terms + trigger (deterministic);
  4. emit receipt fields (disclosed): proof hash, status, timestamp. No amount is disclosed, ever.
- `counts()` view — settled/denied counts (public aggregate only).

### 7.3 `proofs.compact` — Circuit library

Canonical exported pure circuits shared as the ZK statement reference: `derive_eligibility`, `derive_nullifier`, `expected_payout`, `terms_digest`, `receipt_digest`. The settlement contract embeds the same circuits (Compact cross-file user-module imports are not relied on; embedding keeps each contract self-contained). Compiled with `compact compile`, this module yields the reference ZK keys for the statement definitions.

### 7.4 Events

Every state change emits a public event (Invariant: complete event trail):
`PolicyCreated, PolicyFunded, HolderEnrolled, TriggerRecorded, TriggerRejected, ClaimSettled, ClaimDenied, ReceiptPublished, PolicyExpired, PolicyClosed`.
In the reference runtime these are the public ledger's append-only event log; tests assert one event per transition.

---

## 8. Error Catalog

Typed errors thrown by services (mirrored as `assert(..., "msg")` failures in Compact):

| Code | Condition |
|---|---|
| `POLICY_NOT_FOUND` | Unknown policyId |
| `POLICY_INACTIVE` | Status not in the allowed set for the operation |
| `ALREADY_CREATED` | Double initialization of contract ledgers |
| `INSUFFICIENT_FUNDING` | Escrow < payout at settle time |
| `ALREADY_ENROLLED` | Second enrollment on a Wave 1 policy |
| `PREMIUM_REQUIRED` | Enrollment without premium funding |
| `NOT_ENROLLED` | Claim/settle on a policy with no enrollment |
| `TRIGGER_NOT_RECORDED` | Settle before cross-verified trigger |
| `TRIGGER_CONFLICT` | Sources disagree on outcome (fail-closed) |
| `TRIGGER_INSUFFICIENT_SOURCES` | <2 distinct sources |
| `INVALID_PROOF` | Proof hash/eligibility/payout-binding verification failed |
| `NULLIFIER_SPENT` | Double claim |
| `CLAIM_WINDOW_CLOSED` | `now` outside coverage window |
| `EXPIRY_REQUIRED` | Withdraw before expiry/settlement |

---

## 9. Testing Plan

Runner: **Vitest** (chosen once, recorded here and in `package.json`; matches the official Midnight sample toolchain and runs on constrained platforms). Suites:

| Suite | Asserts |
|---|---|
| `tests/policy.test.ts` | Creation, terms immutability, funding, enrollment + premium, expiry, invalid transitions |
| `tests/trigger.test.ts` | 2-source rule, conflict fail-closed, dedup, median, operator semantics |
| `tests/claim.test.ts` | Eligibility proof, nullifier determinism, wrong-secret rejection, window enforcement |
| `tests/settlement.test.ts` | Happy path, receipt publication, double-claim rejection, insufficient funding, DENIED path, finality (receipt immutable) |
| `tests/zk.test.ts` | Proof generation/verification round-trip, tampered/forged proof rejection, witness never serialized |
| `tests/privacy.test.ts` | **Invariant enforcement:** serialized public ledger contains no private fields; receipts carry no amounts/identities; events carry no private data |
| `tests/compactParity.test.ts` | Reference-runtime digests match the domain-separated schemes defined by the Compact circuits |
| `frontend/src/**/*.test.tsx` | Component behavior for policy/claim/receipt flows |

CI sequence (must pass before "done"): `npm run build` → `npm run test` → `npm run build:frontend`.

---

## 10. Frontend Specification

Next.js (Pages Router) — pages: `/` (dashboard: policies + statuses), `/policy` (create), `/claim` (submit private claim), `/receipt` (browse + verify receipts). All protocol calls go through `src/services` via a browser-compatible runtime context; proof generation happens in the page (client-side, Invariant 2). No secrets in localStorage — holder secrets live in memory for the session (documented UX tradeoff; wallet integration is the deployment path, see `docs/MIDNIGHT_NOTES.md`).

---

## 11. Build & Deployment

```bash
npm install            # dependencies
npm run build          # typecheck+compile TS core; compile contracts if toolchain present
npm run build:contracts # compact compile (auto-detects; explains on unsupported platforms)
npm run build:frontend  # Next.js production build
npm run test            # vitest, all suites
npm run deploy          # deploy/deploy.ts — writes deploy/deployments.json
```

Environment (`.env` / `.env.local`):
```
MIDNIGHT_NODE_URL=https://testnet-idx.midnight.network    # optional; default is the local reference runtime
NEXT_PUBLIC_APP_NAME=Condition
```
Secrets are read exclusively via `process.env` (AGENTS.md rule). No key material is ever committed.

Platform matrix: full toolchain (compact compiler, devnet) on glibc Linux/macOS/Windows; on Android/Termux the reference runtime + vitest + Next build are the verified path (see `docs/MIDNIGHT_NOTES.md`).

---

## 12. Threat Model (Wave 1)

| Actor | Attack | Mitigation |
|---|---|---|
| Honest holder | Crash mid-proof | Proof is client-local; no partial state published; retry safe (nullifier only spent on success) |
| Malicious claimant | Claim without enrollment | Eligibility circuit (commitment binding) |
| Malicious claimant | Double claim | Nullifier registry |
| Malicious claimant | Forge proof / inflate amount | Payout recomputed deterministically from public terms; amount commitment binding |
| Malicious oracle | Force or suppress trigger | 2-source agreement, fail-closed on conflict |
| Malicious insurer | Refuse payout after trigger | Settlement is permissionless once trigger is public; escrow funded at enrollment |
| Network observer | Link claimant to claim | Public data is commitments/nullifiers/proof hashes only (§2.1) |

---

## 13. Wave 2/3 Hooks

- Multi-holder enrollment: `enrollment_commitment` → Merkle accumulator (interface already digest-shaped).
- On-chain time: replace `now` argument with oracle time digest quorum.
- Disputes: new circuit verifying alternative trigger readings against the same terms digest.
- Batch analytics: privacy-preserving aggregates over receipt events (counts only, already public).
