// Reference public ledger (BUILD_SPEC.md §3.2, §4.1, §7.4).
//
// This is what `policy.compact` + `settlement.compact` enforce on-chain:
// the policy state machine, escrow accounting, the nullifier registry, and
// the append-only public event trail. It contains ONLY public data — the
// privacy test suite serializes everything this module can produce and fails
// on any private field or value.

import {
  ComparisonOp,
  ErrorCode,
  PolicyStatus,
  ProtocolError,
  TriggerType,
} from '../types/index.js';
import type {
  Address,
  Bytes32,
  Dust,
  Policy,
  PolicyTerms,
  ProtocolEvent,
  Receipt,
  ReceiptStatus,
  TriggerRecord,
} from '../types/index.js';
import { policyIdDigest, termsDigestOf, isBytes32 } from './hashing.js';

export interface PublicAuditView {
  policies: Policy[];
  receipts: Receipt[];
  nullifiers: Bytes32[];
  events: ProtocolEvent[];
}

export class PublicLedger {
  private readonly policies = new Map<Bytes32, Policy>();
  private readonly receipts = new Map<Bytes32, Receipt>();
  private readonly nullifiers = new Set<Bytes32>();
  private readonly eventLog: ProtocolEvent[] = [];
  private seq = 0;
  private nonce = 0;

  // -- reads ---------------------------------------------------------------

