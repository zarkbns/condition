# ARCHITECTURE.md — System Design Deep-Dive

Condition is a privacy-preserving parametric insurance protocol on Midnight. This document explains how the pieces fit together and why. For exact interface definitions see `BUILD_SPEC.md`; for the Midnight-specific integration notes see `docs/MIDNIGHT_NOTES.md`.

---

## 1. The Core Idea

Parametric insurance pays out when an objective event occurs (e.g. "temperature > 35°C on date X"). Existing on-chain implementations (e.g. Etherisc) make every claim fully public: who claimed, when, how much. Condition keeps the parts that *should* be public (policy terms, trigger events, settlement receipts) public, and moves the parts that *should* be private (claimant identity, claim amount, eligibility) onto Midnight's private ledger — then proves settlement correctness with a zero-knowledge proof so fairness remains publicly verifiable.

The name is the thesis: the *condition* is public; the *claimant* is not.

---

## 2. Layered View

```
┌──────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (Next.js)                                                       │
│   /  /policy  /claim  /receipt                                           │
│   Proof generation happens here, client-side (zkProver)                  │
├──────────────────────────────────────────────────────────────────────────┤
│ SERVICES (TypeScript)                                                    │
│   policyService      triggerService      claimService    settlementService│
│   Orchestrate the protocol state machine; own no secrets besides the     │
│   holder secret that claimService holds in memory for the session.       │
├──────────────────────────────┬───────────────────────────────────────────┤
│ CORE (TypeScript reference runtime) │ CONTRACTS (Compact)                │
│   hashing      publicLedger        │   policy.compact                    │
│   zkProver     privateLedger       │   settlement.compact                │
│   Executable spec; mirrors the     │   proofs.compact                    │
│   Compact state machine exactly    │   Canonical on-chain targets        │
├──────────────────────────────┴───────────────────────────────────────────┤
│ MIDNIGHT NETWORK                                                         │
│   public ledger (policies, triggers, receipts, nullifiers, proof hashes)  │
│   private ledger (identities, secrets, amounts)                          │
│   ZK circuits (client-proved, contract-verified)                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Why two runtime layers?

The Compact compiler is a native binary that doesn't run on all developer platforms (notably Android/Termux, where this project is being built). The architecture therefore separates *what the protocol does* (the reference runtime — pure TypeScript, fully testable anywhere) from *where it executes in production* (the Compact contracts — compiled and deployed from a standard toolchain). Both implement the same state machine and the same domain-separated hash schemes; `tests/compactParity.test.ts` pins the digest schemes so the two layers cannot drift.

---

## 3. The Privacy Boundary, Concretely

Everything the public ledger ever sees:

```
PolicyCreated    { policyId, insurer, termsDigest, terms }
PolicyFunded     { policyId, amount, fundedAmount }
HolderEnrolled   { policyId, enrollmentCommitment }
TriggerRecorded  { policyId, observedValue, outcome, sourceIds }
TriggerRejected  { policyId, reason }
ClaimSettled     { policyId, receiptId }
ClaimDenied      { policyId, receiptId }
ReceiptPublished { receiptId, policyId, proofHash, triggerOutcome, status, timestamp }
PolicyExpired    { policyId }
PolicyClosed     { policyId, refundedAmount }
```

Everything that stays private, forever:

```
holderSecret          (client memory only; ≥128-bit; never serialized)
claimant identity     (never enters the system at all — the secret IS the identity)
settlement amount     (private ledger / shielded balance)
claim witness         (consumed in-process by zkProver; never logged, stored, or sent)
```

The bridge between the two worlds is exactly three cryptographic objects:

1. **Enrollment commitment** `H_elig(policyId, secret)` — published at enrollment; proves "someone enrolled" without saying who.
2. **Nullifier** `H_null(policyId, secret)` — published at settlement; proves "this policy's holder hasn't claimed before" without linking to the commitment (different domain separator breaks linkability).
3. **Proof hash** — published in the receipt; proves the settlement followed the policy terms.

The three digests are the entire public surface of a claimant. `tests/privacy.test.ts` enforces this mechanically: it serializes every public artifact the system can produce and fails if any private field name or value appears.

---

## 4. Settlement Flow (end-to-end)

```
  Insurer                Holder                    Oracle A + B         Public ledger
    │                      │                           │                    │
    │──create(terms)───────│───────────────────────────│───────────────────▶│ PolicyCreated
    │──fund(payout+margin)─│───────────────────────────│───────────────────▶│ PolicyFunded
    │                      │──enroll(H_elig, premium)──│───────────────────▶│ HolderEnrolled
    │                      │  (secret stays client)    │                    │
    │                      │                           │──readings agree──▶│ TriggerRecorded
    │                      │                           │  (≥2 sources)      │
    │                      │◀───── trigger outcome (public data) ──────────│
    │                      │                            │                   │
    │                      │ [client-side proof]        │                   │
    │                      │  witness = (secret, terms, │                   │
    │                      │   trigger, amount)         │                   │
    │                      │  proof    = ZK(witness)    │                   │
    │                      │──settle(now, nullifier, proofHash)───────────▶│ ClaimSettled/Denied
    │                      │                            │                   │   (contract verifies:
    │                      │                            │                   │    eligibility ✓
    │                      │                            │                   │    nullifier fresh ✓
    │                      │                            │                   │    payout binding ✓)
    │                      │◀──── shielded payout ──────│───────────────────│ ReceiptPublished
    │                      │                            │                   │
    │──withdraw(remainder)────────────────────────────────────────────────▶│ PolicyClosed
