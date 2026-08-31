// Shared fixtures for the protocol test suites (BUILD_SPEC.md §9).
//
// fullFlow() drives the entire Wave 1 lifecycle through the real services:
//   create → fund → enroll (client secret, commitment published, premium) →
//   2-source trigger → client-side proof → settle → public receipt.
//
// The times mirror the golden vectors pinned in tests/compactParity.test.ts
// so every suite shares one recognizable timeline.

import { createRuntime, type ConditionRuntime } from '../src/utils/midnight.js';
import { expectedPayout } from '../src/core/payout.js';
import { randomAddress } from '../src/core/hashing.js';
import {
  ComparisonOp,
  TriggerType,
  type ClaimProof,
  type ClaimWitness,
  type Dust,
  type Policy,
  type PolicyTerms,
  type TriggerRecord,
  type WitnessProvider,
} from '../src/types/index.js';

export const T0 = 1_700_000_000; // coverageStart
export const T_EXPIRY = 1_702_592_000; // T0 + 30 days
export const T_FUND = T0 + 10;
export const T_ENROLL = T0 + 20;
export const T_TRIGGER = 1_700_020_000;
export const T_CLAIM = 1_700_030_000;
export const T_SETTLE = 1_700_040_000;
export const T_PAST_EXPIRY = T_EXPIRY + 1;

export const PAYOUT: Dust = 5_000_000_000n;
export const PREMIUM: Dust = 100_000_000n;

export const SOURCE_A = 'open-meteo';
export const SOURCE_B = 'noaa';

export function makeTerms(overrides: Partial<PolicyTerms> = {}): PolicyTerms {
  return {
    triggerType: TriggerType.TEMPERATURE,
    operator: ComparisonOp.GTE,
    threshold: 3500,
    payoutAmount: PAYOUT,
    premium: PREMIUM,
    coverageStart: T0,
    expiry: T_EXPIRY,
    ...overrides,
  };
}

/** [4000, 3600] — both ≥ 3500 → trigger fires. [2000, 2200] → agreeing false. */
export type FlowStage = 'created' | 'funded' | 'enrolled' | 'triggered' | 'claimed' | 'settled';

export interface FlowOptions {
  upTo?: FlowStage;
  /** Defaults to the full payout so escrow always covers settlement. */
  fundAmount?: Dust;
  /** Default [4000, 3600] (agrees true). Use [2000, 2200] for the DENIED path. */
  triggerValues?: [number, number];
  terms?: Partial<PolicyTerms>;
}

export interface FlowResult {
  runtime: ConditionRuntime;
  insurer: string;
  policy: Policy;
  policyId: string;
  terms: PolicyTerms;
  /** Holder secret — lives ONLY on the private ledger. */
  secret: string;
  commitment: string;
  triggerRecord?: TriggerRecord;
  proof?: ClaimProof;
  witnessProvider: WitnessProvider;
  receipt?: import('../src/types/index.js').Receipt;
  releasedAmount?: Dust;
}

/**
 * Reconstructs the claimant's witness at a given time. Deterministic from
 * public state + the private secret, identical to what submitClaim consumed
 * (same claimTime ⇒ same digests) — this is how the claimant's client
 * supplies the settlement witness without ever persisting it.
 */
export function witnessAt(
  runtime: ConditionRuntime,
  policyId: string,
  claimTime: number,
): WitnessProvider {
  const policy = runtime.publicLedger.getPolicy(policyId);
  if (policy.trigger === null) {
    throw new Error('witnessAt: policy has no trigger record');
  }
  const trigger = policy.trigger;
  return (): ClaimWitness => ({
    policyId,
    holderSecret: runtime.privateLedger.secretFor(policyId),
    settlementAmount: expectedPayout(policy.terms, trigger.outcome, claimTime),
    claimTime,
    triggerEvidence: trigger,
  });
}

export function fullFlow(options: FlowOptions = {}): FlowResult {
  const {
    upTo = 'settled',
    fundAmount = PAYOUT,
    triggerValues = [4000, 3600],
    terms = {},
  } = options;

  const runtime = createRuntime();
  const insurer = randomAddress();

  const policy = runtime.policyService.create(insurer, makeTerms(terms), T0);
  if (upTo === 'created') {
    return {
      runtime, insurer, policy, policyId: policy.policyId, terms: policy.terms,
      secret: '', commitment: '',
      witnessProvider: () => witnessAt(runtime, policy.policyId, T_CLAIM)(),
    };
  }

  runtime.policyService.fund(policy.policyId, fundAmount, T_FUND);
  if (upTo === 'funded') {
    return {
      runtime, insurer, policy: runtime.policyService.getPolicy(policy.policyId),
      policyId: policy.policyId, terms: policy.terms,
      secret: '', commitment: '',
      witnessProvider: () => witnessAt(runtime, policy.policyId, T_CLAIM)(),
    };
  }

  const { commitment } = runtime.claimService.enroll(policy.policyId, T_ENROLL);
  runtime.policyService.publishEnrollment(policy.policyId, commitment, PREMIUM, T_ENROLL);
  const secret = runtime.privateLedger.secretFor(policy.policyId);
  if (upTo === 'enrolled') {
    return {
      runtime, insurer, policy: runtime.policyService.getPolicy(policy.policyId),
      policyId: policy.policyId, terms: policy.terms, secret, commitment,
      witnessProvider: () => witnessAt(runtime, policy.policyId, T_CLAIM)(),
    };
  }

  runtime.triggerService.registerSource(SOURCE_A);
  runtime.triggerService.registerSource(SOURCE_B);
  const triggerRecord = runtime.triggerService.submitReadings(
    policy.policyId,
    [
      { source: SOURCE_A, value: triggerValues[0] },
      { source: SOURCE_B, value: triggerValues[1] },
    ],
    T_TRIGGER,
  );
  if (upTo === 'triggered') {
    return {
      runtime, insurer, policy: runtime.policyService.getPolicy(policy.policyId),
      policyId: policy.policyId, terms: policy.terms, secret, commitment, triggerRecord,
      witnessProvider: witnessAt(runtime, policy.policyId, T_CLAIM),
    };
  }

  const proof = runtime.claimService.submitClaim(policy.policyId, T_CLAIM);
  const witnessProvider = witnessAt(runtime, policy.policyId, T_CLAIM);
  if (upTo === 'claimed') {
    return {
      runtime, insurer, policy: runtime.policyService.getPolicy(policy.policyId),
      policyId: policy.policyId, terms: policy.terms, secret, commitment, triggerRecord, proof,
      witnessProvider,
    };
  }

  const { receipt, releasedAmount } = runtime.settlementService.settle(
    T_SETTLE, proof, policy.policyId, witnessProvider,
  );
  runtime.claimService.receivePayout(policy.policyId, releasedAmount, receipt.timestamp);
  return {
    runtime, insurer, policy: runtime.policyService.getPolicy(policy.policyId),
    policyId: policy.policyId, terms: policy.terms, secret, commitment, triggerRecord, proof,
    witnessProvider, receipt, releasedAmount,
  };
}

// ---------------------------------------------------------------------------
// Privacy-suite utilities
// ---------------------------------------------------------------------------

/** Canonical public serializer: bigints as strings (dust), nothing else changed. */
export function serializePublic(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** Recursively collects every object key reachable from `value`. */
export function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      collectKeys(v, into);
    }
  }
  return into;
}

/** Recursively collects every leaf value (string/number/boolean) as a string. */
export function collectValues(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectValues(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) collectValues(v, into);
  } else if (value !== undefined) {
    into.add(String(value));
  }
  return into;
}
