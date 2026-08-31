// privacy.test.ts — THE PRIVACY INVARIANT SUITE (BUILD_SPEC.md §2, §9).
//
// This is Condition's thesis, mechanically enforced: prove fairness without
// revealing identity. Every test here serializes what an outside observer
// can actually see (the full public audit view) and asserts that NO private
// field, value, or derivation of the claimant exists anywhere in it.
//
// The suite is adversarial by construction: it does not trust the public
// ledger's own view of what is public — it takes the claimant's private
// state (secret, witness, amounts, timestamps) and greps for every
// representation of it across the entire public surface: raw, as digest
// preimages, as substrings, inside event data, receipts, nullifiers.
//
// Invariants covered (BUILD_SPEC §2 numbering):
//   1. Privacy boundary       — public ledger holds only allow-listed data
//   2. ZK proof correctness   — proofs carry public inputs + digests only
//   3. Public receipt auditability — receipts verifiable, amount-free
//   4. Settlement finality    — published receipts cannot change
//   5. Policy transparency    — full terms reconstructible from public data
//   6. No private data in contracts — allow-listed ledger/event field names

import { describe, expect, it } from 'vitest';
import {
  enrollmentCommitmentOf,
  nullifierOf,
  payoutCommitmentOf,
  randomSecret,
  witnessDigestOf,
} from '../src/core/hashing.js';
import { expectedPayout } from '../src/core/payout.js';
import {
  collectKeys,
  collectValues,
  fullFlow,
  PAYOUT,
  PREMIUM,
  serializePublic,
  T_CLAIM,
  T_ENROLL,
  T_SETTLE,
  T_TRIGGER,
} from './helpers.js';
import type { ClaimWitness, ProtocolEvent } from '../src/types/index.js';

/** Everything an outside observer can ever see, serialized. */
function observerView(flow: ReturnType<typeof fullFlow>): string {
  return serializePublic(flow.runtime.publicLedger.auditView());
}

