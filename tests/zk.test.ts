// ZK prover unit behavior (BUILD_SPEC.md §5, §9): round-trips, tamper
// resistance, witness hygiene. (The privacy-ledger side of witness handling
// lives in privacy.test.ts; here we pin the prover itself.)

import { describe, expect, it } from 'vitest';
import {
  enrollmentCommitmentOf,
  nullifierOf,
  payoutCommitmentOf,
  randomSecret,
  statementDigestOf,
  witnessDigestOf,
  proofHashOf,
} from '../src/core/hashing.js';
import { generateClaimProof, verifyClaimProof, verifyProofConsistency } from '../src/core/zkProver.js';
import { fullFlow, PAYOUT, T_CLAIM, T_SETTLE, witnessAt } from './helpers.js';
import type { ClaimProof } from '../src/types/index.js';

describe('generate ↔ verify round-trip', () => {
  it('an honestly generated proof verifies', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const result = verifyClaimProof(
      flow.proof!, flow.witnessProvider(), policy, policy.trigger!, T_CLAIM,
    );
    expect(result.valid).toBe(true);
    expect(result.publicAmount).toBe(PAYOUT);
  });

  it('statement and proofHash recompute exactly from public inputs + witness', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const witness = flow.witnessProvider();
    const proof = flow.proof!;
    expect(proof.statement).toBe(statementDigestOf(proof.publicInputs));
    expect(proof.proofHash).toBe(proofHashOf(proof.statement, witnessDigestOf(witness)));
  });
});

describe('tampered / forged proofs', () => {
  const flipLast = (s: string) => s.slice(0, -1) + (s.endsWith('0') ? '1' : '0');

  const tamper = (proof: ClaimProof, field: string): ClaimProof => {
    const copy: ClaimProof = structuredClone(proof);
    if (field === 'statement') copy.statement = flipLast(copy.statement);
    else if (field === 'proofHash') copy.proofHash = flipLast(copy.proofHash);
    else if (field === 'nullifier') copy.publicInputs.nullifier = flipLast(copy.publicInputs.nullifier);
    else if (field === 'payoutCommitment')
      copy.publicInputs.expectedPayoutCommitment = flipLast(copy.publicInputs.expectedPayoutCommitment);
    else if (field === 'triggerOutcome') copy.publicInputs.triggerOutcome = !copy.publicInputs.triggerOutcome;
    else if (field === 'termsDigest') copy.publicInputs.termsDigest = flipLast(copy.publicInputs.termsDigest);
    else if (field === 'policyId') copy.publicInputs.policyId = flipLast(copy.publicInputs.policyId);
    return copy;
  };

  const fields = [
    'statement', 'proofHash', 'nullifier', 'payoutCommitment',
    'triggerOutcome', 'termsDigest', 'policyId',
  ];

  for (const field of fields) {
    it(`tampering ${field} breaks verification`, () => {
      const flow = fullFlow({ upTo: 'claimed' });
      const policy = flow.runtime.policyService.getPolicy(flow.policyId);
      const tampered = tamper(flow.proof!, field);
      const result = verifyClaimProof(
        tampered, flow.witnessProvider(), policy, policy.trigger!, T_CLAIM,
      );
      expect(result.valid).toBe(false);
    });
  }

  it('verifyProofConsistency catches statement/publicInputs divergence publicly', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    expect(verifyProofConsistency(flow.proof!)).toBe(true);
    // Any tamper of the statement OR the public inputs it covers breaks the
    // public consistency check — no witness needed.
    const tampered = tamper(flow.proof!, 'statement');
    expect(verifyProofConsistency(tampered)).toBe(false);
    const nullifierTampered = tamper(flow.proof!, 'nullifier');
    expect(verifyProofConsistency(nullifierTampered)).toBe(false);
  });

  it('a from-scratch forged proof (attacker’s own secret) fails eligibility', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const honest = flow.witnessProvider();
    const attackerSecret = randomSecret();
    const forged = generateClaimProof(
      { ...honest, holderSecret: attackerSecret },
      policy.termsDigest,
    );
    // The attacker's own nullifier commitment is self-consistent...
    expect(forged.publicInputs.nullifier)
      .toBe(nullifierOf(flow.policyId, attackerSecret));
    // ...but eligibility binding against the real enrollment fails.
    expect(enrollmentCommitmentOf(flow.policyId, attackerSecret))
      .not.toBe(policy.enrollmentCommitment);
    expect(verifyClaimProof(
      forged, { ...honest, holderSecret: attackerSecret }, policy, policy.trigger!, T_CLAIM,
    ).valid).toBe(false);
  });

  it('an attacker cannot claim a bigger amount: commitment binds the payout', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    const witness = flow.witnessProvider();
    const greedyProof = generateClaimProof(
      { ...witness, settlementAmount: PAYOUT * 10n },
      policy.termsDigest,
    );
    // The greedy proof is internally consistent for its own claim...
    expect(greedyProof.publicInputs.expectedPayoutCommitment)
      .toBe(payoutCommitmentOf(PAYOUT * 10n));
    // ...but settlement recomputes the amount from PUBLIC terms and the
    // verification rejects the mismatch.
    expect(verifyClaimProof(
      greedyProof, { ...witness, settlementAmount: PAYOUT * 10n },
      policy, policy.trigger!, T_CLAIM,
    ).valid).toBe(false);
  });
});

describe('witness hygiene (Invariant 2)', () => {
  it('the proof object serializes without any witness material', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const proof = flow.proof!;
    const witness = flow.witnessProvider();
    const serialized = JSON.stringify(proof);
    // None of the witness fields may appear in the public proof.
    expect(serialized).not.toContain(flow.secret);
    expect(serialized).not.toContain(witnessDigestOf(witness));
    expect(serialized).not.toContain(witness.holderSecret);
    expect(serialized).not.toContain('settlementAmount');
    expect(serialized).not.toContain('claimTime');
    expect(serialized).not.toContain('triggerEvidence');
  });

  it('settlementAmount and triggerEvidence only exist on the witness side', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    expect(Object.keys(flow.proof!)).toEqual(['statement', 'proofHash', 'publicInputs']);
    expect(Object.keys(flow.proof!.publicInputs).sort()).toEqual([
      'expectedPayoutCommitment', 'nullifier', 'policyId', 'termsDigest', 'triggerOutcome',
    ]);
  });

  it('deterministic: same witness + terms ⇒ same proof', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // Re-derive the proof from the identical witness (same secret, same time).
    const again = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM);
    expect(again.proofHash).toBe(flow.proof!.proofHash);
    expect(again.statement).toBe(flow.proof!.statement);
    expect(again.publicInputs).toEqual(flow.proof!.publicInputs);
  });
});

describe('prover determinism across claim times', () => {
  it('a later claim time changes the witness digest (and proof hash)', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    const early = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM);
    const late = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM + 1000);
    // Same nullifier/statement inputs, different witness (claimTime) ⇒ different proofHash.
    expect(late.publicInputs.nullifier).toBe(early.publicInputs.nullifier);
    expect(late.proofHash).not.toBe(early.proofHash);
  });
});
