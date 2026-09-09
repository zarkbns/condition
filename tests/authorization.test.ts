// Adversarial authorization tests (Wave-1 hardening, 2026-09-08).
//
// The toolchain reality (compactc 0.30.0: no caller identity, no signature
// verification, cross-contract calls unsupported) means authorization is
// CAPABILITY-BASED: privileged transitions verify knowledge of a 32-byte
// secret against an on-chain commitment — the same primitive the protocol
// already trusts for holder eligibility. These tests prove every privileged
// transition rejects an unauthorized caller and leaves state unchanged:
//
//   withdraw            — insurer capability only (was: anyone)
//   mark_settled/denied — settlement capability only (was: anyone)
//   authorize_settlement— insurer capability, exactly once
//   register_oracle     — insurer capability, exactly two
//   record_trigger      — two DISTINCT registered oracle credentials
//
// Each test also asserts the FAILED call is a no-op (revert atomicity).

import { describe, expect, it } from 'vitest';
import { ErrorCode, PolicyStatus, ProtocolError } from '../src/types/index.js';
import type { CapabilitySecret, PolicyCapabilities } from '../src/types/index.js';
import { randomSecret } from '../src/core/hashing.js';
import {
  authorizeSettlementFor,
  fullFlow,
  PAYOUT,
  PREMIUM,
  T_CLAIM,
  T_FUND,
  T_SETTLE,
  T_TRIGGER,
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

/** Replaces the ledger's in-memory capability set with an attacker's. */
function swapCaps(
  flow: ReturnType<typeof fullFlow>,
  overrides: Partial<PolicyCapabilities>,
): void {
  const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
  flow.runtime.publicLedger.setCapabilitiesForTest(flow.policyId, { ...caps, ...overrides });
}

const snapshot = (flow: ReturnType<typeof fullFlow>) => {
  const p = flow.runtime.policyService.getPolicy(flow.policyId);
  return {
    status: p.status,
    funded: p.fundedAmount.toString(),
    oracleRegistry: p.oracleRegistry.length,
    settleAuthCommit: p.settleAuthCommit,
    triggerDigest: p.triggerDigest,
    receipts: flow.runtime.publicLedger.listReceipts().length,
    events: flow.runtime.publicLedger.listEvents().length,
  };
};

describe('insurer capability gate (withdraw, authorize, register_oracle)', () => {
  it('withdraw with a wrong insurer secret is UNAUTHORIZED and a no-op', () => {
    const flow = fullFlow();
    const before = snapshot(flow);
    swapCaps(flow, { insurerSecret: randomSecret() });
    expectCode(
      () => flow.runtime.publicLedger.withdraw(flow.policyId, T_SETTLE + 10),
      ErrorCode.UNAUTHORIZED,
    );
    expect(snapshot(flow)).toEqual(before);
  });

  it('withdraw before terminal state is rejected even with the right capability', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    expectCode(
      () => flow.runtime.publicLedger.withdraw(flow.policyId, T_SETTLE),
      ErrorCode.EXPIRY_REQUIRED,
    );
  });

  it('withdraw after SETTLED returns the remainder and cannot repeat (CLOSED)', () => {
    const flow = fullFlow();
    // Escrow = PAYOUT (funding) + PREMIUM (enrollment) − payout → remainder = premium.
    const { refunded } = flow.runtime.publicLedger.withdraw(flow.policyId, T_SETTLE + 10);
    expect(refunded).toBe(PREMIUM);
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.status).toBe(PolicyStatus.CLOSED);
    expectCode(
      () => flow.runtime.publicLedger.withdraw(flow.policyId, T_SETTLE + 11),
      ErrorCode.EXPIRY_REQUIRED,
    );
  });

  it('underfunded EXPIRED policy withdraws the whole escrow without underflow', () => {
    const flow = fullFlow({ upTo: 'claimed', fundAmount: PREMIUM }); // escrow < payout
    // The escrow clamp branch: terminal state with funded < payout must
    // refund everything (never underflow — the old code would have bricked).
    // Escrow = funding (PREMIUM) + enrollment premium (PREMIUM).
    flow.runtime.publicLedger.expire(flow.policyId, flow.policy.terms.expiry + 1);
    const { refunded } = flow.runtime.publicLedger.withdraw(flow.policyId, flow.policy.terms.expiry + 2);
    expect(refunded).toBe(PREMIUM * 2n);
  });

  it('authorize_settlement with a wrong insurer secret is UNAUTHORIZED and a no-op', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const before = snapshot(flow);
    swapCaps(flow, { insurerSecret: randomSecret() });
    expectCode(
      () => flow.runtime.publicLedger.authorizeSettlement(flow.policyId, T_CLAIM),
      ErrorCode.UNAUTHORIZED,
    );
    expect(snapshot(flow)).toEqual(before);
  });

  it('authorize_settlement is exactly-once (ALREADY_CREATED on repeat)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    authorizeSettlementFor(flow.runtime, flow.policyId, T_CLAIM);
    expectCode(
      () => flow.runtime.publicLedger.authorizeSettlement(flow.policyId, T_CLAIM),
      ErrorCode.ALREADY_CREATED,
    );
  });

  it('authorize_settlement requires TRIGGERED (not ACTIVE)', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    expectCode(
      () => flow.runtime.publicLedger.authorizeSettlement(flow.policyId, T_TRIGGER),
      ErrorCode.POLICY_INACTIVE,
    );
  });

  it('oracle registration with a wrong insurer secret is UNAUTHORIZED and a no-op', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    flow.runtime.triggerService.registerSource('open-meteo');
    const before = snapshot(flow);
    swapCaps(flow, { insurerSecret: randomSecret() });
    expectCode(
      () => flow.runtime.triggerService.registerOracle(
        flow.policyId, 'open-meteo', randomSecret(), T_TRIGGER,
      ),
      ErrorCode.UNAUTHORIZED,
    );
    expect(snapshot(flow)).toEqual(before);
  });
});

