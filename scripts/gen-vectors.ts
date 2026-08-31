// One-shot vector generator for tests/compactParity.test.ts.
// NIST digests are computed with node:crypto (trusted reference), golden
// digests pin the current TS scheme so the Compact circuits must match them.
import { createHash } from 'node:crypto';
import {
  policyIdDigest,
  termsDigestOf,
  enrollmentCommitmentOf,
  nullifierOf,
  payoutCommitmentOf,
  statementDigestOf,
  witnessDigestOf,
  proofHashOf,
  receiptIdDigest,
  sourceIdDigest,
} from '../src/core/hashing.js';
import { ComparisonOp, TriggerType } from '../src/types/index.js';

const nist = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const nistBuf = (n: number) =>
  createHash('sha256').update(Buffer.alloc(n, 0x61)).digest('hex');

console.log('--- NIST (node:crypto) ---');
console.log('empty   ', nist(''));
console.log('abc     ', nist('abc'));
console.log(
  '448bit  ',
  nist('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
);
console.log('55x a   ', nistBuf(55));
console.log('56x a   ', nistBuf(56));
console.log('57x a   ', nistBuf(57));
console.log('64x a   ', nistBuf(64));
console.log('65x a   ', nistBuf(65));
console.log('119x a  ', nistBuf(119));
console.log('120x a  ', nistBuf(120));
console.log('1M x a  ', nistBuf(1_000_000));

console.log('--- golden digest pins (current TS scheme) ---');
const insurer = '0x' + 'ab'.repeat(32);
const policyId = policyIdDigest(insurer, 7);
console.log('policyId        ', policyId);
const terms = {
  triggerType: TriggerType.TEMPERATURE,
  operator: ComparisonOp.GTE,
  threshold: 3500,
  payoutAmount: 5_000_000_000n,
  premium: 100_000_000n,
  coverageStart: 1_700_000_000,
  expiry: 1_702_592_000,
};
console.log('termsDigest     ', termsDigestOf(policyId, terms));
const secret = '0x' + 'cd'.repeat(32);
console.log('commitment      ', enrollmentCommitmentOf(policyId, secret));
console.log('nullifier       ', nullifierOf(policyId, secret));
console.log('payoutCommit    ', payoutCommitmentOf(5_000_000_000n));
const pubInputs = {
  policyId,
  termsDigest: termsDigestOf(policyId, terms),
  nullifier: nullifierOf(policyId, secret),
  triggerOutcome: true,
  expectedPayoutCommitment: payoutCommitmentOf(5_000_000_000n),
};
console.log('statement       ', statementDigestOf(pubInputs));
const witness = {
  policyId,
  holderSecret: secret,
  settlementAmount: 5_000_000_000n,
  claimTime: 1_700_030_000,
  triggerEvidence: {
    readings: [
      { sourceId: sourceIdDigest('open-meteo'), value: 4000 },
      { sourceId: sourceIdDigest('noaa'), value: 3600 },
    ],
    outcome: true,
    observedValue: 3800,
    recordedAt: 1_700_020_000,
  },
};
const wDigest = witnessDigestOf(witness);
console.log('witnessDigest   ', wDigest);
console.log('proofHash       ', proofHashOf(pubInputs.nullifier, wDigest).slice(0, 0) || proofHashOf(statementDigestOf(pubInputs), wDigest));
console.log('receiptId       ', receiptIdDigest(policyId, proofHashOf(statementDigestOf(pubInputs), wDigest), true, true, 1_700_040_000));
console.log('sourceId(meteo) ', sourceIdDigest('open-meteo'));
// witness digest with readings reversed — must equal wDigest (canonical sort)
const witnessReversed = {
  ...witness,
  triggerEvidence: {
    ...witness.triggerEvidence,
    readings: [...witness.triggerEvidence.readings].reverse(),
  },
};
console.log('witnessReversed equals canonical:', witnessDigestOf(witnessReversed) === wDigest);
