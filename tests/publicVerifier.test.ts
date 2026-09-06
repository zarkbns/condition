// Public verifier core (offline unit tests): the receipt recomputation,
// cross-check semantics and evidence-check structure that /verify runs
// against live chain data. Network access is mocked at the fetch boundary —
// these tests pin the LOGIC, not the network (the live Preprod result is
// re-verified by scripts/verify-receipt.ts and docs/DEPLOYMENTS.md).

import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  verifyReceiptAgainstContract,
  verifyReceiptId,
  ChainUnavailableError,
  PREPROD_DEPLOYMENTS,
  explorerUrl,
  explorerTxUrl,
} from '../src/utils/publicChain.js';
import { receiptIdDigest } from '../src/core/hashing.js';
import type { Bytes32 } from '../src/types/index.js';

const INDEXER = 'https://indexer.example/api/v3/graphql';
const SETTLEMENT = PREPROD_DEPLOYMENTS[0]!.settlementAddress;
const POLICY = PREPROD_DEPLOYMENTS[0]!.policyAddress;

// The on-chain receipt fields of the 2026-09-05 lifecycle (public state).
const POLICY_ID: Bytes32 = '0xc78d5715f8befa155b0e793fedf1fa333a2433a18a1366fb5b03a7e0dea78361';
const PROOF_HASH: Bytes32 = '0xf3c106f1e21ce7a5a020f839db66a0d98a7b2627ee06730121e216baf508efe5';
const TIMESTAMP = 1788641439;

const RECEIPT_ID = receiptIdDigest(POLICY_ID, PROOF_HASH, true, true, TIMESTAMP);
const BAD_RECEIPT_ID = receiptIdDigest(POLICY_ID, PROOF_HASH, true, true, TIMESTAMP + 1);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Install a fetch mock that answers the two state queries with fixed blobs. */
function mockStates(responses: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as { query: string };
    for (const [needle, answer] of Object.entries(responses)) {
      if (body.query.includes(needle)) {
        return { json: async () => ({ data: answer }) } as Response;
      }
    }
    return { json: async () => ({ data: null, errors: [{ message: `unmocked query: ${body.query.slice(0, 80)}` }] }) } as Response;
  }));
}

describe('verifyReceiptAgainstContract (offline logic)', () => {
  it('accepts the true receipt id recomputed from on-chain fields', async () => {
    mockStates({
      [`contractAction(address:"${SETTLEMENT}")`]: {
        contractAction: { state: fakeSettlementStateHex() },
      },
      [`contractAction(address:"${POLICY}")`]: {
        contractAction: { state: fakePolicyStateHex() },
      },
    });
    const result = await verifyReceiptAgainstContract(INDEXER, SETTLEMENT, RECEIPT_ID);
    const byId = (id: string) => result.checks.find((c) => c.id === id)!;
    expect(byId('shape').passed).toBe(true);
    expect(byId('state').passed).toBe(true);
    expect(byId('receipt-digest').passed).toBe(true);
    // cross-checks against the policy contract
    expect(byId('policy-id-mirror').passed).toBe(true);
    expect(byId('terms-mirror').passed).toBe(true);
    expect(byId('commitment-mirror').passed).toBe(true);
    expect(byId('outcome-mirror').passed).toBe(true);
    expect(byId('terms-digest').passed).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.receipt?.recomputedId).toBe(RECEIPT_ID);
  });

  it('rejects a receipt id that does not recompute (wrong timestamp)', async () => {
    mockStates({
      [`contractAction(address:"${SETTLEMENT}")`]: {
        contractAction: { state: fakeSettlementStateHex() },
      },
    });
    const result = await verifyReceiptAgainstContract(INDEXER, SETTLEMENT, BAD_RECEIPT_ID);
    const digest = result.checks.find((c) => c.id === 'receipt-digest')!;
    expect(digest.passed).toBe(false);
    expect(result.valid).toBe(false);
    // no fake success anywhere in the evidence list
    expect(result.checks.every((c) => c.passed)).toBe(false);
  });

  it('rejects a malformed input before any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await verifyReceiptAgainstContract(INDEXER, SETTLEMENT, 'not-a-hash');
    expect(result.valid).toBe(false);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]!.id).toBe('shape');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('treats a contract with no on-chain state as not-verified, not crashed', async () => {
    mockStates({
      [`contractAction(address:"${SETTLEMENT}")`]: { contractAction: null },
    });
    const result = await verifyReceiptAgainstContract(INDEXER, SETTLEMENT, RECEIPT_ID);
    const state = result.checks.find((c) => c.id === 'state')!;
    expect(state.passed).toBe(false);
    expect(result.valid).toBe(false);
  });

  it('throws ChainUnavailableError (distinct from not-found) when the indexer is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    await expect(
      verifyReceiptAgainstContract(INDEXER, SETTLEMENT, RECEIPT_ID),
    ).rejects.toBeInstanceOf(ChainUnavailableError);
  });

  it('reports all failed attempts when the id matches no known deployment', async () => {
    mockStates({
      [`contractAction(address:"${SETTLEMENT}")`]: {
        contractAction: { state: fakeSettlementStateHex() },
      },
    });
    const { results, matched } = await verifyReceiptId(INDEXER, BAD_RECEIPT_ID);
    expect(matched).toBeNull();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !r.valid)).toBe(true);
  });

  it('matches via verifyReceiptId with an explicit settlement address override', async () => {
    mockStates({
      [`contractAction(address:"${SETTLEMENT}")`]: {
        contractAction: { state: fakeSettlementStateHex() },
      },
      [`contractAction(address:"${POLICY}")`]: {
        contractAction: { state: fakePolicyStateHex() },
      },
    });
    const { matched } = await verifyReceiptId(INDEXER, RECEIPT_ID, SETTLEMENT);
    expect(matched?.valid).toBe(true);
  });
});

describe('explorer links', () => {
  it('builds contract and tx links on the Midnight Preprod explorer', () => {
    expect(explorerUrl('ab'.repeat(32))).toBe(`https://preprod.midnightexplorer.com/contracts/0x${'ab'.repeat(32)}`);
    expect(explorerTxUrl('cd'.repeat(32))).toBe(`https://preprod.midnightexplorer.com/transactions/0x${'cd'.repeat(32)}`);
  });
});

// ---------------------------------------------------------------------------
// Fixtures: hand-built minimal state encodings. The receipt fields are
// encoded the way the on-chain runtime serializes ContractState; the decoder
// under test is the authoritative compiled ledger() accessor, so these
// fixtures must be byte-valid for it. Rather than replicate the full state
// format, the tests mock at the fetch layer and feed the SAME decoded-shape
// values the real decoder returns — by intercepting at fetch with real hex
// blobs captured from Preprod would couple tests to live bytes. Instead we
// assert logic with synthetic hex that the decoder must reject, and run the
// true-acceptance path through a decode stub: swap in a pre-decoded ledger
// module via the same dynamic-import seam the client uses.
//
// In practice the two fixtures below ARE real Preprod state blobs (fetched
// and pinned 2026-09-06; see docs/DEPLOYMENTS.md re-verification). If the
// decoder ever drifts from the chain format, the live script (scripts/
// verify-receipt.ts) fails against Preprod first.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function fakeSettlementStateHex(): string {
  // Real Preprod settlement state, pinned at verification time.
  return readFileSync(join(import.meta.dirname, 'fixtures', 'settlement-state.hex'), 'utf8').trim();
}

function fakePolicyStateHex(): string {
  return readFileSync(join(import.meta.dirname, 'fixtures', 'policy-state.hex'), 'utf8').trim();
}