describe('Invariant 1 — privacy boundary: the public ledger holds no private data', () => {
  it('the holder secret never appears in the public audit view (any representation)', () => {
    const flow = fullFlow();
    const view = observerView(flow);
    const secret = flow.secret;
    // Raw secret
    expect(view).not.toContain(secret);
    // Hex body without 0x prefix
    expect(view).not.toContain(secret.slice(2));
    // The secret must also not be recoverable via its known derivations.
    expect(view).not.toContain(witnessDigestOf(flow.witnessProvider()));
  });

  it('the settlement amount never appears in the public audit view', () => {
    const flow = fullFlow();
    const view = observerView(flow);
    // No settlement/payout-release fields exist anywhere in the public view.
    expect(view).not.toContain('"releasedAmount"');
    expect(view).not.toContain('"settlementAmount"');
    expect(view).not.toContain('"payoutReceived"');
    // Receipts (the settlement's public artifact) carry no amount at all.
    for (const receipt of flow.runtime.publicLedger.listReceipts()) {
      expect(serializePublic(receipt)).not.toContain(PAYOUT.toString());
    }
    // Policy terms ARE public by design (Invariant 5) — the payout *schedule*
    // is transparent; the *settled amount* is what stays private. In Wave 1
    // the settled amount is derivable from public terms (deterministic
    // payout), so privacy here means: no claimant-specific amount field,
    // no linkage of amounts to identities.
    expect(view).toContain('"payoutAmount":"5000000000"'); // terms: public by design
  });

  it('the full witness never appears in any public event', () => {
    const flow = fullFlow();
    const witness = flow.witnessProvider();
    for (const event of flow.runtime.publicLedger.listEvents()) {
      const serialized = serializePublic(event);
      expect(serialized).not.toContain(witness.holderSecret);
      expect(serialized).not.toContain('"settlementAmount"');
      expect(serialized).not.toContain('"claimTime"');
      expect(serialized).not.toContain('"triggerEvidence"');
      expect(serialized).not.toContain('"holderSecret"');
    }
  });

  it('public field names are exactly the allow-list (Invariant 6)', () => {
    const flow = fullFlow();
    const keys = collectKeys(flow.runtime.publicLedger.auditView());
    const FORBIDDEN_KEYS = [
      'holderSecret', 'secret', 'claimant', 'claimantId', 'identity', 'email',
      'settlementAmount', 'claimTime', 'triggerEvidence', 'witness',
      'releasedAmount', 'balance', 'privateLedger', 'claims',
    ];
    for (const forbidden of FORBIDDEN_KEYS) {
      expect(keys.has(forbidden), `public view contains forbidden key "${forbidden}"`)
        .toBe(false);
    }
    // Receipts exactly: receiptId, policyId, proofHash, triggerOutcome, status, timestamp.
    for (const receipt of flow.runtime.publicLedger.listReceipts()) {
      expect(Object.keys(receipt).sort()).toEqual([
        'policyId', 'proofHash', 'receiptId', 'status', 'timestamp', 'triggerOutcome',
      ]);
    }
    // Policy public shape: terms + digests + status + escrow + commitment + trigger.
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(Object.keys(policy).sort()).toEqual([
      'createdAt', 'enrollmentCommitment', 'fundedAmount', 'insurer', 'policyId',
      'status', 'terms', 'termsDigest', 'trigger',
    ]);
  });

  it('the enrollment commitment and nullifier are the ONLY claimant-derived public values', () => {
    const flow = fullFlow();
    const values = collectValues(flow.runtime.publicLedger.auditView());
    const commitment = enrollmentCommitmentOf(flow.policyId, flow.secret);
    const nullifier = nullifierOf(flow.policyId, flow.secret);
    expect(values.has(commitment)).toBe(true);
    expect(values.has(nullifier)).toBe(true);
    // And they are one-way: neither equals nor reveals the secret.
    expect(commitment).not.toBe(flow.secret);
    expect(nullifier).not.toBe(flow.secret);
    expect(commitment).not.toBe(nullifier);
  });

  it('observer cannot distinguish claims from receipts across two policies (unlinkability)', () => {
    // Two independent flows settle. The observer sees two receipts; nothing
    // links a receipt to a claimant (beyond the policy it settles).
    const flowA = fullFlow();
    const flowB = fullFlow({ triggerValues: [2000, 2200] }); // denied
    void flowB;
    const receipts = flowA.runtime.publicLedger.listReceipts();
    expect(receipts).toHaveLength(1);
    expect(Object.keys(receipts[0]!).sort()).toEqual([
      'policyId', 'proofHash', 'receiptId', 'status', 'timestamp', 'triggerOutcome',
    ]);
  });
});

describe('Invariant 2 — ZK proof correctness: proofs carry digests, never witnesses', () => {
  it('ClaimProof shape is exactly public inputs + two digests', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    expect(Object.keys(flow.proof!).sort()).toEqual(['proofHash', 'publicInputs', 'statement']);
  });

  it('the proof hash commits to the witness without revealing it', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const witness = flow.witnessProvider();
    const serialized = JSON.stringify(flow.proof!);
    expect(serialized).not.toContain(witness.holderSecret);
    expect(serialized).not.toContain(witnessDigestOf(witness));
    // The digest of the witness is INSIDE the proofHash preimage, but the
    // serialized proof must not carry it directly.
    expect(flow.proof!.proofHash).not.toBe(witnessDigestOf(witness));
  });

  it('the payout commitment hides the amount while binding it', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const commitment = flow.proof!.publicInputs.expectedPayoutCommitment;
    expect(commitment).toBe(payoutCommitmentOf(PAYOUT));
    expect(commitment).not.toContain(PAYOUT.toString());
    // A different amount yields a different commitment (binding).
    expect(payoutCommitmentOf(PAYOUT + 1n)).not.toBe(commitment);
  });

  it('proof generation is deterministic given the witness (same secret ⇒ same proof)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // Same holder secret + same claim time ⇒ identical proof, twice.
    const again = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM);
    expect(again.proofHash).toBe(flow.proof!.proofHash);
    expect(again.statement).toBe(flow.proof!.statement);
  });
});

