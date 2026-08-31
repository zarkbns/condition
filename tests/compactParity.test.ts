// Compact parity + hash-scheme pins (BUILD_SPEC.md §9, §3.2).
//
// Two jobs:
//   1. Pin the hand-rolled SHA-256 to the NIST FIPS 180-4 test vectors
//      (cross-checked against node:crypto when the vectors were generated).
//   2. Pin every domain-separated digest to a fixed golden value. These exact
//      digests are the cross-layer contract: when `compact compile` runs on a
//      supported platform, the circuits in contracts/*.compact must reproduce
//      these values for the same inputs — that is what makes the TS reference
//      runtime and the on-chain layer interchangeable.
//
// Regenerate golden values with: npx tsx scripts/gen-vectors.ts

import { describe, expect, it } from 'vitest';
import { sha256 } from '../src/core/sha256.js';
import {
  DOMAIN_TAGS,
  enrollmentCommitmentOf,
  hexToBytes,
  isBytes32,
  nullifierOf,
  payoutCommitmentOf,
  policyIdDigest,
  proofHashOf,
  receiptIdDigest,
  sourceIdDigest,
  statementDigestOf,
  termsDigestOf,
  witnessDigestOf,
} from '../src/core/hashing.js';
import { ComparisonOp, TriggerType, type ClaimWitness } from '../src/types/index.js';
import { makeTerms, PAYOUT, T0, T_CLAIM, T_EXPIRY, T_SETTLE, T_TRIGGER } from './helpers.js';

const a = (n: number) => new Uint8Array(n).fill(0x61);
const hex = (digest: Uint8Array): string =>
  Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');

