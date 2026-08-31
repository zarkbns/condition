// Claim flow (BUILD_SPEC.md §5, §9): eligibility, nullifier determinism,
// wrong-secret rejection, window enforcement, witness hygiene.

import { describe, expect, it } from 'vitest';
import { ErrorCode, PolicyStatus, ProtocolError } from '../src/types/index.js';
import {
  nullifierOf,
  payoutCommitmentOf,
  randomSecret,
} from '../src/core/hashing.js';
import { generateClaimProof, verifyClaimProof } from '../src/core/zkProver.js';
import { expectedPayout } from '../src/core/payout.js';
import {
  fullFlow,
  makeTerms,
  PAYOUT,
  T_CLAIM,
  T_ENROLL,
  T_PAST_EXPIRY,
  T_TRIGGER,
  witnessAt,
} from './helpers.js';

const expectCode = (fn: () => unknown, code: ErrorCode) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ProtocolError);
    expect((err as ProtocolError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but call succeeded`);
};

describe('submitClaim preconditions', () => {
  it('requires a recorded trigger (POLICY_INACTIVE for untriggered policy)', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    expectCode(
      () => flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM),
      ErrorCode.POLICY_INACTIVE,
    );
  });

  it('requires a local enrollment (NOT_ENROLLED)', async () => {
    const flow = fullFlow({ upTo: 'triggered' });
    // A stranger with an empty private ledger shares the public ledger but
    // holds no enrollment — the claim must fail before any proof exists.
    const { PrivateLedger } = await import('../src/core/privateLedger.js');
    const { ClaimService } = await import('../src/services/claimService.js');
    const stranger = new ClaimService(flow.runtime.publicLedger, new PrivateLedger());
    expectCode(
      () => stranger.submitClaim(flow.policyId, T_CLAIM),
      ErrorCode.NOT_ENROLLED,
    );
  });

  it('rejects claiming outside the coverage window (CLAIM_WINDOW_CLOSED)', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    expectCode(
      () => flow.runtime.claimService.submitClaim(flow.policyId, T_PAST_EXPIRY),
      ErrorCode.CLAIM_WINDOW_CLOSED,
    );
  });
});

describe('proof generation (client-side)', () => {
  it('produces a proof whose public inputs contain ONLY public data', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const proof = flow.proof!;
    expect(Object.keys(proof).sort()).toEqual(['proofHash', 'publicInputs', 'statement']);
    expect(Object.keys(proof.publicInputs).sort()).toEqual([
      'expectedPayoutCommitment',
      'nullifier',
      'policyId',
      'termsDigest',
      'triggerOutcome',
    ]);
    // No amount, no secret, no identity anywhere in the public surface.
    expect(JSON.stringify(proof)).not.toContain(flow.secret);
    expect(JSON.stringify(proof)).not.toContain(PAYOUT.toString());
  });

  it('nullifier is deterministic in (policyId, secret)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const derived = nullifierOf(flow.policyId, flow.secret);
    expect(flow.proof!.publicInputs.nullifier).toBe(derived);
    // Same inputs → same proof, end to end.
    const again = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM);
    expect(again.proofHash).toBe(flow.proof!.proofHash);
  });

  it('different holder secrets produce different nullifiers', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const otherSecret = randomSecret();
    expect(nullifierOf(flow.policyId, otherSecret))
      .not.toBe(flow.proof!.publicInputs.nullifier);
  });

  it('payout commitment binds the deterministic amount without revealing it', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const witness = flow.witnessProvider();
    expect(flow.proof!.publicInputs.expectedPayoutCommitment)
      .toBe(payoutCommitmentOf(witness.settlementAmount));
    expect(witness.settlementAmount).toBe(PAYOUT);
  });

  it('verifyClaimProof accepts an honest witness', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const verification = verifyClaimProof(
      flow.proof!, flow.witnessProvider(), policy, policy.trigger!, T_CLAIM,
    );
    expect(verification.valid).toBe(true);
    expect(verification.publicAmount).toBe(PAYOUT);
  });

  it('verifyClaimProof rejects a WRONG secret (eligibility binding)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const honest = flow.witnessProvider();
    const forged = { ...honest, holderSecret: randomSecret() };
    const result = verifyClaimProof(flow.proof!, forged, policy, policy.trigger!, T_CLAIM);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('eligibility binding failed');
  });

  it('verifyClaimProof rejects an inflated amount (payout binding)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const witness = flow.witnessProvider();
    const greedy = {
      ...witness,
      settlementAmount: PAYOUT * 2n,
    };
    const result = verifyClaimProof(flow.proof!, greedy, policy, policy.trigger!, T_CLAIM);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('witness amount is not the deterministic payout');
  });

  it('a proof built for a different policy is rejected', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const witness = flow.witnessProvider();
    const forged = generateClaimProof(
      { ...witness, policyId: randomSecret() },
      policy.termsDigest,
    );
    const result = verifyClaimProof(forged, witness, policy, policy.trigger!, T_CLAIM);
    expect(result.valid).toBe(false);
  });
});

describe('claim window enforcement', () => {
  it('claims at expiry boundary are still inside (inclusive window)', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    const proof = flow.runtime.claimService.submitClaim(flow.policyId, flow.terms.expiry);
    expect(proof.publicInputs.triggerOutcome).toBe(true);
  });

  it('settle after expiry lazily flips the policy EXPIRED and refuses to settle', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // Lazy expiry inside settle() flips the policy first…
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_PAST_EXPIRY, flow.proof!, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
    // …and the flip is a true public transition (PolicyExpired event emitted).
    expect(flow.runtime.policyService.getPolicy(flow.policyId).status)
      .toBe(PolicyStatus.EXPIRED);
    expect(flow.runtime.publicLedger.listEvents().map((e) => e.type))
      .toContain('PolicyExpired');
  });
});

describe('deterministic amount', () => {
  it('trigger true + in window → full payout; anything else → 0', () => {
    expect(expectedPayout(makeTerms(), true, T_TRIGGER)).toBe(PAYOUT);
    expect(expectedPayout(makeTerms(), false, T_TRIGGER)).toBe(0n);
    expect(expectedPayout(makeTerms(), true, T_PAST_EXPIRY)).toBe(0n);
    expect(expectedPayout(makeTerms(), true, makeTerms().coverageStart)).toBe(PAYOUT);
  });
});