  getPolicy(policyId: Bytes32): Policy {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new ProtocolError(ErrorCode.POLICY_NOT_FOUND, policyId);
    }
    return policy;
  }

  hasPolicy(policyId: Bytes32): boolean {
    return this.policies.has(policyId);
  }

  getReceipt(receiptId: Bytes32): Receipt {
    const receipt = this.receipts.get(receiptId);
    if (!receipt) {
      throw new ProtocolError(ErrorCode.POLICY_NOT_FOUND, `receipt ${receiptId}`);
    }
    return receipt;
  }

  listPolicies(): Policy[] {
    return [...this.policies.values()];
  }

  listReceipts(): Receipt[] {
    return [...this.receipts.values()];
  }

  listEvents(): ProtocolEvent[] {
    return [...this.eventLog];
  }

  nullifierSpent(nullifier: Bytes32): boolean {
    return this.nullifiers.has(nullifier);
  }

  /** Full public audit view — everything an outside observer can ever see. */
  auditView(): PublicAuditView {
    return {
      policies: this.listPolicies(),
      receipts: this.listReceipts(),
      nullifiers: [...this.nullifiers],
      events: this.listEvents(),
    };
  }

  // -- policy lifecycle ------------------------------------------------------

  createPolicy(insurer: Address, terms: PolicyTerms, now: number): Policy {
    validateTerms(terms);
    if (!isBytes32(insurer)) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, 'insurer must be a Bytes32 address');
    }
    const policyId = policyIdDigest(insurer, this.nonce++);
    const termsDigest = termsDigestOf(policyId, terms);
    if (this.policies.has(policyId)) {
      throw new ProtocolError(ErrorCode.ALREADY_CREATED);
    }
    const policy: Policy = {
      policyId,
      insurer,
      terms,
      termsDigest,
      status: PolicyStatus.ACTIVE,
      fundedAmount: 0n,
      enrollmentCommitment: null,
      trigger: null,
      createdAt: now,
    };
    this.policies.set(policyId, policy);
    this.emit('PolicyCreated', now, {
      policyId,
      insurer,
      termsDigest,
      triggerType: terms.triggerType,
      operator: terms.operator,
      threshold: terms.threshold,
      payoutAmount: terms.payoutAmount.toString(),
      premium: terms.premium.toString(),
      coverageStart: terms.coverageStart,
      expiry: terms.expiry,
    });
    return policy;
  }

  fund(policyId: Bytes32, amount: Dust, now: number): Policy {
    if (amount <= 0n) {
      throw new ProtocolError(ErrorCode.INSUFFICIENT_FUNDING, 'fund amount must be positive');
    }
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.ACTIVE, PolicyStatus.TRIGGERED], 'fund');
    policy.fundedAmount += amount;
    this.emit('PolicyFunded', now, {
      policyId,
      amount: amount.toString(),
      fundedAmount: policy.fundedAmount.toString(),
    });
    return policy;
  }

  enrollHolder(policyId: Bytes32, commitment: Bytes32, premiumPaid: Dust, now: number): Policy {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.ACTIVE], 'enroll');
    if (policy.enrollmentCommitment !== null) {
      throw new ProtocolError(ErrorCode.ALREADY_ENROLLED);
    }
    if (premiumPaid < policy.terms.premium) {
      throw new ProtocolError(ErrorCode.PREMIUM_REQUIRED, `paid ${premiumPaid} < premium ${policy.terms.premium}`);
    }
    policy.enrollmentCommitment = commitment;
    policy.fundedAmount += premiumPaid;
    this.emit('HolderEnrolled', now, {
      policyId,
      enrollmentCommitment: commitment,
    });
    return policy;
  }

  recordTrigger(policyId: Bytes32, record: TriggerRecord): Policy {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.ACTIVE], 'record trigger');
    policy.trigger = record;
    policy.status = PolicyStatus.TRIGGERED;
    this.emit('TriggerRecorded', record.recordedAt, {
      policyId,
      observedValue: record.observedValue,
      outcome: record.outcome,
      sourceIds: record.readings.map((r) => r.sourceId),
    });
    return policy;
  }

  rejectTrigger(policyId: Bytes32, reason: string, now: number): void {
    this.getPolicy(policyId);
    this.emit('TriggerRejected', now, { policyId, reason });
  }

  beginSettling(policyId: Bytes32, now: number): Policy {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.TRIGGERED, PolicyStatus.SETTLING], 'settle');
    if (policy.enrollmentCommitment === null) {
      throw new ProtocolError(ErrorCode.NOT_ENROLLED);
    }
    if (policy.trigger === null) {
      throw new ProtocolError(ErrorCode.TRIGGER_NOT_RECORDED);
    }
    policy.status = PolicyStatus.SETTLING;
    return policy;
  }

  spendNullifier(nullifier: Bytes32): void {
    if (this.nullifiers.has(nullifier)) {
      throw new ProtocolError(ErrorCode.NULLIFIER_SPENT, nullifier);
    }
    this.nullifiers.add(nullifier);
  }

  completeSettlement(
    policyId: Bytes32,
    status: ReceiptStatus,
    receipt: Receipt,
    now: number,
  ): Receipt {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.SETTLING], 'complete settlement');
    if (this.receipts.has(receipt.receiptId)) {
      throw new ProtocolError(ErrorCode.ALREADY_CREATED, `duplicate receipt ${receipt.receiptId}`);
    }
    policy.status = status === 'SETTLED' ? PolicyStatus.SETTLED : PolicyStatus.DENIED;
    this.receipts.set(receipt.receiptId, receipt);
    this.emit(
      status === 'SETTLED' ? 'ClaimSettled' : 'ClaimDenied',
      now,
      { policyId, receiptId: receipt.receiptId },
    );
    this.emit('ReceiptPublished', receipt.timestamp, {
      receiptId: receipt.receiptId,
      policyId,
      proofHash: receipt.proofHash,
      triggerOutcome: receipt.triggerOutcome,
      status: receipt.status,
      timestamp: receipt.timestamp,
    });
    return receipt;
  }

  /** Lazy expiry: flips any pre-terminal policy past its expiry to EXPIRED. */
  refreshExpiry(policyId: Bytes32, now: number): Policy {
    const policy = this.getPolicy(policyId);
    const preTerminal = [
      PolicyStatus.ACTIVE,
      PolicyStatus.TRIGGERED,
      PolicyStatus.SETTLING,
    ];
    if (preTerminal.includes(policy.status) && now > policy.terms.expiry) {
      policy.status = PolicyStatus.EXPIRED;
      this.emit('PolicyExpired', now, { policyId });
    }
    return policy;
  }

  expire(policyId: Bytes32, now: number): Policy {
    const policy = this.getPolicy(policyId);
    const preTerminal = [
      PolicyStatus.ACTIVE,
      PolicyStatus.TRIGGERED,
      PolicyStatus.SETTLING,
    ];
    if (!preTerminal.includes(policy.status)) {
      throw new ProtocolError(ErrorCode.EXPIRY_REQUIRED, `status ${policy.status} not expirable`);
    }
    if (now <= policy.terms.expiry) {
      throw new ProtocolError(ErrorCode.EXPIRY_REQUIRED, 'not yet expired');
    }
    policy.status = PolicyStatus.EXPIRED;
    this.emit('PolicyExpired', now, { policyId });
    return policy;
  }

  /** Insurer withdraws the unclaimed escrow remainder after terminal state. */
  withdraw(policyId: Bytes32, now: number): { refunded: Dust; policy: Policy } {
    const policy = this.getPolicy(policyId);
    const terminal = [PolicyStatus.SETTLED, PolicyStatus.DENIED, PolicyStatus.EXPIRED];
    if (!terminal.includes(policy.status)) {
      throw new ProtocolError(ErrorCode.EXPIRY_REQUIRED, `status ${policy.status} not withdrawable`);
    }
    // On SETTLED the payout was released on the private ledger; the remainder
    // is derivable from public terms alone, so this leaks nothing.
    const paidOut = policy.status === PolicyStatus.SETTLED ? policy.terms.payoutAmount : 0n;
    const refunded = policy.fundedAmount - paidOut;
    policy.status = PolicyStatus.CLOSED;
    this.emit('PolicyClosed', now, { policyId, refundedAmount: refunded.toString() });
    return { refunded, policy };
  }

  // -- internals -------------------------------------------------------------

  private requireStatus(policy: Policy, allowed: PolicyStatus[], op: string): void {
    if (!allowed.includes(policy.status)) {
      throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `${op}: status ${policy.status}`);
    }
  }

  private emit(
    type: ProtocolEvent['type'],
    timestamp: number,
    data: ProtocolEvent['data'],
    policyId?: Bytes32,
  ): void {
    const event: ProtocolEvent = {
      seq: this.seq++,
      type,
      timestamp,
      data,
      policyId: (data.policyId as Bytes32 | undefined) ?? policyId,
    };
    this.eventLog.push(event);
  }
}

export function validateTerms(terms: PolicyTerms): void {
  if (!Object.values(TriggerType).includes(terms.triggerType)) {
    throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `unknown trigger type ${terms.triggerType}`);
  }
  if (!Object.values(ComparisonOp).includes(terms.operator)) {
    throw new ProtocolError(ErrorCode.POLICY_INACTIVE, `unknown operator ${terms.operator}`);
  }
  if (!Number.isInteger(terms.threshold)) {
    throw new ProtocolError(ErrorCode.POLICY_INACTIVE, 'threshold must be an integer (scaled x100)');
  }
  if (terms.payoutAmount <= 0n) {
    throw new ProtocolError(ErrorCode.INSUFFICIENT_FUNDING, 'payout must be positive');
  }
  if (terms.premium < 0n) {
    throw new ProtocolError(ErrorCode.INSUFFICIENT_FUNDING, 'premium must be non-negative');
  }
  if (terms.coverageStart >= terms.expiry) {
    throw new ProtocolError(ErrorCode.POLICY_INACTIVE, 'coverageStart must precede expiry');
  }
}