```

The settlement contract *never learns* the amount it pays. It learns `H(amount)` (via the proof's payout commitment) and enforces that the claimed amount equals the deterministic payout for the public terms and trigger outcome. The actual transfer happens on the private ledger inside the shielded flow — authorized by the proof, sized by the holder's client.

---

## 5. State Machine

```
ACTIVE ──fund──▶ ACTIVE ──enroll──▶ ACTIVE ──record_trigger──▶ TRIGGERED
                                                      │
                                       SETTLING ◀─────┘(claim submitted)
                                     ┌────┴────┐
                                SETTLED     DENIED
                                     └────┬────┘
                                    EXPIRED(lazy)
                                       │
                                    CLOSED(withdraw)
```

Rules that matter:

- **Terms are immutable** after creation. Terms changes = new policy (Invariant 5).
- **Trigger requires 2 agreeing sources**; disagreement is fail-closed and itself a public event.
- **Nullifiers are spent exactly once.** Retry after a crashed client is safe: the nullifier is only added when the receipt is published.
- **Receipts are immutable.** There is no update or delete path — settlement finality (Invariant 4).
- **Expiry is lazy.** Any read or transition after `expiry` flips the policy to EXPIRED; no cron needed. Claims after expiry are rejected with `CLAIM_WINDOW_CLOSED`.

---

## 6. ZK Proof Design

### 6.1 Statement (what the proof says)

For policy `P`, holder secret `s`, trigger outcome `o`, claim time `t`:

1. `H_elig(P.id, s) = P.enrollmentCommitment` — *I am the enrolled holder.*
2. `nullifier = H_null(P.id, s)` — *this is my one-time claim tag.*
3. `amount = o ∧ (t ∈ window) ? P.payout : 0` — *the amount is exactly what the public terms dictate.*
4. `H_amt(amount) = payoutCommitment` — *I committed to that exact amount.*

Anyone can verify the proof against purely public inputs. Nobody can extract `s` or `amount` from it.

### 6.2 Why hash commitments instead of raw values in the proof?

Amounts flow through the proof as a *commitment* (`H(amount)`) so the public ledger never sees the number, while the settlement logic still binds the proof to exactly one amount. This is the same pattern Midnight's shielded pool uses for note commitments.

### 6.3 What Midnight gives us for free

- **Client-side ZK**: Compact pure circuits compile to proving/verification keys; the browser generates proofs with the witness never leaving the page. No server ever sees claim data (Invariant 2 by construction).
- **Private ledger**: secrets and shielded balances live in the claimant's private state, not contract storage.
- **Public ledger + events**: receipts and nullifiers are ordinary public state — auditable by anyone, forever.

---

## 7. Services

| Service | Knows about | Never touches |
|---|---|---|
| `policyService` | Terms, escrow, enrollment commitments | Holder secrets |
| `triggerService` | Source registry, cross-verification | Claimant anything |
| `claimService` | Holder secret (session memory), proof generation | Public writes (delegates to settlement) |
| `settlementService` | Nullifiers, proofs, receipts | Holder secret, amounts |

Dependency direction: `services → core`; `frontend → services`. Nothing in `core` imports from `services`; nothing in `services` imports from the frontend. This keeps the protocol logic testable without any UI and portable to any host (CLI, backend, browser).

---

## 8. Failure Modes & Safety

- **Client crashes mid-proof:** nothing published; nullifier unspent; retry works.
- **Malicious oracle:** one source alone can never record (or suppress) a trigger — needs a second agreeing source.
- **Forged proof:** verification recomputes the proof hash from public inputs and checks eligibility/nullifier/payout bindings — any tampering fails `INVALID_PROOF`.
- **Replay/double-claim:** deterministic nullifier + spent registry.
- **Insufficient escrow at settle:** fail-closed `INSUFFICIENT_FUNDING`; insurer can top up; policy is not settled.

---

## 9. Wave 2/3 Extension Points

- `enrollmentCommitment` → Merkle root over N holders (settlement proofs become membership proofs — same statement shape).
- `spent_root` accumulator → real nullifier tree.
- `now` argument → quorum oracle time digest.
- Receipt events → privacy-preserving batch analytics (public counts already emitted).

See `docs/WAVES.md` for the roadmap.