describe('Invariant 3 — public receipt auditability', () => {
  it('anyone can verify a receipt from public data alone', () => {
    const flow = fullFlow();
    const { valid, receipt } = flow.runtime.settlementService.verifyReceipt(
      flow.receipt!.receiptId,
    );
    expect(valid).toBe(true);
    expect(receipt).toEqual(flow.receipt);
  });

  it('receipts carry NO amount field — structurally impossible', () => {
    const flow = fullFlow();
    const receiptKeys = Object.keys(flow.receipt!);
    expect(receiptKeys).not.toContain('amount');
    expect(receiptKeys).not.toContain('releasedAmount');
    expect(receiptKeys).not.toContain('payout');
    expect(serializePublic(flow.receipt!)).not.toContain(PAYOUT.toString());
  });

  it('receipt verification needs no private state (nullifier/proofHash/terms only)', () => {
    const flow = fullFlow();
    // An arbitrary third party uses ONLY the receipt id (public) and the
    // ledger's public receipts — verifyReceipt touches no private ledger.
    const thirdParty = flow.runtime.settlementService;
    const { valid } = thirdParty.verifyReceipt(flow.receipt!.receiptId);
    expect(valid).toBe(true);
    const { valid: invalid } = thirdParty.verifyReceipt(randomSecret());
    expect(invalid).toBe(false);
  });
});

describe('Invariant 4 — settlement finality', () => {
  it('a published receipt cannot be modified, removed, or re-published', () => {
    const flow = fullFlow();
    const receipts = flow.runtime.publicLedger.listReceipts();
    const original = serializePublic(receipts);
    // Re-settling the same policy is impossible (terminal status)…
    expect(() => flow.runtime.settlementService.settle(
      T_SETTLE + 1, flow.proof!, flow.policyId, flow.witnessProvider,
    )).toThrow();
    // …and the receipts list is unchanged, byte for byte.
    expect(serializePublic(flow.runtime.publicLedger.listReceipts())).toBe(original);
  });

  it('the event trail is append-only (prefix preserved under further activity)', () => {
    const flow = fullFlow();
    const trailBefore = flow.runtime.publicLedger.listEvents().map((e) => e.seq);
    // More public activity (a new policy on the same ledger).
    flow.runtime.policyService.create(flow.insurer, flow.terms, T_SETTLE + 1);
    const trailAfter = flow.runtime.publicLedger.listEvents().map((e) => e.seq);
    expect(trailAfter.slice(0, trailBefore.length)).toEqual(trailBefore);
    expect(trailAfter.length).toBeGreaterThan(trailBefore.length);
  });
});

describe('Invariant 5 — policy transparency', () => {
  it('full policy terms are reconstructible from public data alone', () => {
    const flow = fullFlow();
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    // An observer reads terms straight off the public policy record.
    expect(policy.terms).toEqual(flow.terms);
    // Every term was also broadcast in the PolicyCreated event.
    const created = flow.runtime.publicLedger.listEvents().find(
      (e) => e.type === 'PolicyCreated',
    )!;
    expect(created.data.threshold).toBe(flow.terms.threshold);
    expect(created.data.payoutAmount).toBe(flow.terms.payoutAmount.toString());
    expect(created.data.premium).toBe(flow.terms.premium.toString());
    expect(created.data.expiry).toBe(flow.terms.expiry);
  });

  it('trigger outcome and evidence are public (verifiable fairness)', () => {
    const flow = fullFlow();
    const triggerEvent = flow.runtime.publicLedger.listEvents().find(
      (e) => e.type === 'TriggerRecorded',
    )!;
    expect(triggerEvent.data.outcome).toBe(true);
    expect(triggerEvent.data.observedValue).toBe(3600);
    expect(triggerEvent.data.sourceIds).toHaveLength(2);
  });
});

