// Domain-separated digests (BUILD_SPEC.md §4, §5).
//
// This module is THE privacy boundary primitive: every object that crosses
// from private to public (enrollment commitment, nullifier, payout
// commitment, proof hash) is a digest produced here, and the two holder-secret
// derivations use different domain tags so commitment and nullifier are not
// linkable (docs/MIDNIGHT_NOTES.md §4.2).
//
// Canonical field encoding — every preimage element is exactly 32 bytes so the
// Compact circuits mirror the identical scheme over Bytes<32> vectors:
//   - domain tag: ASCII bytes, right zero-padded to 32 (Compact: pad(32, tag))
//   - Bytes32:    raw 32 bytes
//   - integers:   64-bit unsigned little-endian, right zero-padded to 32
//                 (mirrors Compact's (n as Field) as Bytes<32> convention,
//                  documented in docs/MIDNIGHT_NOTES.md §5)
//   - booleans:   first byte 0x01/0x00, rest zero
//   - enums:      integer codes (see triggerTypeCode / comparisonOpCode) —
//                 NEVER strings, so TS and Compact hash identical preimages
//
// tests/compactParity.test.ts pins this scheme with fixed vectors.

import { sha256 } from './sha256.js';
import {
  ComparisonOp,
  TriggerType,
} from '../types/index.js';
import type { Bytes32, ClaimProofPublicInputs, ClaimWitness, PolicyTerms } from '../types/index.js';

export const DOMAIN_TAGS = {
  policy: 'condition:policy:v1',
  terms: 'condition:terms:v1',
  eligibility: 'condition:elig:v1',
  nullifier: 'condition:null:v1',
  amount: 'condition:amount:v1',
  source: 'condition:source:v1',
  statement: 'condition:stmt:v1',
  witness: 'condition:witness:v1',
  proof: 'condition:proof:v1',
  receipt: 'condition:receipt:v1',
  reading: 'condition:reading:v1',
} as const;

/** Enum codes shared with contracts/*.compact (0-based, matches enum ordinals). */
export function triggerTypeCode(t: TriggerType): number {
  switch (t) {
    case TriggerType.TEMPERATURE:
      return 0;
    case TriggerType.RAINFALL_MM:
      return 1;
    case TriggerType.FLIGHT_DELAY_MIN:
      return 2;
    case TriggerType.EARTHQUAKE_MAG:
      return 3;
  }
}

export function comparisonOpCode(op: ComparisonOp): number {
  switch (op) {
    case ComparisonOp.GT:
      return 0;
    case ComparisonOp.GTE:
      return 1;
    case ComparisonOp.LT:
      return 2;
    case ComparisonOp.LTE:
      return 3;
    case ComparisonOp.EQ:
      return 4;
  }
}

const HEX = '0123456789abcdef';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '0x';
  for (const b of bytes) {
    out += HEX[b >>> 4];
    out += HEX[b & 0xf];
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64) {
    throw new Error(`expected 64 hex chars for Bytes32, got ${clean.length}`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** True when the string is 0x + 64 hex chars (Bytes32-shaped). */
export function isBytes32(hex: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hex);
}

/** 32-byte field from a UTF-8 string, right zero-padded (Compact pad(32, s)). */
function fieldFromString(s: string): Uint8Array {
  const out = new Uint8Array(32);
  const encoded = new TextEncoder().encode(s);
  if (encoded.length > 32) {
    throw new Error(`string field longer than 32 bytes: ${s}`);
  }
  out.set(encoded);
  return out;
}

/** 32-byte field from a 64-bit integer (little-endian, right zero-padded). */
function fieldFromInt(n: bigint | number): Uint8Array {
  const out = new Uint8Array(32);
  let v = BigInt(n);
  if (v < 0n) {
    throw new Error(`negative integer in hash preimage: ${n}`);
  }
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) {
    throw new Error(`integer exceeds 64 bits in hash preimage: ${n}`);
  }
  return out;
}

function fieldFromBool(b: boolean): Uint8Array {
  const out = new Uint8Array(32);
  out[0] = b ? 1 : 0;
  return out;
}

function fieldFromBytes32(hex: string): Uint8Array {
  return hexToBytes(hex);
}

/** sha256(tag32 || field || ... || field). */
function digest(tag: string, ...fields: Uint8Array[]): Bytes32 {
  const preimage = new Uint8Array(32 * (fields.length + 1));
  preimage.set(fieldFromString(tag));
  fields.forEach((f, i) => preimage.set(f, 32 * (i + 1)));
  return bytesToHex(sha256(preimage));
}

// ---------------------------------------------------------------------------
// Policy-side digests (public data in, digest out)
// ---------------------------------------------------------------------------

