// Trigger cross-verification (BUILD_SPEC.md §6).
//
// A trigger is only recorded when at least two DISTINCT registered sources
// report readings whose outcome agrees under the policy's operator/threshold.
// Disagreement is fail-closed and itself public event data: a malicious
// single oracle can neither force nor suppress a payout alone.

import { ComparisonOp, ErrorCode, PolicyStatus, ProtocolError } from '../types/index.js';
import type { Bytes32, TriggerRecord, TriggerSourceReading } from '../types/index.js';
import type { PublicLedger } from '../core/publicLedger.js';
import { sourceIdDigest } from '../core/hashing.js';

export interface SourceReading {
  source: string;
  value: number;
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
   * Submit readings for a policy's trigger. Returns the recorded TriggerRecord
   * on success. Throws TRIGGER_CONFLICT (after publishing TriggerRejected)
   * when distinct sources disagree on the outcome.
   */
  submitReadings(policyId: Bytes32, readings: SourceReading[], now: number): TriggerRecord {
    const policy = this.ledger.getPolicy(policyId);
    if (policy.status !== PolicyStatus.ACTIVE) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `record trigger: status ${policy.status}`);
    }

    // Deduplicate by source; the latest reading per source wins.
    const bySource = new Map<Bytes32, TriggerSourceReading>();
    for (const reading of readings) {
      const sourceId = this.sourceId(reading.source);
      bySource.set(sourceId, { sourceId, value: reading.value });
    }
    const distinct = [...bySource.values()];
    if (distinct.length < 2) {
      throw new ProtocolError(
        ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
        `got ${distinct.length} distinct source(s), need >= 2`,
      );
    }

    const outcomes = distinct.map((r) =>
      evaluateTrigger(r.value, policy.terms.threshold, policy.terms.operator),
    );
    const allAgree = outcomes.every((o) => o === outcomes[0]);
    if (!allAgree) {
      this.ledger.rejectTrigger(policyId, 'source-disagreement', now);
      throw new ProtocolError(ErrorCode.TRIGGER_CONFLICT, 'sources disagree on outcome');
    }

    const outcome = outcomes[0]!;
    const record: TriggerRecord = {
      readings: distinct,
      outcome,
      observedValue: medianOf(distinct.map((r) => r.value)),
      recordedAt: now,
    };
    this.ledger.recordTrigger(policyId, record);
    return record;
  }
}
