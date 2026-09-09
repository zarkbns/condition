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
  CapabilitySecret,
  Dust,
  Policy,
  PolicyCapabilities,
  PolicyTerms,
  ProtocolEvent,
  Receipt,
  ReceiptStatus,
  TriggerRecord,
} from '../types/index.js';
import {
  insurerAuthOf,
  oracleEntryOf,
  policyIdDigest,
  settleAuthOf,
  termsDigestOf,
  triggerDigestOf,
  isBytes32,
  randomSecret,
} from './hashing.js';

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
  /**
   * Client-side capability secrets, keyed by policyId. In the on-chain
   * deployment these live in the insurer/oracle clients and never leave
   * them; the reference runtime holds the session's own copies here so the
   * flows and adversarial tests exercise the identical commitment checks.
   * This map is PRIVATE STATE — it must never appear in any public surface.
   */
  private readonly capabilities = new Map<Bytes32, PolicyCapabilities>();
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
    // Capability secrets are generated once at create and bound by their
    // commitments (H_auth / H_settle / oracle entries) — exactly what the
    // circuits check on-chain. They live ONLY in this private map and are
    // handed to the session's own clients via capabilityFor; they never
    // appear in any public surface (privacy.test.ts enforces that).
    const capabilities: PolicyCapabilities = {
      insurerSecret: randomSecret(),
      settlementSecret: randomSecret(),
      oracleSecrets: [randomSecret(), randomSecret()],
    };
    this.capabilities.set(policyId, capabilities);
    const policy: Policy = {
      policyId,
      insurer,
      terms,
      termsDigest,
      insurerAuth: insurerAuthOf(policyId, capabilities.insurerSecret),
      status: PolicyStatus.ACTIVE,
      fundedAmount: 0n,
      enrollmentCommitment: null,
      oracleRegistry: [],
      settleAuthCommit: null,
      trigger: null,
      triggerDigest: null,
      createdAt: now,
    };
    this.policies.set(policyId, policy);
    this.emit('PolicyCreated', now, {
      policyId,
      insurer,
      termsDigest,
      insurerAuth: policy.insurerAuth,
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

  /**
   * The session's own capability secrets for a policy (reference-runtime
   * stand-in for the clients' locally generated secrets). Never public.
   */
  capabilityFor(policyId: Bytes32): PolicyCapabilities {
    const caps = this.capabilities.get(policyId);
    if (!caps) {
      throw new ProtocolError(ErrorCode.POLICY_NOT_FOUND, `no capabilities for ${policyId}`);
    }
    return caps;
  }

  /** Replace a policy's capabilities (test seam for wrong-secret adversarial cases). */
  setCapabilitiesForTest(policyId: Bytes32, caps: PolicyCapabilities): void {
    if (!this.policies.has(policyId)) {
      throw new ProtocolError(ErrorCode.POLICY_NOT_FOUND, policyId);
    }
    this.capabilities.set(policyId, caps);
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

  /**
   * Register one oracle credential for a policy (insurer-gated). Mirrors
   * register_oracle1/register_oracle2: exactly two registrations, each bound
   * to (policyId, sourceId, oracleSecret); duplicates fail ALREADY_ENROLLED.
   * The credential entry is public; the secret stays client-side.
   */
  registerOracle(
    policyId: Bytes32,
    sourceId: Bytes32,
    oracleSecret: CapabilitySecret,
    now: number,
  ): Bytes32 {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.ACTIVE], 'register oracle');
    if (policy.oracleRegistry.length >= 2) {
      throw new ProtocolError(
        ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
        'oracle registry already holds two credentials',
      );
    }
    const caps = this.capabilities.get(policyId);
    // Insurer capability check — the circuit asserts insurer_auth equality.
    if (!caps || insurerAuthOf(policyId, caps.insurerSecret) !== policy.insurerAuth) {
      throw new ProtocolError(ErrorCode.UNAUTHORIZED, 'insurer capability required');
    }
    const entry = oracleEntryOf(policyId, sourceId, oracleSecret);
    if (policy.oracleRegistry.includes(entry)) {
      throw new ProtocolError(ErrorCode.ALREADY_ENROLLED, 'duplicate oracle credential');
    }
    policy.oracleRegistry.push(entry);
    this.emit('OracleRegistered', now, { policyId, oracleEntry: entry });
    return entry;
  }

  /**
   * Record a trigger from two DISTINCT registered oracle credentials whose
   * outcomes agree (fail-closed). The accepted evidence is bound into the
   * canonical trigger digest — the settlement flow re-derives it from the
   * claimant's witnesses, so substituted or reordered evidence cannot settle.
   */
  recordTrigger(
    policyId: Bytes32,
    record: TriggerRecord,
    oracleSecrets: [CapabilitySecret, CapabilitySecret],
  ): Policy {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.ACTIVE], 'record trigger');
    if (policy.oracleRegistry.length < 2) {
      throw new ProtocolError(
        ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
        'two registered oracle credentials required',
      );
    }
    const readings = record.readings;
    if (readings.length !== 2) {
      throw new ProtocolError(
        ErrorCode.TRIGGER_INSUFFICIENT_SOURCES,
        `got ${readings.length} readings, need exactly 2`,
      );
    }
    const [r1, r2] = readings;
    if (r1!.sourceId === r2!.sourceId) {
      throw new ProtocolError(ErrorCode.TRIGGER_INSUFFICIENT_SOURCES, 'sources must be distinct');
    }
    if (oracleSecrets[0] === oracleSecrets[1]) {
      throw new ProtocolError(ErrorCode.TRIGGER_INSUFFICIENT_SOURCES, 'credentials must be distinct');
    }
    // Both submitting credentials must be REGISTERED for these exact
    // (policy, source) pairs — impersonation or cross-policy reuse fails.
    const entry1 = oracleEntryOf(policyId, r1!.sourceId, oracleSecrets[0]);
    const entry2 = oracleEntryOf(policyId, r2!.sourceId, oracleSecrets[1]);
    if (!policy.oracleRegistry.includes(entry1) || !policy.oracleRegistry.includes(entry2)) {
      throw new ProtocolError(
        ErrorCode.UNAUTHORIZED,
        'submitting credentials are not the registered oracle credentials',
      );
    }
    // Outcome agreement across the two sources (the service evaluates the
    // operator per reading; the ledger re-checks the recorded evidence).
    const outcomes = readings.map((r) => evaluateTriggerValue(r.value, policy.terms));
    if (outcomes[0] !== outcomes[1]) {
      this.rejectTrigger(policyId, 'source-disagreement', record.recordedAt);
      throw new ProtocolError(ErrorCode.TRIGGER_CONFLICT, 'sources disagree on outcome');
    }
    if (record.outcome !== outcomes[0]) {
      throw new ProtocolError(ErrorCode.TRIGGER_CONFLICT, 'recorded outcome disagrees with readings');
    }
    policy.trigger = record;
    policy.triggerDigest = triggerDigestOf(policyId, record);
    policy.status = PolicyStatus.TRIGGERED;
    this.emit('TriggerRecorded', record.recordedAt, {
      policyId,
      observedValue: record.observedValue,
      outcome: record.outcome,
      sourceIds: readings.map((r) => r.sourceId),
      triggerDigest: policy.triggerDigest,
    });
    return policy;
  }

  /**
   * Authorize ONE settlement instance (by its capability commitment) to
   * finalize this policy. Insurer-gated; exactly once; TRIGGERED-only.
   */
  authorizeSettlement(policyId: Bytes32, now: number): Bytes32 {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.TRIGGERED], 'authorize settlement');
    if (policy.settleAuthCommit !== null) {
      throw new ProtocolError(ErrorCode.ALREADY_CREATED, 'settlement already authorized');
    }
    const caps = this.capabilities.get(policyId);
    if (!caps || insurerAuthOf(policyId, caps.insurerSecret) !== policy.insurerAuth) {
      throw new ProtocolError(ErrorCode.UNAUTHORIZED, 'insurer capability required');
    }
    policy.settleAuthCommit = settleAuthOf(policyId, caps.settlementSecret);
    this.emit('SettlementAuthorized', now, {
      policyId,
      settleAuthCommit: policy.settleAuthCommit,
    });
    return policy.settleAuthCommit;
  }

  /** True when the supplied settlement capability is the authorized one. */
  settlementAuthorized(policyId: Bytes32, settlementSecret: CapabilitySecret): boolean {
    const policy = this.getPolicy(policyId);
    return policy.settleAuthCommit === settleAuthOf(policyId, settlementSecret);
  }

  rejectTrigger(policyId: Bytes32, reason: string, now: number): void {
    this.getPolicy(policyId);
    this.emit('TriggerRejected', now, { policyId, reason });
  }

  /**
   * Reference-runtime settling transition. The v2 on-chain machine goes
   * TRIGGERED → SETTLED|DENIED directly (mark_settled/mark_denied from
   * TRIGGERED), so this only validates preconditions and is retained for
   * callers that want the explicit in-progress signal.
   */
  beginSettling(policyId: Bytes32, now: number): Policy {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.TRIGGERED], 'settle');
    if (policy.enrollmentCommitment === null) {
      throw new ProtocolError(ErrorCode.NOT_ENROLLED);
    }
    if (policy.trigger === null) {
      throw new ProtocolError(ErrorCode.TRIGGER_NOT_RECORDED);
    }
    return policy;
  }

  spendNullifier(nullifier: Bytes32): void {
    if (this.nullifiers.has(nullifier)) {
      throw new ProtocolError(ErrorCode.NULLIFIER_SPENT, nullifier);
    }
    this.nullifiers.add(nullifier);
  }

  /**
   * Finalize the policy after a settlement (mirrors mark_settled/mark_denied
   * + the receipt publication). SETTLEMENT-capability-gated: only the one
   * settlement instance the insurer authorized may move the policy to its
   * terminal state, so an outside party cannot brick a claimant's settle by
   * finalizing first, and the insurer cannot finalize unilaterally.
   */
  completeSettlement(
    policyId: Bytes32,
    status: ReceiptStatus,
    receipt: Receipt,
    now: number,
    settlementSecret: CapabilitySecret,
  ): Receipt {
    const policy = this.getPolicy(policyId);
    this.requireStatus(policy, [PolicyStatus.TRIGGERED], 'complete settlement');
    if (policy.enrollmentCommitment === null) {
      throw new ProtocolError(ErrorCode.NOT_ENROLLED);
    }
    if (policy.trigger === null || policy.triggerDigest === null) {
      throw new ProtocolError(ErrorCode.TRIGGER_NOT_RECORDED);
    }
    if (policy.settleAuthCommit === null) {
      throw new ProtocolError(ErrorCode.UNAUTHORIZED, 'settlement instance not authorized');
    }
    if (settleAuthOf(policyId, settlementSecret) !== policy.settleAuthCommit) {
      throw new ProtocolError(ErrorCode.UNAUTHORIZED, 'wrong settlement capability');
    }
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
    // Insurer capability gate — mirrors the withdraw circuit's insurer_auth
    // assert. Without it, anyone could close a live policy and drain escrow.
    const caps = this.capabilities.get(policyId);
    if (!caps || insurerAuthOf(policyId, caps.insurerSecret) !== policy.insurerAuth) {
      throw new ProtocolError(ErrorCode.UNAUTHORIZED, 'insurer capability required');
    }
    const terminal = [PolicyStatus.SETTLED, PolicyStatus.DENIED, PolicyStatus.EXPIRED];
    if (!terminal.includes(policy.status)) {
      throw new ProtocolError(ErrorCode.EXPIRY_REQUIRED, `status ${policy.status} not withdrawable`);
    }
    // On SETTLED the payout was released on the private ledger; the remainder
    // is derivable from public terms alone, so this leaks nothing. The clamp
    // keeps the subtraction in range when a settlement completed against
    // insufficient escrow (funded < payout) — otherwise withdraw would
    // underflow and brick the insurer's own remainder forever.
    const paidOut =
      policy.status === PolicyStatus.SETTLED
        ? policy.fundedAmount >= policy.terms.payoutAmount
          ? policy.terms.payoutAmount
          : policy.fundedAmount
        : 0n;
    const refunded = policy.fundedAmount - paidOut;
    policy.fundedAmount = 0n;
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

/** Evaluates one reading against a policy's trigger terms (operator/threshold). */
function evaluateTriggerValue(value: number, terms: PolicyTerms): boolean {
  switch (terms.operator) {
    case ComparisonOp.GT:
      return value > terms.threshold;
    case ComparisonOp.GTE:
      return value >= terms.threshold;
    case ComparisonOp.LT:
      return value < terms.threshold;
    case ComparisonOp.LTE:
      return value <= terms.threshold;
    case ComparisonOp.EQ:
      return value === terms.threshold;
  }
}