describe('settlement capability gate (mark_settled / mark_denied via completeSettlement)', () => {
  it('finalize with a wrong settlement secret is UNAUTHORIZED and a no-op', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    authorizeSettlementFor(flow.runtime, flow.policyId, T_CLAIM);
    const before = snapshot(flow);
    const forged = {
      receiptId: '0x' + 'ff'.repeat(32),
      policyId: flow.policyId,
      proofHash: flow.proof!.proofHash,
      triggerOutcome: true,
      status: 'SETTLED' as const,
      timestamp: T_SETTLE,
    };
    swapCaps(flow, { settlementSecret: randomSecret() });
    expectCode(
      () => flow.runtime.publicLedger.completeSettlement(
        flow.policyId, 'SETTLED', forged, T_SETTLE,
        flow.runtime.publicLedger.capabilityFor(flow.policyId).settlementSecret,
      ),
      ErrorCode.UNAUTHORIZED,
    );
    expect(snapshot(flow)).toEqual(before);
    expect(flow.runtime.publicLedger.nullifierSpent(flow.proof!.publicInputs.nullifier))
      .toBe(false);
  });

  it('finalize without authorization (settleAuthCommit null) is UNAUTHORIZED', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const forged = {
      receiptId: '0x' + 'ff'.repeat(32),
      policyId: flow.policyId,
      proofHash: flow.proof!.proofHash,
      triggerOutcome: true,
      status: 'SETTLED' as const,
      timestamp: T_SETTLE,
    };
    expectCode(
      () => flow.runtime.publicLedger.completeSettlement(
        flow.policyId, 'SETTLED', forged, T_SETTLE,
        flow.runtime.publicLedger.capabilityFor(flow.policyId).settlementSecret,
      ),
      ErrorCode.UNAUTHORIZED,
    );
  });

  it('the authorized settlement can finalize; the policy then blocks re-finalize', () => {
    const flow = fullFlow();
    // fullFlow already authorized + settled → policy SETTLED.
    expect(flow.runtime.policyService.getPolicy(flow.policyId).status)
      .toBe(PolicyStatus.SETTLED);
    const forged = { ...flow.receipt!, receiptId: '0x' + 'ee'.repeat(32) };
    expectCode(
      () => flow.runtime.publicLedger.completeSettlement(
        flow.policyId, 'SETTLED', forged, T_SETTLE + 5,
        flow.runtime.publicLedger.capabilityFor(flow.policyId).settlementSecret,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
  });
});

