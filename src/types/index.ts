// Condition — shared domain model (BUILD_SPEC.md §4).
// Single source of truth for the TypeScript side; mirrors the Compact contracts.

/** 32-byte digest, 0x-prefixed 64-char hex. */
export type Bytes32 = string;

/** Account address (reference runtime: opaque string id). */
export type Address = string;

/** Amounts are dust (1e-9 tDUST) held as bigint. */
export type Dust = bigint;

export enum TriggerType {
  TEMPERATURE = 'TEMPERATURE',
  RAINFALL_MM = 'RAINFALL_MM',
  FLIGHT_DELAY_MIN = 'FLIGHT_DELAY_MIN',
  EARTHQUAKE_MAG = 'EARTHQUAKE_MAG',
}

export enum ComparisonOp {
  GT = 'GT',
  GTE = 'GTE',
  LT = 'LT',
  LTE = 'LTE',
  EQ = 'EQ',
}

export enum PolicyStatus {
  ACTIVE = 'ACTIVE',
  TRIGGERED = 'TRIGGERED',
  SETTLING = 'SETTLING',
  SETTLED = 'SETTLED',
  DENIED = 'DENIED',
  EXPIRED = 'EXPIRED',
  CLOSED = 'CLOSED',
}

export interface PolicyTerms {
  triggerType: TriggerType;
  operator: ComparisonOp;
  /** Scaled x100 (e.g. 3500 = 35.00°C). */
  threshold: number;
  payoutAmount: Dust;
  premium: Dust;
  coverageStart: number;
  expiry: number;
}

export interface Policy {
  policyId: Bytes32;
  insurer: Address;
  terms: PolicyTerms;
  termsDigest: Bytes32;
  /** Insurer capability commitment H_auth(policyId, insurerSecret). */
  insurerAuth: Bytes32;
  status: PolicyStatus;
  fundedAmount: Dust;
  enrollmentCommitment: Bytes32 | null;
  /** Registered oracle credential entries (insertion order, max 2). */
  oracleRegistry: Bytes32[];
  /** Commitment of the one settlement instance allowed to finalize (null until authorized). */
  settleAuthCommit: Bytes32 | null;
  trigger: TriggerRecord | null;
  /** Canonical digest of the accepted trigger evidence (null until recorded). */
  triggerDigest: Bytes32 | null;
  createdAt: number;
}

export interface TriggerSourceReading {
  sourceId: Bytes32;
  value: number;
}

export interface TriggerRecord {
  readings: TriggerSourceReading[];
  outcome: boolean;
  observedValue: number;
  recordedAt: number;
}

/**
 * Canonical digest of ACCEPTED trigger evidence (Wave-1 hardening): written
 * by the policy's authorized oracles, mirrored into the settlement instance,
 * and re-derived from the claimant's private witnesses at settle time.
 * Order-sensitive in the recorded submission order.
 */
export type TriggerDigest = Bytes32;

/**
 * 32-byte high-entropy capability secrets (Wave-1 authorization). The
 * toolchain has no caller-identity primitive, so every privileged transition
 * is gated by knowledge of a secret checked against an on-chain commitment.
 * Generated client-side; NEVER persisted, logged, or sent anywhere.
 */
export type CapabilitySecret = Bytes32;

/**
 * Client-side authorization material for a policy lifecycle. The insurer
 * holds insurer + settlement capabilities and registers the two oracles;
 * the holder generates holderSecret at enrollment. SettlementSecret is
 * consumed by the authorized settlement flow (mark_settled/mark_denied).
 */
export interface PolicyCapabilities {
  insurerSecret: CapabilitySecret;
  /** Registers the settlement instance allowed to finalize this policy. */
  settlementSecret: CapabilitySecret;
  /** Two per-policy oracle credentials (H binds policy_id + source + secret). */
  oracleSecrets: [CapabilitySecret, CapabilitySecret];
}

/** NEVER leaves the client (Invariant 2). Consumed in-process by the prover. */
export interface ClaimWitness {
  policyId: Bytes32;
  holderSecret: Bytes32;
  settlementAmount: Dust;
  claimTime: number;
  triggerEvidence: TriggerRecord;
}

export interface ClaimProofPublicInputs {
  policyId: Bytes32;
  termsDigest: Bytes32;
  nullifier: Bytes32;
  triggerOutcome: boolean;
  /** H(amount) — hides the amount, binds the proof to it. */
  expectedPayoutCommitment: Bytes32;
}

/** Public representation of a proof. No witness material, ever. */
export interface ClaimProof {
  statement: Bytes32;
  proofHash: Bytes32;
  publicInputs: ClaimProofPublicInputs;
}

export type ReceiptStatus = 'SETTLED' | 'DENIED';

export interface Receipt {
  receiptId: Bytes32;
  policyId: Bytes32;
  proofHash: Bytes32;
  triggerOutcome: boolean;
  status: ReceiptStatus;
  timestamp: number;
}

export type ProtocolEventType =
  | 'PolicyCreated'
  | 'PolicyFunded'
  | 'HolderEnrolled'
  | 'OracleRegistered'
  | 'TriggerRecorded'
  | 'TriggerRejected'
  | 'SettlementAuthorized'
  | 'ClaimSettled'
  | 'ClaimDenied'
  | 'ReceiptPublished'
  | 'PolicyExpired'
  | 'PolicyClosed';

export interface ProtocolEvent {
  seq: number;
  type: ProtocolEventType;
  policyId?: Bytes32;
  receiptId?: Bytes32;
  timestamp: number;
  /**
   * Public payload only. The privacy test suite serializes every event and
   * fails if any private field name or value appears here.
   */
  data: Record<string, string | number | boolean | string[]>;
}

/** Error catalog (BUILD_SPEC.md §8). Mirrored as assert() failures in Compact. */
export enum ErrorCode {
  POLICY_NOT_FOUND = 'POLICY_NOT_FOUND',
  POLICY_INACTIVE = 'POLICY_INACTIVE',
  ALREADY_CREATED = 'ALREADY_CREATED',
  INSUFFICIENT_FUNDING = 'INSUFFICIENT_FUNDING',
  ALREADY_ENROLLED = 'ALREADY_ENROLLED',
  PREMIUM_REQUIRED = 'PREMIUM_REQUIRED',
  NOT_ENROLLED = 'NOT_ENROLLED',
  TRIGGER_NOT_RECORDED = 'TRIGGER_NOT_RECORDED',
  TRIGGER_CONFLICT = 'TRIGGER_CONFLICT',
  TRIGGER_INSUFFICIENT_SOURCES = 'TRIGGER_INSUFFICIENT_SOURCES',
  UNAUTHORIZED = 'UNAUTHORIZED',
  INVALID_PROOF = 'INVALID_PROOF',
  NULLIFIER_SPENT = 'NULLIFIER_SPENT',
  CLAIM_WINDOW_CLOSED = 'CLAIM_WINDOW_CLOSED',
  EXPIRY_REQUIRED = 'EXPIRY_REQUIRED',
}

export class ProtocolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ProtocolError';
    this.code = code;
  }
}

/** Supplies private witness values in-process, mirroring Midnight's WitnessProvider. */
export type WitnessProvider = () => ClaimWitness;

export interface SettlementCounts {
  settled: number;
  denied: number;
}
