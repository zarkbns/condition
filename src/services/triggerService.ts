// Trigger cross-verification (BUILD_SPEC.md §6, Wave-1 hardened).
//
// A trigger is only recorded when two DISTINCT sources backed by two
// DISTINCT REGISTERED oracle credentials report readings whose outcome agrees
// under the policy's operator/threshold. Disagreement is fail-closed and
// itself public event data: a malicious single oracle can neither force nor
// suppress a payout alone, and an unregistered impostor (or a credential
// from another policy) can never submit at all.
//
// The accepted evidence is canonicalized (value-ascending, ties by submission
// order) and bound into the policy's canonical trigger digest — mirrored into
// the settlement instance and re-derived from the claimant's witnesses at
// settle time, so substituted or reordered evidence cannot settle.

import { ComparisonOp, ErrorCode, PolicyStatus, ProtocolError } from '../types/index.js';
import type {
  Bytes32,
  CapabilitySecret,
  TriggerRecord,
  TriggerSourceReading,
} from '../types/index.js';
import type { PublicLedger } from '../core/publicLedger.js';
import { sourceIdDigest } from '../core/hashing.js';

export interface SourceReading {
  source: string;
  value: number;
}

/** One oracle's submission: its registered source and its client-side credential secret. */
export interface OracleSubmission {
  source: string;
  value: number;
  /** The oracle's credential secret for THIS policy (H binds policy+source+secret). */
  oracleSecret: CapabilitySecret;
}

export function evaluateTrigger(value: number, threshold: number, operator: ComparisonOp): boolean {
  switch (operator) {
    case ComparisonOp.GT:
      return value > threshold;
    case ComparisonOp.GTE:
      return value >= threshold;
    case ComparisonOp.LT:
      return value < threshold;
    case ComparisonOp.LTE:
      return value <= threshold;
    case ComparisonOp.EQ:
      return value === threshold;
  }
}

/**
 * Median of agreeing readings. Even counts take the LOWER of the two middle
 * values — division-free and identical to the `min2` circuit in
 * policy.compact (Compact has no integer division), so both layers hash the
 * same observed value into the witness digest.
 */
export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return sorted[mid - 1]!;
}

export class TriggerService {
  private readonly sources = new Map<string, Bytes32>();

  constructor(private readonly ledger: PublicLedger) {}

  registerSource(name: string): Bytes32 {
    const id = sourceIdDigest(name);
    this.sources.set(name, id);
    return id;
  }

  isRegistered(name: string): boolean {
    return this.sources.has(name);
  }

  sourceId(name: string): Bytes32 {
    const id = this.sources.get(name);
    if (!id) {
      throw new ProtocolError(ErrorCode.TRIGGER_INSUFFICIENT_SOURCES, `unregistered source: ${name}`);
    }
    return id;
  }

  /**
   * Register an oracle credential for a policy (insurer-gated in the ledger,
   * mirroring register_oracle1/2). Exactly two per policy.
   */
  registerOracle(
    policyId: Bytes32,
    source: string,
    oracleSecret: CapabilitySecret,
    now: number,
  ): Bytes32 {
    return this.ledger.registerOracle(policyId, this.sourceId(source), oracleSecret, now);
  }

  /**
   * Submit readings for a policy's trigger. Every submission carries its
   * oracle credential secret; both credentials must be the REGISTERED ones
   * for this exact policy and source pair. Returns the recorded
   * TriggerRecord (readings canonicalized value-ascending) on success.
   * Throws TRIGGER_CONFLICT (after publishing TriggerRejected) when distinct
   * sources disagree on the outcome.
   */
  submitReadings(
    policyId: Bytes32,
    submissions: OracleSubmission[],
    now: number,
  ): TriggerRecord {
    if (submissions.length !== 2) {
      throw new ProtocolError(
        ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
        `got ${submissions.length} submissions, need exactly 2`,
      );
    }
    const readings: TriggerSourceReading[] = submissions.map((s) => ({
      sourceId: this.sourceId(s.source),
      value: s.value,
    }));
    const secrets: [CapabilitySecret, CapabilitySecret] = [
      submissions[0]!.oracleSecret,
      submissions[1]!.oracleSecret,
    ];

    const policy = this.ledger.getPolicy(policyId);
    if (policy.status !== PolicyStatus.ACTIVE) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `record trigger: status ${policy.status}`);
    }
    const outcomes = readings.map((r) =>
      evaluateTrigger(r.value, policy.terms.threshold, policy.terms.operator),
    );
    if (outcomes[0] !== outcomes[1]) {
      this.ledger.rejectTrigger(policyId, 'source-disagreement', now);
      throw new ProtocolError(ErrorCode.TRIGGER_CONFLICT, 'sources disagree on outcome');
    }

    // Canonicalize the READING+SECRET pairs together (value-ascending, ties
    // by submission order): the stored record's reading order — and
    // therefore the canonical trigger digest — is independent of submission
    // order, and each credential stays bound to its own reading.
    const paired = readings
      .map((reading, i) => ({ reading, secret: secrets[i]! }))
      .sort((a, b) => a.reading.value - b.reading.value);
    const record: TriggerRecord = {
      readings: [paired[0]!.reading, paired[1]!.reading],
      outcome: outcomes[0]!,
      observedValue: medianOf(readings.map((r) => r.value)),
      recordedAt: now,
    };
    this.ledger.recordTrigger(
      policyId,
      record,
      [paired[0]!.secret, paired[1]!.secret],
    );
    return record;
  }
}