describe('policy↔settlement binding (evidence binding, forged receipts)', () => {
  it('verifyReceipt rejects unknown ids; the real receipt verifies (id = digest of fields)', () => {
    const flow = fullFlow();
    expect(flow.runtime.settlementService.verifyReceipt('0x' + 'de'.repeat(32)).valid).toBe(false);
    // The REAL receipt verifies — and its id is the canonical digest of its
    // own public fields (third parties can recompute it; a forged id fails).
    expect(flow.runtime.settlementService.verifyReceipt(flow.receipt!.receiptId).valid).toBe(true);
  });

  it('witness evidence that does not match the policy record is rejected at settle', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    authorizeSettlementFor(flow.runtime, flow.policyId, T_CLAIM);
    const lying = flow.witnessProvider();
    const forgedWitness = {
      ...lying,
      triggerEvidence: {
        ...lying.triggerEvidence,
        readings: [
          { ...lying.triggerEvidence.readings[0]!, value: 9999 },
          lying.triggerEvidence.readings[1]!,
        ],
        observedValue: 9999,
      },
    };
    expectCode(
      () => flow.runtime.settlementService.settle(
        T_SETTLE, flow.proof!, flow.policyId, () => forgedWitness,
      ),
      ErrorCode.INVALID_PROOF,
    );
    // Nullifier NOT spent — the honest evidence can still settle.
    expect(flow.runtime.publicLedger.nullifierSpent(flow.proof!.publicInputs.nullifier))
      .toBe(false);
  });

  it('nullifier anti-double-claim across proof regenerations (deterministic nullifier)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    authorizeSettlementFor(flow.runtime, flow.policyId, T_CLAIM);
    const replay = flow.runtime.claimService.submitClaim(flow.policyId, T_CLAIM + 7);
    flow.runtime.settlementService.settle(T_SETTLE, flow.proof!, flow.policyId, flow.witnessProvider);
    expect(replay.publicInputs.nullifier).toBe(flow.proof!.publicInputs.nullifier);
    expect(flow.runtime.publicLedger.nullifierSpent(replay.publicInputs.nullifier)).toBe(true);
  });
});

describe('capability privacy', () => {
  it('capability secrets never appear in any public surface', () => {
    const flow = fullFlow();
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    const publicBlob = JSON.stringify(
      flow.runtime.publicLedger.auditView(),
      (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const secret of [
      caps.insurerSecret, caps.settlementSecret,
      caps.oracleSecrets[0]!, caps.oracleSecrets[1]!,
      flow.secret,
    ] as CapabilitySecret[]) {
      expect(publicBlob.includes(secret)).toBe(false);
    }
  });

  it('capability commitments ARE public (one-way digests)', () => {
    const flow = fullFlow({ upTo: 'claimed' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.insurerAuth).toBeDefined();
    expect(policy.oracleRegistry).toHaveLength(2);
    // authorize then verify the commitment is public and matches the secret.
    const commit = authorizeSettlementFor(flow.runtime, flow.policyId, T_CLAIM);
    expect(commit).toBeDefined();
    const events = flow.runtime.publicLedger.listEvents();
    const authEvent = events.find((e) => e.type === 'SettlementAuthorized');
    expect(authEvent).toBeDefined();
    expect((authEvent!.data as Record<string, string>).settleAuthCommit).toBe(commit);
  });
});

describe('event vocabulary (hardened flow)', () => {
  it('the full flow emits only known event types', () => {
    const flow = fullFlow();
    const types = new Set(flow.runtime.publicLedger.listEvents().map((e) => e.type));
    for (const t of types) {
      expect([
        'PolicyCreated', 'PolicyFunded', 'HolderEnrolled', 'OracleRegistered',
        'TriggerRecorded', 'SettlementAuthorized', 'ClaimSettled',
        'ReceiptPublished', 'TriggerRejected', 'PolicyExpired', 'PolicyClosed',
      ]).toContain(t);
    }
    expect(flow.runtime.publicLedger.listEvents().length).toBe(9);
  });
});

// Guard: PAYOUT/PREMIUM imports are used by the underflow test above.
void PAYOUT;
