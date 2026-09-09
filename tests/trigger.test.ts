// Trigger cross-verification (BUILD_SPEC.md §6, §9).
// 2-source rule, conflict fail-closed, dedup, median, operator semantics,
// event emission.

import { describe, expect, it } from 'vitest';
import { ComparisonOp, ErrorCode, ProtocolError, TriggerType } from '../src/types/index.js';
import { randomSecret, sourceIdDigest, triggerDigestOf } from '../src/core/hashing.js';
import {
  evaluateTrigger,
  medianOf,
  TriggerService,
} from '../src/services/triggerService.js';
import { SOURCE_A, SOURCE_B, fullFlow, makeTerms, T_TRIGGER } from './helpers.js';

// A third-party oracle operator's credentials — registered by an
// insurer-caps override, NOT the session's own set (below).
const knownA = '0x' + 'aa'.repeat(32);
const knownB = '0x' + 'bb'.repeat(32);

function secretOf(flow: ReturnType<typeof fullFlow>, source: string): string {
  void source;
  // The session's first oracle credential (the registry is the capability
  // check; the source name binding is what matters for this helper).
  return flow.runtime.publicLedger.capabilityFor(flow.policyId).oracleSecrets[0]!;
}

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

describe('operator semantics', () => {
  const cases: Array<[ComparisonOp, number, number, boolean]> = [
    [ComparisonOp.GT, 4000, 3500, true],
    [ComparisonOp.GT, 3500, 3500, false],
    [ComparisonOp.GTE, 3500, 3500, true],
    [ComparisonOp.GTE, 3499, 3500, false],
    [ComparisonOp.LT, 3400, 3500, true],
    [ComparisonOp.LT, 3500, 3500, false],
    [ComparisonOp.LTE, 3500, 3500, true],
    [ComparisonOp.LTE, 3501, 3500, false],
    [ComparisonOp.EQ, 3500, 3500, true],
    [ComparisonOp.EQ, 3501, 3500, false],
  ];
  for (const [op, value, threshold, expected] of cases) {
    it(`${op}: ${value} vs ${threshold} → ${expected}`, () => {
      expect(evaluateTrigger(value, threshold, op)).toBe(expected);
    });
  }
});

describe('median', () => {
  it('odd count → middle value', () => {
    expect(medianOf([5, 1, 9])).toBe(5);
    expect(medianOf([4000, 3600, 2000])).toBe(3600);
  });
  it('even count → lower of the two middle values (mirrors the min2 circuit)', () => {
    expect(medianOf([4000, 3600])).toBe(3600);
    expect(medianOf([1, 2])).toBe(1);
    expect(medianOf([10, 20, 30, 40])).toBe(20);
  });
  it('is order-independent', () => {
    expect(medianOf([9, 1, 5])).toBe(medianOf([1, 5, 9]));
  });
});

