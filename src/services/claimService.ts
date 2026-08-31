// Claim service — the claimant's client-side flow (BUILD_SPEC.md §5).
//
// This is the only component besides the prover that ever touches the holder
// secret, and it lives entirely on the claimant's side: the secret is
// generated locally (≥128-bit), held in session memory, and consumed by the
// in-process prover. Nothing here is ever serialized or sent anywhere.
//
// Enrollment publishes ONLY H_elig(policyId, secret). Claiming builds the
// witness locally and produces a ClaimProof (public inputs + digests only).

import { ErrorCode, PolicyStatus, ProtocolError } from '../types/index.js';
import type { Bytes32, ClaimProof, ClaimWitness, Dust, Policy } from '../types/index.js';
import type { PublicLedger } from '../core/publicLedger.js';
import type { PrivateLedger } from '../core/privateLedger.js';
import { enrollmentCommitmentOf, randomSecret } from '../core/hashing.js';
import { generateClaimProof } from '../core/zkProver.js';
import { inCoverageWindow } from '../core/payout.js';

export class ClaimService {
  constructor(
    private readonly ledger: PublicLedger,
    private readonly privateLedger: PrivateLedger,
  ) {}

  /**
   * Enroll the local holder on a policy. The secret is generated here and
   * stored ONLY in the private ledger. Returns the commitment to publish.
   */
  enroll(policyId: Bytes32, now: number): { commitment: Bytes32; policy: Policy } {
    const policy = this.ledger.getPolicy(policyId);
    if (policy.status !== PolicyStatus.ACTIVE) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `enroll: status ${policy.status}`);
    }
    if (policy.enrollmentCommitment !== null) {
      throw new ProtocolError(ErrorCode.ALREADY_ENROLLED);
    }
    if (this.privateLedger.hasEnrollment(policyId)) {
      throw new ProtocolError(ErrorCode.ALREADY_ENROLLED, 'local: already enrolled');
    }
    if (!inCoverageWindow(policy.terms, now)) {
      throw new ProtocolError(ErrorCode.CLAIM_WINDOW_CLOSED, 'cannot enroll outside coverage window');
    }

    const holderSecret = randomSecret();
    this.privateLedger.enroll(policyId, holderSecret);
    const commitment = enrollmentCommitmentOf(policyId, holderSecret);
    return { commitment, policy };
  }

  /**
   * Build a claim witness and generate the client-side proof. The witness
   * never leaves this call: it is consumed by the prover and dropped.
   */
  submitClaim(policyId: Bytes32, now: number): ClaimProof {
    const policy = this.ledger.getPolicy(policyId);
    if (policy.status !== PolicyStatus.TRIGGERED) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `claim: status ${policy.status}`);
    }
    if (policy.trigger === null) {
      throw new ProtocolError(ErrorCode.TRIGGER_NOT_RECORDED);
    }
    if (!this.privateLedger.hasEnrollment(policyId)) {
      throw new ProtocolError(ErrorCode.NOT_ENROLLED, 'no local enrollment for this policy');
    }
    if (!inCoverageWindow(policy.terms, now)) {
      throw new ProtocolError(ErrorCode.CLAIM_WINDOW_CLOSED);
    }

    const secret = this.privateLedger.secretFor(policyId);
    const amount = computeSettlementAmount(policy, now);
    const witness: ClaimWitness = {
      policyId,
      holderSecret: secret,
      settlementAmount: amount,
      claimTime: now,
      triggerEvidence: policy.trigger,
    };
    // Proof generation is local and in-process; witness dies with this frame.
    return generateClaimProof(witness, policy.termsDigest);
  }

  /** Credit a shielded payout (called by settlementService after success). */
  receivePayout(policyId: Bytes32, amount: Dust, timestamp: number): void {
    this.privateLedger.credit(policyId, amount, timestamp);
  }

  secretFor(policyId: Bytes32): Bytes32 {
    return this.privateLedger.secretFor(policyId);
  }

  hasEnrollment(policyId: Bytes32): boolean {
    return this.privateLedger.hasEnrollment(policyId);
  }
}

function computeSettlementAmount(policy: Policy, now: number): Dust {
  if (policy.trigger === null) {
    return 0n;
  }
  return policy.trigger.outcome && inCoverageWindow(policy.terms, now)
    ? policy.terms.payoutAmount
    : 0n;
}
