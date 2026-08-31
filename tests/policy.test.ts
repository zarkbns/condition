// Policy lifecycle (BUILD_SPEC.md §4.1, §9).
// Creation, terms digest stability, funding, enrollment + premium escrow,
// expiry, withdrawal, invalid transitions.

import { describe, expect, it } from 'vitest';
import type { ConditionRuntime } from '../src/utils/midnight.js';
import type { Policy } from '../src/types/index.js';
import {
  ComparisonOp,
  ErrorCode,
  PolicyStatus,
  ProtocolError,
  TriggerType,
} from '../src/types/index.js';
import { termsDigestOf, randomAddress, randomSecret } from '../src/core/hashing.js';
import {
  fullFlow,
  makeTerms,
  PAYOUT,
  PREMIUM,
  T0,
  T_ENROLL,
  T_EXPIRY,
  T_FUND,
  T_PAST_EXPIRY,
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

describe('policy creation', () => {
  it('creates an ACTIVE policy with a deterministic terms digest', () => {
    const { runtime, policy, insurer } = fullFlow({ upTo: 'created' });
    expect(policy.status).toBe(PolicyStatus.ACTIVE);
    expect(policy.fundedAmount).toBe(0n);
    expect(policy.enrollmentCommitment).toBeNull();
    expect(policy.termsDigest).toBe(termsDigestOf(policy.policyId, policy.terms));
    expect(policy.insurer).toBe(insurer);
    expect(runtime.publicLedger.listEvents().map((e) => e.type)).toEqual(['PolicyCreated']);
  });

  it('two policies by the same insurer get distinct ids (nonce diversification)', () => {
    const { runtime, insurer } = fullFlow({ upTo: 'created' });
    const second = runtime.policyService.create(insurer, makeTerms(), T0);
    const first = runtime.policyService.listPolicies()[0]!;
    expect(second.policyId).not.toBe(first.policyId);
  });

  it('rejects invalid terms', () => {
    const { runtime, insurer } = fullFlow({ upTo: 'created' });
    expectCode(
      () => runtime.policyService.create(insurer, makeTerms({ payoutAmount: 0n }), T0),
      ErrorCode.INSUFFICIENT_FUNDING,
    );
    expectCode(
      () => runtime.policyService.create(insurer, makeTerms({ premium: -1n }), T0),
      ErrorCode.INSUFFICIENT_FUNDING,
    );
    expectCode(
      () => runtime.policyService.create(insurer, makeTerms({ threshold: 35.5 }), T0),
      ErrorCode.POLICY_INACTIVE,
    );
    expectCode(
      () => runtime.policyService.create(
        insurer,
        makeTerms({ coverageStart: T_EXPIRY, expiry: T0 }),
        T0,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
    expectCode(
      () => runtime.policyService.create(
        insurer,
        makeTerms({ triggerType: 'HUMIDITY' as TriggerType }),
        T0,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
    expectCode(
      () => runtime.policyService.create(
        insurer,
        makeTerms({ operator: 'WITHIN' as ComparisonOp }),
        T0,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
  });

  it('unknown policy id → POLICY_NOT_FOUND', () => {
    const { runtime } = fullFlow({ upTo: 'created' });
    expectCode(() => runtime.policyService.getPolicy(randomSecret()), ErrorCode.POLICY_NOT_FOUND);
  });
});

describe('terms immutability (Invariant 5)', () => {
  it('terms digest never changes across the entire lifecycle', () => {
    const flow = fullFlow(); // all the way through settlement
    const policy = runtimePolicy(flow);
    expect(policy.termsDigest).toBe(flow.policy.termsDigest);
    expect(policy.termsDigest).toBe(termsDigestOf(flow.policyId, flow.terms));
    expect(policy.terms.threshold).toBe(3500);
    expect(policy.terms.payoutAmount).toBe(PAYOUT);
  });

  it('terms digest binds every field — any change yields a different digest', () => {
    const base = makeTerms();
    const variants = [
      makeTerms({ threshold: 3501 }),
      makeTerms({ payoutAmount: PAYOUT + 1n }),
      makeTerms({ premium: PREMIUM + 1n }),
      makeTerms({ expiry: T_EXPIRY + 1 }),
      makeTerms({ operator: ComparisonOp.GT }),
      makeTerms({ triggerType: TriggerType.RAINFALL_MM }),
    ];
    const digests = new Set(variants.map((t) => termsDigestOf('0x' + '00'.repeat(32), t)));
    expect(digests.size).toBe(variants.length);
  });
});

describe('funding', () => {
  it('accumulates escrow and emits PolicyFunded', () => {
    const { runtime, policyId } = fullFlow({ upTo: 'funded', fundAmount: PAYOUT });
    const policy = runtime.policyService.getPolicy(policyId);
    expect(policy.fundedAmount).toBe(PAYOUT);
    const events = runtime.publicLedger.listEvents();
    expect(events.map((e) => e.type)).toEqual(['PolicyCreated', 'PolicyFunded']);
  });

  it('rejects zero/negative funding and unknown policies', () => {
    const { runtime, policyId } = fullFlow({ upTo: 'funded' });
    expectCode(() => runtime.policyService.fund(policyId, 0n, T_FUND), ErrorCode.INSUFFICIENT_FUNDING);
    expectCode(
      () => runtime.policyService.fund(randomSecret(), 1n, T_FUND),
      ErrorCode.POLICY_NOT_FOUND,
    );
  });

  it('funding is allowed while ACTIVE or TRIGGERED, not after settlement', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    flow.runtime.policyService.fund(flow.policyId, 1n, T_TRIGGER + 1); // TRIGGERED: ok
    const settled = fullFlow();
    expectCode(
      () => settled.runtime.policyService.fund(settled.policyId, 1n, T_TRIGGER),
      ErrorCode.POLICY_INACTIVE,
    );
  });
});

describe('enrollment', () => {
  it('publishes only the commitment; premium is escrowed', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.enrollmentCommitment).toBe(flow.commitment);
    expect(policy.fundedAmount).toBe(PAYOUT + PREMIUM);
    expect(flow.commitment).not.toBe(flow.secret); // one-way
    const events = flow.runtime.publicLedger.listEvents().map((e) => e.type);
    expect(events).toEqual(['PolicyCreated', 'PolicyFunded', 'HolderEnrolled']);
  });

  it('requires the premium to be paid', () => {
    const flow = fullFlow({ upTo: 'funded' });
    expectCode(
      () => flow.runtime.policyService.publishEnrollment(
        flow.policyId, flow.runtime.claimService.enroll(flow.policyId, T_ENROLL).commitment,
        PREMIUM - 1n, T_ENROLL,
      ),
      ErrorCode.PREMIUM_REQUIRED,
    );
  });

  it('rejects double enrollment (Wave 1 single holder)', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    expectCode(
      () => flow.runtime.claimService.enroll(flow.policyId, T_ENROLL + 1),
      ErrorCode.ALREADY_ENROLLED,
    );
    expectCode(
      () => flow.runtime.policyService.publishEnrollment(
        flow.policyId, randomSecret(), PREMIUM, T_ENROLL,
      ),
      ErrorCode.ALREADY_ENROLLED,
    );
  });
});

describe('expiry and withdrawal', () => {
  it('lazily expires pre-terminal policies past their window', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const policy = flow.runtime.policyService.expire(flow.policyId, T_PAST_EXPIRY);
    expect(policy.status).toBe(PolicyStatus.EXPIRED);
    const types = flow.runtime.publicLedger.listEvents().map((e) => e.type);
    expect(types).toContain('PolicyExpired');
  });

  it('expire() before the window closes → EXPIRY_REQUIRED', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    expectCode(
      () => flow.runtime.policyService.expire(flow.policyId, T_TRIGGER),
      ErrorCode.EXPIRY_REQUIRED,
    );
  });

  it('withdrawal only from terminal states, returns the unclaimed remainder', () => {
    // Expired without trigger: insurer gets everything back (premium included).
    const expired = fullFlow({ upTo: 'enrolled' });
    expired.runtime.policyService.expire(expired.policyId, T_PAST_EXPIRY);
    const { refunded, policy } = expired.runtime.policyService.withdraw(
      expired.policyId, T_PAST_EXPIRY + 1,
    );
    expect(refunded).toBe(PAYOUT + PREMIUM);
    expect(policy.status).toBe(PolicyStatus.CLOSED);

    // Settled: remainder is escrow minus payout (both public → derivable).
    const settled = fullFlow();
    const { refunded: r2, policy: p2 } = settled.runtime.policyService.withdraw(
      settled.policyId!, T_SETTLE + 1,
    );
    expect(r2).toBe(PREMIUM);
    expect(p2.status).toBe(PolicyStatus.CLOSED);
  });

  it('withdrawal before a terminal state → EXPIRY_REQUIRED', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    expectCode(
      () => flow.runtime.policyService.withdraw(flow.policyId, T_TRIGGER + 1),
      ErrorCode.EXPIRY_REQUIRED,
    );
  });
});

function runtimePolicy(flow: { runtime: ConditionRuntime; policyId: string }): Policy {
  return flow.runtime.publicLedger.getPolicy(flow.policyId);
}