describe('2-source rule', () => {
  it('records a trigger when two distinct sources agree', () => {
    const flow = fullFlow({ upTo: 'triggered', triggerValues: [4000, 3600] });
    const record = flow.triggerRecord!;
    expect(record.outcome).toBe(true);
    expect(record.observedValue).toBe(3600);
    expect(record.readings).toHaveLength(2);
    // Stored order is CANONICAL (value-ascending, ties by submission order):
    // 3600 (noaa) before 4000 (open-meteo) regardless of submission order.
    expect(record.readings.map((r) => r.sourceId)).toEqual([
      sourceIdDigest(SOURCE_B),
      sourceIdDigest(SOURCE_A),
    ]);
    const events = flow.runtime.publicLedger.listEvents();
    const last = events[events.length - 1]!;
    expect(last.type).toBe('TriggerRecorded');
    expect(last.data.observedValue).toBe(3600);
    expect(last.data.outcome).toBe(true);
  });

  it('records a NEGATIVE outcome when sources agree it did not fire', () => {
    const flow = fullFlow({ upTo: 'triggered', triggerValues: [2000, 2200] });
    expect(flow.triggerRecord!.outcome).toBe(false);
    expect(flow.triggerRecord!.observedValue).toBe(2000);
    const last = flow.runtime.publicLedger.listEvents().at(-1)!;
    expect(last.type).toBe('TriggerRecorded');
    expect(last.data.outcome).toBe(false);
  });

  it('rejects a single reading (TRIGGER_INSUFFICIENT_SOURCES)', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    flow.runtime.triggerService.registerSource(SOURCE_A);
    expectCode(
      () => flow.runtime.triggerService.submitReadings(
        flow.policyId,
        [{ source: SOURCE_A, value: 4000, oracleSecret: secretOf(flow, SOURCE_A) }],
        T_TRIGGER,
      ),
      ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
    );
  });

  it('rejects duplicate readings from the SAME source (still one source)', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    flow.runtime.triggerService.registerSource(SOURCE_A);
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    expectCode(
      () => flow.runtime.triggerService.submitReadings(
        flow.policyId,
        [
          { source: SOURCE_A, value: 4000, oracleSecret: caps.oracleSecrets[0]! },
          { source: SOURCE_A, value: 4100, oracleSecret: caps.oracleSecrets[0]! },
        ],
        T_TRIGGER,
      ),
      ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
    );
  });

  it('rejects unregistered sources', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    expectCode(
      () => flow.runtime.triggerService.submitReadings(
        flow.policyId,
        [
          { source: 'unknown-feed', value: 4000, oracleSecret: caps.oracleSecrets[0]! },
          { source: 'another-feed', value: 3600, oracleSecret: caps.oracleSecrets[1]! },
        ],
        T_TRIGGER,
      ),
      ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
    );
  });

  it('exactly two registered oracle credentials — a third registration is rejected', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const svc = flow.runtime.triggerService;
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    svc.registerSource(SOURCE_A);
    svc.registerSource(SOURCE_B);
    svc.registerSource('ecmwf');
    svc.registerOracle(flow.policyId, SOURCE_A, caps.oracleSecrets[0]!, T_TRIGGER);
    svc.registerOracle(flow.policyId, SOURCE_B, caps.oracleSecrets[1]!, T_TRIGGER);
    expectCode(
      () => svc.registerOracle(flow.policyId, 'ecmwf', randomSecret(), T_TRIGGER),
      ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
    );
  });
});

describe('fail-closed on conflict (BUILD_SPEC §6)', () => {
  it('disagreement records NOTHING and publishes TriggerRejected', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    flow.runtime.triggerService.registerSource(SOURCE_A);
    flow.runtime.triggerService.registerSource(SOURCE_B);
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    expectCode(
      () => flow.runtime.triggerService.submitReadings(
        flow.policyId,
        [
          { source: SOURCE_A, value: 4000, oracleSecret: caps.oracleSecrets[0]! },
          { source: SOURCE_B, value: 2000, oracleSecret: caps.oracleSecrets[1]! }, // disagrees
        ],
        T_TRIGGER,
      ),
      ErrorCode.TRIGGER_CONFLICT,
    );
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.trigger).toBeNull(); // state untouched
    expect(policy.status).toBe('ACTIVE'); // still active
    const rejected = flow.runtime.publicLedger.listEvents().find((e) => e.type === 'TriggerRejected');
    expect(rejected).toBeDefined();
    expect(rejected!.data.reason).toBe('source-disagreement');
  });

  it('a single malicious oracle can neither force nor suppress a trigger', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const svc = flow.runtime.triggerService;
    svc.registerSource(SOURCE_A);
    svc.registerSource(SOURCE_B);
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    // Malicious A lies high (wants payout); honest B says no → conflict, fail closed.
    expectCode(
      () => svc.submitReadings(flow.policyId, [
        { source: SOURCE_A, value: 9000, oracleSecret: caps.oracleSecrets[0]! },
        { source: SOURCE_B, value: 2000, oracleSecret: caps.oracleSecrets[1]! },
      ], T_TRIGGER),
      ErrorCode.TRIGGER_CONFLICT,
    );
    // Malicious A lies low (wants to suppress); honest B says fire → conflict again.
    expectCode(
      () => svc.submitReadings(flow.policyId, [
        { source: SOURCE_A, value: 2000, oracleSecret: caps.oracleSecrets[0]! },
        { source: SOURCE_B, value: 4000, oracleSecret: caps.oracleSecrets[1]! },
      ], T_TRIGGER),
      ErrorCode.TRIGGER_CONFLICT,
    );
    // Policy remains ACTIVE with no trigger — nobody got cheated.
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.trigger).toBeNull();
    expect(flow.runtime.publicLedger.listEvents().filter((e) => e.type === 'TriggerRejected'))
      .toHaveLength(2);
  });
});

