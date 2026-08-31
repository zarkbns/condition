// Settlement service (BUILD_SPEC.md §5.2, §7.2).
//
// Mirrors settlement.compact: verifies the proof with in-circuit witness
// access (eligibility, nullifier, payout binding), spends the nullifier
// exactly once, and publishes ONLY public receipt data. It never learns
// anything it shouldn't: the amount is recomputed from public terms and
// released on the private ledger via the claimant's client.
//
// Griefing vector closed by design: a forged proof cannot burn someone
// else's nullifier because eligibility is checked against the enrollment
// commitment using the supplied witness — a forged witness fails binding.
//
// Revert semantics: every check runs BEFORE any state mutation, so a failed
// settle leaves the policy exactly as it was — same atomicity guarantee a
// failed Compact circuit transaction has on-chain.

import { ErrorCode, PolicyStatus, ProtocolError } from '../types/index.js';
import type {
  Bytes32,
  ClaimProof,
  Dust,
  Receipt,
  ReceiptStatus,
  WitnessProvider,
} from '../types/index.js';
import type { PublicLedger } from '../core/publicLedger.js';
import { receiptIdDigest } from '../core/hashing.js';
import { verifyClaimProof, verifyProofConsistency } from '../core/zkProver.js';

export interface SettleResult {
  receipt: Receipt;
  /** Amount released on the private ledger — returned to the claimant's client only. */
  releasedAmount: Dust;
}

export class SettlementService {
  private settled = 0;
  private denied = 0;

  constructor(private readonly ledger: PublicLedger) {}

  /**
   * Core settlement circuit. `witnessProvider` mirrors Midnight's
   * WitnessProvider: the holder secret arrives from the claimant's local
   * witness provider, in-process, never over the wire.
   */
  settle(
    now: number,
    proof: ClaimProof,
    policyId: Bytes32,
    witnessProvider: WitnessProvider,
  ): SettleResult {
    if (!verifyProofConsistency(proof)) {
      throw new ProtocolError(ErrorCode.INVALID_PROOF, 'statement does not match public inputs');
    }

    // Lazy expiry is a true public transition; safe to apply before checks.
    this.ledger.refreshExpiry(policyId, now);
    const policy = this.ledger.getPolicy(policyId);

    // ---- checks (read-only) -------------------------------------------------

    if (policy.status !== PolicyStatus.TRIGGERED && policy.status !== PolicyStatus.SETTLING) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `settle: status ${policy.status}`);
    }
    if (policy.enrollmentCommitment === null) {
      throw new ProtocolError(ErrorCode.NOT_ENROLLED);
    }
    if (policy.trigger === null) {
      throw new ProtocolError(ErrorCode.TRIGGER_NOT_RECORDED);
    }
    if (proof.publicInputs.policyId !== policyId) {
      throw new ProtocolError(ErrorCode.INVALID_PROOF, 'proof is for a different policy');
    }
    if (proof.publicInputs.termsDigest !== policy.termsDigest) {
      throw new ProtocolError(ErrorCode.INVALID_PROOF, 'terms digest mismatch');
    }

    const witness = witnessProvider();
    const verification = verifyClaimProof(proof, witness, policy, policy.trigger, now);
    if (!verification.valid) {
      throw new ProtocolError(ErrorCode.INVALID_PROOF, verification.reason);
    }

    if (proof.publicInputs.triggerOutcome !== policy.trigger.outcome) {
      throw new ProtocolError(ErrorCode.INVALID_PROOF, 'trigger outcome mismatch');
    }

    const inWindow = now >= policy.terms.coverageStart && now <= policy.terms.expiry;
    const willSettle = verification.publicAmount > 0n && inWindow;
    if (willSettle && policy.fundedAmount < verification.publicAmount) {
      throw new ProtocolError(
        ErrorCode.INSUFFICIENT_FUNDING,
        `escrow ${policy.fundedAmount} < payout ${verification.publicAmount}`,
      );
    }

    // ---- effects (all checks passed) ----------------------------------------

    const status: ReceiptStatus = willSettle ? 'SETTLED' : 'DENIED';
    const receipt: Receipt = {
      receiptId: receiptIdDigest(
        policyId,
        proof.proofHash,
        policy.trigger.outcome,
        willSettle,
        now,
      ),
      policyId,
      proofHash: proof.proofHash,
      triggerOutcome: policy.trigger.outcome,
      status,
      timestamp: now,
    };

    this.ledger.beginSettling(policyId, now);
    // Nullifier is spent only on the success path — a crashed client can
    // always retry safely (settlement finality, Invariant 4).
    this.ledger.spendNullifier(proof.publicInputs.nullifier);
    this.ledger.completeSettlement(policyId, status, receipt, now);
    if (willSettle) {
      this.settled += 1;
    } else {
      this.denied += 1;
    }

    return { receipt, releasedAmount: willSettle ? verification.publicAmount : 0n };
  }

  /** Public aggregate counts only (Compact `counts()` view). */
  counts(): { settled: number; denied: number } {
    return { settled: this.settled, denied: this.denied };
  }

  /**
   * Third-party receipt verification using only public data: the receipt must
   * exist and its id must recompute from its public fields.
   */
  verifyReceipt(receiptId: Bytes32): { valid: boolean; receipt?: Receipt } {
    let receipt: Receipt;
    try {
      receipt = this.ledger.getReceipt(receiptId);
    } catch {
      return { valid: false };
    }
    const recomputed = receiptIdDigest(
      receipt.policyId,
      receipt.proofHash,
      receipt.triggerOutcome,
      receipt.status === 'SETTLED',
      receipt.timestamp,
    );
    return { valid: recomputed === receipt.receiptId, receipt };
  }
}
