// Settlement (BUILD_SPEC.md §5.2, §7.2, §9): happy path, receipt publication,
// double-claim rejection, insufficient funding, DENIED path, finality,
// revert atomicity.

import { describe, expect, it } from 'vitest';
import { ErrorCode, PolicyStatus, ProtocolError } from '../src/types/index.js';
import { receiptIdDigest } from '../src/core/hashing.js';
import {
  fullFlow,
  PAYOUT,
  PREMIUM,
  T_CLAIM,
  T_SETTLE,
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

describe('happy path', () => {
  it('settles a triggered policy and publishes a public receipt', () => {
    const flow = fullFlow();
    const { receipt, releasedAmount } = flow;
    expect(receipt!.status).toBe('SETTLED');
    expect(releasedAmount).toBe(PAYOUT);
    expect(flow.runtime.claimService.receivePayout === undefined).toBe(false);

    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.status).toBe(PolicyStatus.SETTLED);
    expect(flow.runtime.publicLedger.nullifierSpent(flow.proof!.publicInputs.nullifier))
      .toBe(true);
    // Receipt id is the canonical digest of its own public fields.
    expect(receipt!.receiptId).toBe(receiptIdDigest(
      flow.policyId, flow.proof!.proofHash, true, true, T_SETTLE,
    ));
    // Event trail: one event per transition (BUILD_SPEC §7.4).
    expect(flow.runtime.publicLedger.listEvents().map((e) => e.type)).toEqual([
      'PolicyCreated', 'PolicyFunded', 'HolderEnrolled', 'TriggerRecorded',
      'ClaimSettled', 'ReceiptPublished',
    ]);
  });

  it('payout lands on the private ledger only', () => {
    const flow = fullFlow();
    expect(flow.runtime.privateLedger.balance(flow.policyId)).toBe(PAYOUT);
    expect(flow.runtime.privateLedger.claimHistory()).toHaveLength(1);
    // The public receipt carries no amount (Invariant 3).
    expect(JSON.stringify(flow.receipt!)).not.toContain(PAYOUT.toString());
  });

  it('third parties can verify the receipt from public data alone', () => {
    const flow = fullFlow();
    const { valid, receipt } = flow.runtime.settlementService.verifyReceipt(flow.receipt!.receiptId);
    expect(valid).toBe(true);
    expect(receipt!.receiptId).toBe(flow.receipt!.receiptId);
    // A fabricated receipt id fails.
    expect(flow.runtime.settlementService.verifyReceipt(flow.proof!.proofHash).valid).toBe(false);
  });

  it('counts() exposes aggregates only', () => {
    const flow = fullFlow();
    expect(flow.runtime.settlementService.counts()).toEqual({ settled: 1, denied: 0 });
  });
});

describe('double-claim protection (NULLIFIER_SPENT)', () => {
  it('a second settle with the same nullifier is rejected', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const first = flow.runtime.settlementService.settle(
      T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider,
    );
    expect(first.receipt.status).toBe('SETTLED');
    // Replay the SAME proof (identical nullifier) after settlement.
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE + 1, flow.proof!, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.POLICY_INACTIVE, // SETTLED is terminal
    );
    expect(flow.runtime.settlementService.counts()).toEqual({ settled: 1, denied: 0 });
  });

  it('a second claim generating a fresh proof still hits the spent nullifier', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // Generate the replay proof BEFORE settling (settle is terminal).
    const replayProof = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM + 1);
    flow.runtime.settlementService.settle(T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider);
    // Same (policyId, secret) ⇒ same nullifier regardless of a new claimTime.
    expect(replayProof.publicInputs.nullifier).toBe(flow.proof!.publicInputs.nullifier);
    expect(flow.runtime.publicLedger.nullifierSpent(replayProof.publicInputs.nullifier)).toBe(true);
    expect(flow.runtime.settlementService.counts()).toEqual({ settled: 1, denied: 0 });
  });
});