describe('oracle credential adversaries (Wave-1 hardening)', () => {
  it('impersonation: an UNREGISTERED credential cannot submit for a registered source', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const svc = flow.runtime.triggerService;
    svc.registerSource(SOURCE_A);
    svc.registerSource(SOURCE_B);
    svc.registerOracle(flow.policyId, SOURCE_A, knownA, T_TRIGGER);
    svc.registerOracle(flow.policyId, SOURCE_B, knownB, T_TRIGGER);
    // Attacker knows neither credential — submits a random one for SOURCE_A.
    expectCode(
      () => svc.submitReadings(flow.policyId, [
        { source: SOURCE_A, value: 4000, oracleSecret: randomSecret() },
        { source: SOURCE_B, value: 3600, oracleSecret: knownB },
      ], T_TRIGGER),
      ErrorCode.UNAUTHORIZED,
    );
    // Policy untouched.
    expect(flow.runtime.policyService.getPolicy(flow.policyId).trigger).toBeNull();
  });

  it('credential replay across policies: policy B cannot use policy A oracle secrets', () => {
    const flowA = fullFlow({ upTo: 'enrolled' });
    // Register + record the trigger on policy A with its own credentials.
    flowA.runtime.triggerService.registerSource(SOURCE_A);
    flowA.runtime.triggerService.registerSource(SOURCE_B);
    const capsA = flowA.runtime.publicLedger.capabilityFor(flowA.policyId);
    flowA.runtime.triggerService.registerOracle(flowA.policyId, SOURCE_A, capsA.oracleSecrets[0]!, T_TRIGGER);
    flowA.runtime.triggerService.registerOracle(flowA.policyId, SOURCE_B, capsA.oracleSecrets[1]!, T_TRIGGER);
    flowA.runtime.triggerService.submitReadings(flowA.policyId, [
      { source: SOURCE_A, value: 4000, oracleSecret: capsA.oracleSecrets[0]! },
      { source: SOURCE_B, value: 3600, oracleSecret: capsA.oracleSecrets[1]! },
    ], T_TRIGGER);

    // Policy B (fresh instance, same service/ledger? no — fresh runtime) tries
    // to submit A's credentials for B's registry.
    const flowB = fullFlow({ upTo: 'enrolled' });
    const svcB = flowB.runtime.triggerService;
    svcB.registerSource(SOURCE_A);
    svcB.registerSource(SOURCE_B);
    svcB.registerOracle(flowB.policyId, SOURCE_A, knownA, T_TRIGGER);
    svcB.registerOracle(flowB.policyId, SOURCE_B, knownB, T_TRIGGER);
    expectCode(
      () => svcB.submitReadings(flowB.policyId, [
        { source: SOURCE_A, value: 4000, oracleSecret: capsA.oracleSecrets[0]! },
        { source: SOURCE_B, value: 3600, oracleSecret: capsA.oracleSecrets[1]! },
      ], T_TRIGGER),
      ErrorCode.UNAUTHORIZED,
    );
  });

  it('duplicate credential identity: the same secret for both sources is rejected', () => {
    const flow = fullFlow({ upTo: 'enrolled' });
    const svc = flow.runtime.triggerService;
    svc.registerSource(SOURCE_A);
    svc.registerSource(SOURCE_B);
    svc.registerOracle(flow.policyId, SOURCE_A, knownA, T_TRIGGER);
    svc.registerOracle(flow.policyId, SOURCE_B, knownB, T_TRIGGER);
    // One actor submits both readings with the SAME credential — that is a
    // single oracle masquerading as two.
    expectCode(
      () => svc.submitReadings(flow.policyId, [
        { source: SOURCE_A, value: 4000, oracleSecret: knownA },
        { source: SOURCE_B, value: 3600, oracleSecret: knownA },
      ], T_TRIGGER),
      ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
    );
  });

  it('the trigger digest binds the accepted evidence (canonical order, both readings)', () => {
    const flow = fullFlow({ upTo: 'triggered', triggerValues: [4000, 3600] });
    const policy = flow.runtime.policyService.getPolicy(flow.policyId);
    expect(policy.triggerDigest).toBeDefined();
    expect(policy.triggerDigest).toBe(triggerDigestOf(flow.policyId, policy.trigger!));
  });
});