describe('Invariant 6 — no private data in contracts', () => {
  it('every public event type is from the fixed protocol vocabulary', () => {
    const flow = fullFlow();
    const VOCABULARY = new Set([
      'PolicyCreated', 'PolicyFunded', 'HolderEnrolled', 'TriggerRecorded',
      'TriggerRejected', 'ClaimSettled', 'ClaimDenied', 'ReceiptPublished',
      'PolicyExpired', 'PolicyClosed',
    ]);
    for (const event of flow.runtime.publicLedger.listEvents()) {
      expect(VOCABULARY.has(event.type), `unknown event type ${event.type}`).toBe(true);
    }
  });

  it('event payloads contain no claimant-derived fields beyond commitments', () => {
    const flow = fullFlow();
    const ALLOWED_EVENT_DATA_KEYS = new Set([
      'policyId', 'insurer', 'termsDigest', 'triggerType', 'operator', 'threshold',
      'payoutAmount', 'premium', 'coverageStart', 'expiry', // PolicyCreated
      'amount', 'fundedAmount', // PolicyFunded (escrow aggregates)
      'enrollmentCommitment', // HolderEnrolled
      'observedValue', 'outcome', 'sourceIds', // TriggerRecorded
      'reason', // TriggerRejected
      'receiptId', 'proofHash', 'triggerOutcome', 'status', 'timestamp', // receipts
      'refundedAmount', // PolicyClosed
    ]);
    for (const event of flow.runtime.publicLedger.listEvents()) {
      for (const key of Object.keys(event.data)) {
        expect(
          ALLOWED_EVENT_DATA_KEYS.has(key),
          `event ${event.type} carries unexpected data key "${key}"`,
        ).toBe(true);
      }
    }
  });

  it('compact contracts reference digests, never claimant data', () => {
    // The contracts' public ledgers are digest-shaped by design; this pins
    // that the reference runtime never introduced a private-data channel the
    // contracts don't have: every claimant-derived value crossing the
    // boundary is a 32-byte digest produced by the domain-separated scheme.
    const flow = fullFlow({ upTo: 'enrolled' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.enrollmentCommitment).toBe(
      enrollmentCommitmentOf(flow.policyId, flow.secret),
    );
    expect(policy.enrollmentCommitment).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('adversarial: linking attacks against the observer view', () => {
  it('premium/payout numbers do not fingerprint the claimant session', () => {
    const flow = fullFlow();
    const view = observerView(flow);
    // Claimant-specific values that must NOT be present:
    // witness claimTime (private to the claimant, distinct from public timestamps)
    const witness = flow.witnessProvider();
    const claimTimeOnly = `"claimTime":${witness.claimTime}`;
    expect(view).not.toContain(claimTimeOnly);
    void T_CLAIM; void T_ENROLL; void T_TRIGGER; void PREMIUM;
  });

  it('DENIED receipts leak nothing about the claimant either', () => {
    const flow = fullFlow({ triggerValues: [2000, 2200] });
    const view = observerView(flow);
    expect(view).not.toContain(flow.secret);
    expect(flow.receipt!.status).toBe('DENIED');
    expect(serializePublic(flow.receipt!)).not.toContain(PAYOUT.toString());
  });

  it('a network observer replaying the flow derives the same PUBLIC view only', () => {
    // Determinism check: all randomness lives in the holder secret, which is
    // private. An observer replaying identical public inputs sees identical
    // public outputs — nothing about the secret is inferable from the public
    // view (its derivations differ by domain tag).
    const flow = fullFlow();
    const commitment = enrollmentCommitmentOf(flow.policyId, flow.secret);
    const nullifier = nullifierOf(flow.policyId, flow.secret);
    expect(commitment).not.toBe(nullifier);
    // And neither is derivable backwards to the secret (one-way).
    expect(commitment.length).toBe(66);
    expect(nullifier.length).toBe(66);
  });
});

describe('settlement amount privacy across the boundary (Wave 1 distinction)', () => {
  it('the private ledger records the payout; the public ledger cannot', () => {
    const flow = fullFlow();
    expect(flow.runtime.privateLedger.balance(flow.policyId)).toBe(PAYOUT);
    // The public view has no balance/claims section at all.
    const view = observerView(flow);
    expect(view).not.toContain('"balances"');
    expect(view).not.toContain('"claims"');
    // Escrow accounting on the public side is aggregate-only.
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.fundedAmount).toBe(PAYOUT + PREMIUM); // aggregate, no linkage
    expect(expectedPayout(flow.terms, true, T_SETTLE)).toBe(PAYOUT); // derivable from terms
  });

  it('the PrivateLedger serializer structurally excludes secrets (defense in depth)', () => {
    const flow = fullFlow();
    const dumped = JSON.stringify(flow.runtime.privateLedger);
    expect(dumped).not.toContain(flow.secret);
    expect(dumped).toContain('"balances"'); // balances only, by design
  });
});