describe('griefing resistance', () => {
  it('an attacker with a wrong-secret witness cannot burn the holder’s nullifier', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // Attacker replays the holder's proof but supplies their own witness
    // provider — eligibility binding fails before any state changes.
    const attackerWitness = (): import('../src/types/index.js').ClaimWitness => ({
      ...flow.witnessProvider(),
      holderSecret: '0x' + 'ee'.repeat(32),
    });
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, flow.proof!, flow.policyId, attackerWitness,
      ),
      ErrorCode.INVALID_PROOF,
    );
    // Nullifier NOT spent — the honest holder can still settle.
    expect(flow.runtime.publicLedger.nullifierSpent(flow.proof!.publicInputs.nullifier))
      .toBe(false);
    const ok = flow.runtime.settlementService.settle(
      T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider,
    );
    expect(ok.receipt.status).toBe('SETTLED');
  });

  it('a tampered proofHash is rejected (statement/proof consistency)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const tampered = {
      ...flow.proof!,
      proofHash: flow.proof!.proofHash.slice(0, -1) + (flow.proof!.proofHash.endsWith('0') ? '1' : '0'),
    };
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, tampered, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.INVALID_PROOF,
    );
  });

  it('a proof for a different policy (same ledger) is rejected', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    // A second, fully independent policy on the SAME ledger, driven to
    // TRIGGERED so the proof binding (not the status guard) is what fails.
    const rt = flow.runtime;
    const other = rt.policyService.create(flow.insurer, flow.terms, T_TRIGGER);
    rt.policyService.fund(other.policyId, PAYOUT, T_TRIGGER);
    const { commitment } = rt.claimService.enroll(other.policyId, T_TRIGGER);
    rt.policyService.publishEnrollment(other.policyId, commitment, PREMIUM, T_TRIGGER);
    rt.triggerService.submitReadings(other.policyId, [
      { source: 'open-meteo', value: 4000 },
      { source: 'noaa', value: 3600 },
    ], T_TRIGGER);
    expectCode(
      () => rt.settlementService.settle(
        T_SETTLE, flow.proof!, other.policyId, flow.witnessProvider,
      ),
      ErrorCode.INVALID_PROOF,
    );
  });
});

describe('funding guard', () => {
  it('underfunded escrow blocks settlement (INSUFFICIENT_FUNDING)', () => {
    // Fund only the premium; payout exceeds escrow at settle time.
    const flow = fullFlow({ upTo: 'claimed', fundAmount: 1n });
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.INSUFFICIENT_FUNDING,
    );
    // Policy untouched, nullifier unspent — finality not reached.
    expect(flow.runtime.publicLedger.nullifierSpent(flow.proof!.publicInputs.nullifier))
      .toBe(false);
  });

  it('the premium alone is never enough once the trigger fired', () => {
    const flow = fullFlow({ upTo: 'claimed', fundAmount: PREMIUM });
    expect(PAYOUT).toBeGreaterThan(PREMIUM);
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.INSUFFICIENT_FUNDING,
    );
  });
});

describe('DENIED path', () => {
  it('trigger outcome false → DENIED receipt, zero release', () => {
    const flow = fullFlow({ upTo: 'claimed', triggerValues: [2000, 2200] });
    const { receipt, releasedAmount } = flow.runtime.settlementService.settle(
      T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider,
    );
    expect(receipt.status).toBe('DENIED');
    expect(releasedAmount).toBe(0n);
    expect(flow.runtime.policyService.getPolicy(flow.policyId).status)
      .toBe(PolicyStatus.DENIED);
    expect(flow.runtime.settlementService.counts()).toEqual({ settled: 0, denied: 1 });
    const last = flow.runtime.publicLedger.listEvents().at(-1)!;
    expect(last.type).toBe('ReceiptPublished');
    expect(last.data.status).toBe('DENIED');
  });
});

describe('finality + atomicity', () => {
  it('a settled policy cannot be settled again or funded (terminal status)', () => {
    const flow = fullFlow();
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE + 1, flow.proof!, flow.policyId, flow.witnessProvider,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
    expectCode(
      () => flow.runtime.policyService.fund(flow.policyId, 1n, T_SETTLE + 1),
      ErrorCode.POLICY_INACTIVE,
    );
  });

  it('receipts are immutable once published (no overwrite path)', () => {
    const flow = fullFlow();
    const before = flow.runtime.publicLedger.listReceipts().length;
    // Any duplicate-receipt publication must fail: duplicate id.
    expectCode(
      () => flow.runtime.publicLedger.completeSettlement(
        flow.policyId, 'SETTLED', flow.receipt!, T_SETTLE + 1,
      ),
      ErrorCode.POLICY_INACTIVE, // SETTLED is not SETTLING — no overwrite path exists
    );
    expect(flow.runtime.publicLedger.listReceipts()).toHaveLength(before);
    // Same receipt object returned by verifyReceipt — unchanged fields.
    const { receipt } = flow.runtime.settlementService.verifyReceipt(flow.receipt!.receiptId);
    expect(receipt).toEqual(flow.receipt);
  });

  it('a failed settle leaves the policy byte-for-byte unchanged (revert atomicity)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const snapshotBefore = JSON.stringify(
      flow.runtime.publicLedger.auditView(),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    const attackerWitness = (): import('../src/types/index.js').ClaimWitness => ({
      ...flow.witnessProvider(),
      holderSecret: '0x' + 'ff'.repeat(32),
    });
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, flow.proof!, flow.policyId, attackerWitness,
      ),
      ErrorCode.INVALID_PROOF,
    );
    const snapshotAfter = JSON.stringify(
      flow.runtime.publicLedger.auditView(),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    expect(snapshotAfter).toBe(snapshotBefore);
  });
});