describe('source registry', () => {
  it('source ids are domain-separated and deterministic', () => {
    const flow = fullFlow({ upTo: 'created' });
    const svc = new TriggerService(flow.runtime.publicLedger);
    const id1 = svc.registerSource('open-meteo');
    expect(id1).toBe(sourceIdDigest('open-meteo'));
    expect(svc.isRegistered('open-meteo')).toBe(true);
    expect(svc.isRegistered('noaa')).toBe(false);
    expect(id1).not.toBe(svc.registerSource('noaa'));
  });

  it('re-registering is idempotent (same id, no error)', () => {
    const flow = fullFlow({ upTo: 'created' });
    const svc = new TriggerService(flow.runtime.publicLedger);
    const first = svc.registerSource('ecmwf');
    const second = svc.registerSource('ecmwf');
    expect(first).toBe(second);
  });
});

describe('trigger preconditions', () => {
  it('trigger on a non-ACTIVE policy → POLICY_INACTIVE', () => {
    const flow = fullFlow({ upTo: 'triggered' });
    flow.runtime.triggerService.registerSource(SOURCE_A);
    flow.runtime.triggerService.registerSource(SOURCE_B);
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    expectCode(
      () => flow.runtime.triggerService.submitReadings(
        flow.policyId,
        [
          { source: SOURCE_A, value: 4000, oracleSecret: caps.oracleSecrets[0]! },
          { source: SOURCE_B, value: 3600, oracleSecret: caps.oracleSecrets[1]! },
        ],
        T_TRIGGER + 1,
      ),
      ErrorCode.POLICY_INACTIVE,
    );
  });

  it('trigger on unknown policy → POLICY_NOT_FOUND', () => {
    const flow = fullFlow({ upTo: 'created' });
    const svc = new TriggerService(flow.runtime.publicLedger);
    svc.registerSource(SOURCE_A);
    svc.registerSource(SOURCE_B);
    expectCode(
      () => svc.submitReadings(
        '0x' + '00'.repeat(32),
        [
          { source: SOURCE_A, value: 4000, oracleSecret: randomSecret() },
          { source: SOURCE_B, value: 3600, oracleSecret: randomSecret() },
        ],
        T_TRIGGER,
      ),
      ErrorCode.POLICY_NOT_FOUND,
    );
  });

  it('boundary readings follow the operator exactly (GTE at threshold)', () => {
    const flow = fullFlow({
      upTo: 'enrolled',
      terms: { threshold: 3500, operator: ComparisonOp.GTE },
    });
    flow.runtime.triggerService.registerSource(SOURCE_A);
    flow.runtime.triggerService.registerSource(SOURCE_B);
    const caps = flow.runtime.publicLedger.capabilityFor(flow.policyId);
    flow.runtime.triggerService.registerOracle(flow.policyId, SOURCE_A, caps.oracleSecrets[0]!, T_TRIGGER);
    flow.runtime.triggerService.registerOracle(flow.policyId, SOURCE_B, caps.oracleSecrets[1]!, T_TRIGGER);
    const record = flow.runtime.triggerService.submitReadings(
      flow.policyId,
      [
        { source: SOURCE_A, value: 3500, oracleSecret: caps.oracleSecrets[0]! },
        { source: SOURCE_B, value: 3500, oracleSecret: caps.oracleSecrets[1]! },
      ],
      T_TRIGGER,
    );
    expect(record.outcome).toBe(true); // exactly at threshold, GTE fires
  });
});
