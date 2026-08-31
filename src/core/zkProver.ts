// Client-side ZK prover (BUILD_SPEC.md §5).
//
// Models the Compact pure circuits from contracts/proofs.compact:
//
//   statement  = H(stmt, policyId, termsDigest, nullifier, outcome, H(amount))
//   proofHash  = H(proof, statement, H(witness))
//
// The witness is consumed in-process and never serialized, logged, or
// transmitted (Invariant 2). `ClaimProof` is the only thing that leaves the
// prover, and it contains public inputs plus two digests — nothing else.
//
// Verification (`verifyClaimProof`) mirrors what the settlement circuit
// enforces on-chain with witness access:
//   1. eligibility  — H_elig(policyId, secret) == policy.enrollmentCommitment
//   2. nullifier    — H_null(policyId, secret) == proof.publicInputs.nullifier
//   3. payout       — deterministic amount from PUBLIC terms, bound via H(amount)
//   4. consistency  — statement and proofHash recompute exactly
//
// The privacy assumption: proof generation and witness supply happen in the
// claimant's client (browser / trusted local runtime), never via an API.

import type {
  Bytes32,
  ClaimProof,
  ClaimProofPublicInputs,
  ClaimWitness,
  Dust,
  Policy,
  TriggerRecord,
} from '../types/index.js';
import {
  enrollmentCommitmentOf,
  nullifierOf,
  proofHashOf,
  payoutCommitmentOf,
  statementDigestOf,
  witnessDigestOf,
} from './hashing.js';
import { expectedPayout } from './payout.js';

export function generateClaimProof(
  witness: ClaimWitness,
  termsDigest: Bytes32,
): ClaimProof {
  const publicInputs: ClaimProofPublicInputs = {
    policyId: witness.policyId,
    termsDigest,
    nullifier: nullifierOf(witness.policyId, witness.holderSecret),
    triggerOutcome: witness.triggerEvidence.outcome,
    expectedPayoutCommitment: payoutCommitmentOf(witness.settlementAmount),
  };
  const statement = statementDigestOf(publicInputs);
  const proofHash = proofHashOf(statement, witnessDigestOf(witness));
  return { statement, proofHash, publicInputs };
}

export interface ProofVerification {
  valid: boolean;
  reason?: string;
  /** Amount recomputed from PUBLIC terms — what the settlement relies on. */
  publicAmount: Dust;
}

/**
 * Full binding verification with in-circuit witness access. Called by the
 * settlement flow (in-process witness provider). Returns a result object
 * rather than throwing so callers can map failures to INVALID_PROOF.
 */
export function verifyClaimProof(
  proof: ClaimProof,
  witness: ClaimWitness,
  policy: Policy,
  trigger: TriggerRecord,
  now: number,
): ProofVerification {
  const publicAmount = expectedPayout(policy.terms, trigger.outcome, now);

  const eligibility = enrollmentCommitmentOf(witness.policyId, witness.holderSecret);
  if (eligibility !== policy.enrollmentCommitment) {
    return { valid: false, reason: 'eligibility binding failed', publicAmount };
  }

  const nullifier = nullifierOf(witness.policyId, witness.holderSecret);
  if (nullifier !== proof.publicInputs.nullifier) {
    return { valid: false, reason: 'nullifier derivation mismatch', publicAmount };
  }

  if (witness.policyId !== policy.policyId || witness.policyId !== proof.publicInputs.policyId) {
    return { valid: false, reason: 'policy id mismatch', publicAmount };
  }

  if (witness.settlementAmount !== publicAmount) {
    return { valid: false, reason: 'witness amount is not the deterministic payout', publicAmount };
  }

  if (payoutCommitmentOf(publicAmount) !== proof.publicInputs.expectedPayoutCommitment) {
    return { valid: false, reason: 'payout commitment binding failed', publicAmount };
  }

  const statement = statementDigestOf(proof.publicInputs);
  if (statement !== proof.statement) {
    return { valid: false, reason: 'statement digest mismatch', publicAmount };
  }

  const proofHash = proofHashOf(statement, witnessDigestOf(witness));
  if (proofHash !== proof.proofHash) {
    return { valid: false, reason: 'proof hash mismatch', publicAmount };
  }

  return { valid: true, publicAmount };
}

/**
 * Public-consistency check of a proof, verifiable by anyone using only the
 * proof object (all public data): the statement must be the digest of the
 * declared public inputs. This is the part of SNARK verification that does
 * not need the witness — the binding checks above are enforced by the
 * settlement circuit at settle time.
 */
export function verifyProofConsistency(proof: ClaimProof): boolean {
  return statementDigestOf(proof.publicInputs) === proof.statement;
}