/** policyId = H("condition:policy:v1", insurer32, nonce) — mirrors create() in policy.compact. */
export function policyIdDigest(insurer: Bytes32, nonce: number): Bytes32 {
  return digest(DOMAIN_TAGS.policy, fieldFromBytes32(insurer), fieldFromInt(nonce));
}

export function termsDigestOf(policyId: Bytes32, terms: PolicyTerms): Bytes32 {
  return digest(
    DOMAIN_TAGS.terms,
    fieldFromBytes32(policyId),
    fieldFromInt(triggerTypeCode(terms.triggerType)),
    fieldFromInt(comparisonOpCode(terms.operator)),
    fieldFromInt(terms.threshold),
    fieldFromInt(terms.payoutAmount),
    fieldFromInt(terms.premium),
    fieldFromInt(terms.coverageStart),
    fieldFromInt(terms.expiry),
  );
}

export function sourceIdDigest(name: string): Bytes32 {
  return digest(DOMAIN_TAGS.source, fieldFromString(name));
}

// ---------------------------------------------------------------------------
// Claimant-side derivations (private secret in, unlinkable digests out)
// ---------------------------------------------------------------------------

/** Enrollment commitment H("condition:elig:v1", policyId, secret). */
export function enrollmentCommitmentOf(policyId: Bytes32, holderSecret: Bytes32): Bytes32 {
  return digest(DOMAIN_TAGS.eligibility, fieldFromBytes32(policyId), fieldFromBytes32(holderSecret));
}

/** Nullifier H("condition:null:v1", policyId, secret) — different tag ⇒ unlinkable. */
export function nullifierOf(policyId: Bytes32, holderSecret: Bytes32): Bytes32 {
  return digest(DOMAIN_TAGS.nullifier, fieldFromBytes32(policyId), fieldFromBytes32(holderSecret));
}

/** Payout commitment H("condition:amount:v1", amount) — hides the amount. */
export function payoutCommitmentOf(amount: bigint): Bytes32 {
  return digest(DOMAIN_TAGS.amount, fieldFromInt(amount));
}

/**
 * Reading digest H("condition:reading:v1", sourceId, value) — the sort key
 * for canonical witness reading order. The claimant's client orders
 * readings digest-ascending before supplying reading1/reading2 witnesses,
 * matching witnessDigestOf's canonical preimage (mirrors reading_digest_c
 * in settlement.compact).
 */
export function readingDigestOf(sourceId: Bytes32, value: number): Bytes32 {
  return digest(DOMAIN_TAGS.reading, fieldFromBytes32(sourceId), fieldFromInt(value));
}

// ---------------------------------------------------------------------------
// Proof digests
// ---------------------------------------------------------------------------

export function statementDigestOf(inputs: ClaimProofPublicInputs): Bytes32 {
  return digest(
    DOMAIN_TAGS.statement,
    fieldFromBytes32(inputs.policyId),
    fieldFromBytes32(inputs.termsDigest),
    fieldFromBytes32(inputs.nullifier),
    fieldFromBool(inputs.triggerOutcome),
    fieldFromBytes32(inputs.expectedPayoutCommitment),
  );
}

export function witnessDigestOf(witness: ClaimWitness): Bytes32 {
  const evidence = witness.triggerEvidence;
  const readings = [...evidence.readings]
    .map((r) => digest(DOMAIN_TAGS.reading, fieldFromBytes32(r.sourceId), fieldFromInt(r.value)))
    .sort();
  return digest(
    DOMAIN_TAGS.witness,
    fieldFromBytes32(witness.policyId),
    fieldFromBytes32(witness.holderSecret),
    fieldFromInt(witness.settlementAmount),
    fieldFromInt(witness.claimTime),
    fieldFromBool(evidence.outcome),
    fieldFromInt(evidence.observedValue),
    fieldFromInt(evidence.recordedAt),
    ...readings.map((r) => fieldFromBytes32(r)),
  );
}

export function proofHashOf(statement: Bytes32, witnessDigest: Bytes32): Bytes32 {
  return digest(DOMAIN_TAGS.proof, fieldFromBytes32(statement), fieldFromBytes32(witnessDigest));
}

export function receiptIdDigest(
  policyId: Bytes32,
  proofHash: Bytes32,
  triggerOutcome: boolean,
  settled: boolean,
  timestamp: number,
): Bytes32 {
  return digest(
    DOMAIN_TAGS.receipt,
    fieldFromBytes32(policyId),
    fieldFromBytes32(proofHash),
    fieldFromBool(triggerOutcome),
    fieldFromBool(settled),
    fieldFromInt(timestamp),
  );
}

/** Random 32-byte secret (≥128 bits entropy, Invariant per BUILD_SPEC §5.4). */
export function randomSecret(): Bytes32 {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** Random Bytes32-shaped address (reference-runtime account id). */
export function randomAddress(): Bytes32 {
  return randomSecret();
}