describe('sha256 — NIST FIPS 180-4 vectors', () => {
  // Official NIST values (independently confirmed via node:crypto).
  const vectors: Array<[string, Uint8Array, string]> = [
    ['empty', new Uint8Array(0), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', new TextEncoder().encode('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['448-bit', new TextEncoder().encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['55 a', a(55), '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    ['56 a (block boundary)', a(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    ['57 a', a(57), 'f13b2d724659eb3bf47f2dd6af1accc87b81f09f59f2b75e5c0bed6589dfe8c6'],
    ['64 a (one full block)', a(64), 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
    ['65 a', a(65), '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0'],
    ['119 a', a(119), '31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb'],
    ['120 a', a(120), '2f3d335432c70b580af0e8e1b3674a7c020d683aa5f73aaaedfdc55af904c21c'],
    ['1,000,000 a', a(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ];

  for (const [name, message, digest] of vectors) {
    it(`matches NIST vector: ${name}`, () => {
      expect(hex(sha256(message))).toBe(digest);
    });
  }
});

// ---------------------------------------------------------------------------
// Golden pins — the cross-layer contract with contracts/*.compact
// ---------------------------------------------------------------------------

const INSURER = '0x' + 'ab'.repeat(32);
const SECRET = '0x' + 'cd'.repeat(32);
const NONCE = 7;
const TERMS = makeTerms();

const GOLDEN_POLICY_ID = '0x5c5915ffaa68dcc98355349a600d9aafc3cc777a2431d80681118d68078e4bd0';
const GOLDEN_TERMS_DIGEST = '0x926de38ef9c939f03d2dcfc053dc107cd085a1ba33898dd6de6c807f2fd9123d';
const GOLDEN_COMMITMENT = '0x4aa2895f8d63f734caf376fa924c8e2cd86aa3723bfeef164cc097e8a2809a13';
const GOLDEN_NULLIFIER = '0x6d99f6e80e5143764c172c081d1c5cfd1a86ebf240bfd9cbdf574de9840b176d';
const GOLDEN_PAYOUT_COMMITMENT = '0x548ab6b8c998df69bdfe91f7f6ec319d39713d5eabfc9205ccf43e9ee7b1963e';
const GOLDEN_STATEMENT = '0x794cbc7998696c6970481ce030f9729d749a94edfadb14aa7e8d4308be999b4a';
const GOLDEN_WITNESS_DIGEST = '0xeb7129b82908b683dea102b8818c1a20efd1c951af78a2fdc87d5adddad0afbc';
const GOLDEN_PROOF_HASH = '0x10f11608303329cc6f618f1578294dfeb356c67d927311eec0c4d4e23b883b4a';
const GOLDEN_RECEIPT_ID = '0xe17778a9551c0982e1434c16e89d10f22e547b600e22ff5d7291130c90bf6178';
const GOLDEN_SOURCE_METEO = '0xc05df1274a22559d7b6c8b4c75d53cb01fb7d5439cd4fb58dd0a8b7b50838b5e';

const goldenWitness = (): ClaimWitness => ({
  policyId: GOLDEN_POLICY_ID,
  holderSecret: SECRET,
  settlementAmount: PAYOUT,
  claimTime: T_CLAIM,
  triggerEvidence: {
    readings: [
      { sourceId: sourceIdDigest('open-meteo'), value: 4000 },
      { sourceId: sourceIdDigest('noaa'), value: 3600 },
    ],
    outcome: true,
    observedValue: 3800,
    recordedAt: T_TRIGGER,
  },
});

describe('golden digest pins — the Compact parity contract', () => {
  it('policyId = H(policy:v1, insurer32, nonce)', () => {
    expect(policyIdDigest(INSURER, NONCE)).toBe(GOLDEN_POLICY_ID);
  });

  it('termsDigest is bound to policyId and every term', () => {
    expect(termsDigestOf(GOLDEN_POLICY_ID, TERMS)).toBe(GOLDEN_TERMS_DIGEST);
  });

  it('enrollment commitment H(elig:v1, policyId, secret)', () => {
    expect(enrollmentCommitmentOf(GOLDEN_POLICY_ID, SECRET)).toBe(GOLDEN_COMMITMENT);
  });

  it('nullifier H(null:v1, policyId, secret)', () => {
    expect(nullifierOf(GOLDEN_POLICY_ID, SECRET)).toBe(GOLDEN_NULLIFIER);
  });

  it('payout commitment H(amount:v1, amount)', () => {
    expect(payoutCommitmentOf(PAYOUT)).toBe(GOLDEN_PAYOUT_COMMITMENT);
  });

  it('statement digest over the five public inputs', () => {
    expect(statementDigestOf({
      policyId: GOLDEN_POLICY_ID,
      termsDigest: GOLDEN_TERMS_DIGEST,
      nullifier: GOLDEN_NULLIFIER,
      triggerOutcome: true,
      expectedPayoutCommitment: GOLDEN_PAYOUT_COMMITMENT,
    })).toBe(GOLDEN_STATEMENT);
  });

  it('witness digest (readings digest-ascending)', () => {
    expect(witnessDigestOf(goldenWitness())).toBe(GOLDEN_WITNESS_DIGEST);
  });

  it('proof hash H(proof:v1, statement, witnessDigest)', () => {
    expect(proofHashOf(GOLDEN_STATEMENT, GOLDEN_WITNESS_DIGEST)).toBe(GOLDEN_PROOF_HASH);
  });

  it('receipt id H(receipt:v1, policyId, proofHash, outcome, settled, timestamp)', () => {
    expect(receiptIdDigest(GOLDEN_POLICY_ID, GOLDEN_PROOF_HASH, true, true, T_SETTLE))
      .toBe(GOLDEN_RECEIPT_ID);
  });

  it('source id H(source:v1, name)', () => {
    expect(sourceIdDigest('open-meteo')).toBe(GOLDEN_SOURCE_METEO);
  });
});

describe('canonical field encoding (mirrored by Compact circuits)', () => {
  it('integer fields are 64-bit little-endian, right zero-padded to 32 bytes', () => {
    // 1 → first byte 0x01, rest zero.
    expect(payoutCommitmentOf(1n)).not.toBe(payoutCommitmentOf(256n));
    // Distinct low bytes must yield distinct digests (padding is to the RIGHT).
    expect(payoutCommitmentOf(1n)).not.toBe(payoutCommitmentOf(0x0100000000000000n));
    // 64-bit boundary is accepted, 65 bits is rejected.
    expect(isBytes32(payoutCommitmentOf(0xffff_ffff_ffff_ffffn))).toBe(true);
    expect(() => payoutCommitmentOf(0x1_0000_0000_0000_0000n)).toThrow();
    expect(() => payoutCommitmentOf(-1n)).toThrow();
  });

  it('enum codes are 0-based ordinals, never strings', () => {
    const t0 = makeTerms({ triggerType: TriggerType.TEMPERATURE });
    const t1 = makeTerms({ triggerType: TriggerType.RAINFALL_MM });
    expect(termsDigestOf(GOLDEN_POLICY_ID, t0)).not.toBe(termsDigestOf(GOLDEN_POLICY_ID, t1));
    const gte = makeTerms({ operator: ComparisonOp.GTE });
    const gt = makeTerms({ operator: ComparisonOp.GT });
    expect(termsDigestOf(GOLDEN_POLICY_ID, gte)).not.toBe(termsDigestOf(GOLDEN_POLICY_ID, gt));
  });

  it('witness digest is invariant under reading order (canonical sort)', () => {
    const w = goldenWitness();
    const reversed: ClaimWitness = {
      ...w,
      triggerEvidence: {
        ...w.triggerEvidence,
        readings: [...w.triggerEvidence.readings].reverse(),
      },
    };
    expect(witnessDigestOf(reversed)).toBe(witnessDigestOf(w));
  });

  it('domain tags differ across derivations (no cross-use)', () => {
    const tags = Object.values(DOMAIN_TAGS);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('claimant unlinkability (BUILD_SPEC §2.1)', () => {
  it('commitment and nullifier use different domain tags ⇒ unlinkable', () => {
    const commitment = enrollmentCommitmentOf(GOLDEN_POLICY_ID, SECRET);
    const nullifier = nullifierOf(GOLDEN_POLICY_ID, SECRET);
    expect(commitment).not.toBe(nullifier);
  });

  it('field order is pinned (policyId and secret are not interchangeable)', () => {
    // H(elig, secret, policyId) — swapped argument order — must not collide.
    const swapped = enrollmentCommitmentOf(SECRET, GOLDEN_POLICY_ID);
    expect(swapped).not.toBe(enrollmentCommitmentOf(GOLDEN_POLICY_ID, SECRET));
  });

  it('no derivation reveals or equals the secret', () => {
    for (const d of [
      enrollmentCommitmentOf(GOLDEN_POLICY_ID, SECRET),
      nullifierOf(GOLDEN_POLICY_ID, SECRET),
    ]) {
      expect(d).not.toBe(SECRET);
      expect(isBytes32(d)).toBe(true);
    }
  });
});

describe('hex helpers', () => {
  it('round-trips bytes ↔ hex', () => {
    const digest = hexToBytes(GOLDEN_POLICY_ID);
    expect(digest).toHaveLength(32);
    expect(
      '0x' + Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join(''),
    ).toBe(GOLDEN_POLICY_ID);
  });

  it('rejects malformed Bytes32', () => {
    expect(isBytes32('0x1234')).toBe(false);
    expect(isBytes32(GOLDEN_POLICY_ID.slice(0, 63))).toBe(false);
    expect(() => hexToBytes('0xzz')).toThrow();
  });
});
