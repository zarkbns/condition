// Public chain evidence client (BUILD_SPEC §7, DEPLOYMENTS.md evidence chain).
//
// Reads Condition's public ledger surface from the Midnight Preprod indexer
// (indexer API v3 — the surface this repo's SDK generation is verified
// against, see docs/DEPLOYMENTS.md). BROWSER-SAFE by construction: plain
// HTTPS fetch, no wallet, no seed, no Node APIs, no session state. This is
// the module behind /verify and /explorer — a stranger's browser is the
// client, and every value it surfaces is fetched fresh from the chain.
//
// Contract public state is decoded with the SAME compiled contract artifacts
// the on-chain calls use (contracts/managed-compact/*/contract/index.js —
// the committed compiler output; see src/utils/managedContracts.ts — over
// @midnight-ntwrk/compact-runtime + onchain-runtime wasm) — the authoritative
// onchain-runtime decoder, not a hand-written parser of the state blob.
// Dynamic import keeps the wasm chunk out of every other route.
//
// What this module proves and how (independent third-party receipt
// verification, no claimant session involved):
//
//   1. The settlement contract's PUBLIC state stores exactly the fields the
//      receipt is derived from: policy_id, trigger_fired (outcome),
//      last_receipt_hash (proof hash), last_status (settled bool),
//      last_timestamp. settle() writes them on every settlement.
//   2. receiptId = H("condition:receipt:v1", policy_id, proof_hash,
//      outcome, settled, timestamp) — deterministic (receipt_digest_c).
//   3. So: fetch state from the indexer, decode, recompute the digest with
//      src/core/hashing (NIST sha256), compare with the claimed receipt id.
//      A match means the claimed receipt id is exactly what the on-chain
//      settle() call published — nobody could have typed these five values
//      into a fake receipt without also knowing their preimage binding.
//   4. Cross-checks: the settlement instance mirrors the policy instance's
//      public facts via link(); both contracts' policy_id / terms_digest /
//      enrollment_commitment / trigger_fired must agree, and the terms
//      digest must recompute from the policy's public terms (policy
//      transparency, Invariant 5).
//
// What is NOT publicly verifiable with the deployed contract design (honest
// limits, surfaced by the UI):
//   - Only the LATEST settlement's receipt fields are in public state
//     (last_*). Older receipts cannot be recomputed from current state.
//   - The settled AMOUNT is never disclosed (payout_commitment hides it) —
//     verification proves a settlement happened, not how much was paid.
//   - The nullifier set supports member/size only — membership of a
//     specific nullifier can be checked, but the set cannot be listed.
//   - The indexer exposes no "find receipts by id" search: verification is
//     per settlement contract, using the known Condition deployments
//     (public addresses, docs/DEPLOYMENTS.md) or a user-supplied address.

import { receiptIdDigest, termsDigestOf, bytesToHex } from '../core/hashing.js';
import { TriggerType, ComparisonOp } from '../types/index.js';
import { loadManagedLedgerDecoder, type LedgerDecoder } from './managedContracts.js';
import type { Bytes32, PolicyTerms } from '../types/index.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const DEFAULT_INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';

/**
 * Condition's publicly documented Preprod deployments (docs/DEPLOYMENTS.md —
 * all txs SUCCESS, re-verifiable on the indexer and the Midnight Explorer).
 * These addresses are public metadata used only to LOCATE the contracts on
 * chain; every cryptographic fact is fetched live and recomputed here.
 */
export interface KnownDeployment {
  label: string;
  /** Deployed 2026-09-05, full lifecycle executed on-chain. */
  policyAddress: string;
  settlementAddress: string;
  policyId: Bytes32;
  /** The published receipt of the on-chain lifecycle (verify page demo input). */
  receiptId: Bytes32;
  /** Block heights of the recorded lifecycle txs (evidence chain). */
  lifecycle: Array<{ step: string; block: number; txHash: string }>;
}

export const PREPROD_DEPLOYMENTS: KnownDeployment[] = [
  {
    label: '2026-09-05 lifecycle (verified)',
    policyAddress: '00147690d83e6501e237774fbd934956253032010e3a7e3258e1c162f4d08a01',
    settlementAddress: '90f1d7ae19bdb9c531b003d95fd35ef4c507050390ad31e4289d172d72a8297c',
    policyId: '0xc78d5715f8befa155b0e793fedf1fa333a2433a18a1366fb5b03a7e0dea78361',
    receiptId: '0x20acedd59572ddc0b582bffcf236e43c414e005609bbef200a1ebf95998608a2',
    lifecycle: [
      { step: 'deploy policy', block: 2421479, txHash: 'cee2633c1808f1530c770b48be3e4f3c22da36ca9396df54312501307388aa08' },
      { step: 'create', block: 2421490, txHash: '2662db289b7c7bc92fd0ef75041c15e88105971eea12cebf237ba96989871349' },
      { step: 'fund', block: 2421495, txHash: 'c71b7d1c68e663076c3d92bf8ddd0913f25f0994844dcd5b3b7c8a206cb4eeb5' },
      { step: 'enroll', block: 2421514, txHash: '80229a2cee27be6664471c75547ff956277b2ce0c7dd0bb031d6c66d52337591' },
      { step: 'record_trigger', block: 2421519, txHash: '0d0b5c726ac4eac07381fa4f7df152ce9047b2420f6a0665ea3d8a2e269fab4b' },
      { step: 'deploy settlement', block: 2421538, txHash: 'fe33fce466b6222e08c2ebebcac0a6349fb61887ce42af74e0f672f84f2b474a' },
      { step: 'link', block: 2421543, txHash: '200cb2af50114a331e2d981badbe430785f6334f5f4845e1550d12151fc99a9f' },
      { step: 'settle', block: 2421557, txHash: 'e1038fdba8279698c2ccb7ebbc1ba1da62131c93c23c412ffbc2657b6b314aad' },
    ],
  },
];

export function explorerUrl(address: string): string {
  return `https://preprod.midnightexplorer.com/contracts/0x${address.replace(/^0x/, '')}`;
}

export function explorerTxUrl(txHash: string): string {
  return `https://preprod.midnightexplorer.com/transactions/0x${txHash.replace(/^0x/, '')}`;
}

// ---------------------------------------------------------------------------
// Indexer GraphQL (plain HTTPS POST — no subscriptions, no auth)
// ---------------------------------------------------------------------------

interface GraphQLErrorShape {
  message: string;
}

export class ChainUnavailableError extends Error {
  constructor(detail: string) {
    super(`Midnight indexer unreachable: ${detail}`);
    this.name = 'ChainUnavailableError';
  }
}

async function gql<T>(indexerHttp: string, query: string, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const resp = await fetch(indexerHttp, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await resp.json()) as { data?: T; errors?: GraphQLErrorShape[] };
      if (body.errors?.length) {
        throw new Error(`indexer query failed: ${body.errors.map((e) => e.message).join('; ')}`);
      }
      return body.data as T;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw new ChainUnavailableError(lastErr instanceof Error ? lastErr.message : String(lastErr));
}

// ---------------------------------------------------------------------------
// Raw queries (each verified live against Preprod — see docs/DEPLOYMENTS.md)
// ---------------------------------------------------------------------------

export interface TxSummary {
  hash: string;
  blockHeight: number;
  blockTimeMs: number;
  status: string;
  /** Circuit entry points of the contract actions in this tx, by address. */
  actions: Array<{ address: string; entryPoint?: string }>;
}

/** One transaction by hash (bare 64-hex). Empty array when unknown. */
export async function fetchTxByHash(
  indexerHttp: string,
  hash: string,
): Promise<TxSummary | null> {
  const bare = hash.replace(/^0x/, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(bare)) return null;
  const data = await gql<{
    transactions: Array<{
      hash: string;
      block: { height: number; timestamp: number } | null;
      contractActions: Array<{ address: string; entryPoint?: string }> | null;
      transactionResult?: { status: string };
    }>;
  }>(
    indexerHttp,
    `{ transactions(offset:{hash:"${bare}"}) { hash
        block { height timestamp }
        contractActions { address ... on ContractCall { entryPoint } }
        ... on RegularTransaction { transactionResult { status } } } }`,
  );
  const tx = data.transactions?.[0];
  if (!tx) return null;
  return {
    hash: tx.hash,
    blockHeight: tx.block?.height ?? 0,
    blockTimeMs: tx.block?.timestamp ?? 0,
    status: tx.transactionResult?.status ?? 'UNKNOWN',
    actions: (tx.contractActions ?? []).map((a) => ({ address: a.address, entryPoint: a.entryPoint })),
  };
}

export interface BlockSummary {
  height: number;
  timeMs: number;
  transactions: Array<{ hash: string; status: string; contractAddresses: string[] }>;
}

/** One block by height. Null beyond chain head (or before genesis). */
export async function fetchBlockByHeight(
  indexerHttp: string,
  height: number,
): Promise<BlockSummary | null> {
  if (!Number.isInteger(height) || height < 0) return null;
  const data = await gql<{
    block: {
      height: number;
      timestamp: number;
      transactions: Array<{
        hash: string;
        contractActions: Array<{ address: string }> | null;
        transactionResult?: { status: string };
      }> | null;
    } | null;
  }>(
    indexerHttp,
    `{ block(offset:{height:${height}}) { height timestamp
        transactions { hash contractActions { address }
          ... on RegularTransaction { transactionResult { status } } } } }`,
  );
  const block = data.block;
  if (!block) return null;
  return {
    height: block.height,
    timeMs: block.timestamp,
    transactions: (block.transactions ?? []).map((t) => ({
      hash: t.hash,
      status: t.transactionResult?.status ?? 'UNKNOWN',
      contractAddresses: (t.contractActions ?? []).map((a) => a.address),
    })),
  };
}

/**
 * Latest contract action summary for an address: the action's tx, block and
 * status (the indexer serves the most recent action per contract). Used by
 * the explorer's contract cards. Returns null when the indexer has no
 * record yet (known quirk for very recent contracts — block scans are
 * ground truth).
 */
export async function fetchContractHead(
  indexerHttp: string,
  address: string,
): Promise<{ txHash: string; blockHeight: number; timeMs: number; status: string } | null> {
  const bare = address.replace(/^0x/, '').toLowerCase();
  const data = await gql<{
    contractAction: {
      transaction: {
        hash: string;
        block: { height: number; timestamp: number } | null;
        transactionResult?: { status: string };
      } | null;
    } | null;
  }>(
    indexerHttp,
    `{ contractAction(address:"${bare}") {
        ... on ContractDeploy { transaction { hash block { height timestamp } ... on RegularTransaction { transactionResult { status } } } }
        ... on ContractUpdate { transaction { hash block { height timestamp } ... on RegularTransaction { transactionResult { status } } } }
        ... on ContractCall { transaction { hash block { height timestamp } ... on RegularTransaction { transactionResult { status } } } }
      } }`,
  );
  const action = data.contractAction;
  if (!action?.transaction) return null;
  return {
    txHash: action.transaction.hash,
    blockHeight: action.transaction.block?.height ?? 0,
    timeMs: action.transaction.block?.timestamp ?? 0,
    status: action.transaction.transactionResult?.status ?? 'UNKNOWN',
  };
}

/**
 * Current chain head height by binary search over block existence (the
 * indexer has no head-height query; a block beyond head returns null).
 * The search needs a height KNOWN to exist as its lower anchor: the first
 * existing power of two. ~22 probes against a ~6s-block chain.
 */
export async function fetchChainHead(indexerHttp: string): Promise<{ height: number; timeMs: number }> {
  const exists = async (h: number): Promise<boolean> =>
    Boolean(
      (await gql<{ block: { height: number } | null }>(
        indexerHttp,
        `{ block(offset:{height:${h}}) { height } }`,
      )).block,
    );

  // Lower anchor: highest existing power of two <= head (or fail honestly).
  let lo = 0;
  for (let h = 1 << 22; h >= 1; h >>= 1) {
    if (await exists(h)) {
      lo = h;
      break;
    }
  }
  if (lo === 0) {
    throw new ChainUnavailableError('no block exists below height 2^22 — the indexer has no chain data');
  }

  // Upper bound: first missing height above head (doubling guard for
  // far-future heads).
  let hi = lo * 2;
  while (await exists(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > 1 << 30) break;
  }

  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await exists(mid)) lo = mid;
    else hi = mid;
  }
  const head = await fetchBlockByHeight(indexerHttp, lo);
  return { height: lo, timeMs: head?.timeMs ?? 0 };
}

// ---------------------------------------------------------------------------
// Contract state decode (authoritative onchain-runtime artifacts)
// ---------------------------------------------------------------------------

/** The settlement contract's public ledger, decoded. */
export interface SettlementPublicState {
  linked: boolean;
  policyId: Bytes32;
  termsDigest: Bytes32;
  enrollmentCommitment: Bytes32;
  payout: bigint;
  start: bigint;
  expiry: bigint;
  triggerFired: boolean;
  spentNullifierCount: bigint;
  settledCount: bigint;
  deniedCount: bigint;
  /** proof hash of the latest settlement */
  lastReceiptHash: Bytes32;
  /** true = SETTLED, false = DENIED */
  lastSettled: boolean;
  lastTimestamp: bigint;
}

/** The policy contract's public ledger, decoded. */
export interface PolicyPublicState {
  policyId: Bytes32;
  termsDigest: Bytes32;
  triggerType: number;
  operator: number;
  threshold: bigint;
  payout: bigint;
  premium: bigint;
  start: bigint;
  expiry: bigint;
  funded: bigint;
  enrolled: boolean;
  triggerFired: boolean;
  triggerValue: bigint;
  triggerSource1: Bytes32;
  triggerSource2: Bytes32;
  status: number;
  enrollmentCommitment: Bytes32;
}

function asBytes32(v: unknown, field: string): Bytes32 {
  if (!(v instanceof Uint8Array) || v.length !== 32) {
    throw new Error(`unexpected ${field} in decoded state (expected Bytes<32>)`);
  }
  return bytesToHex(v);
}

function asBigint(v: unknown, field: string): bigint {
  if (typeof v !== 'bigint') throw new Error(`unexpected ${field} in decoded state (expected bigint)`);
  return v;
}

function asBool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`unexpected ${field} in decoded state (expected boolean)`);
  return v;
}

/** Compact enums decode to plain numbers (CompactTypeEnum.fromValue). */
function asEnumInt(v: unknown, field: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`unexpected ${field} in decoded state (expected enum ordinal)`);
  }
  return v;
}

/**
 * Make sure the wasm runtime is initialized before the first decode.
 * Node: the package's own entry initializes synchronously (no hook).
 * Browser: the next.config alias swaps in a shim whose wasm is fetched and
 * instantiated asynchronously — its ensureRuntime() must resolve first.
 */
async function ensureChainRuntime(): Promise<void> {
  const runtimePkg = (await import('@midnight-ntwrk/onchain-runtime-v3')) as {
    ensureRuntime?: () => Promise<void>;
  };
  if (typeof runtimePkg.ensureRuntime === 'function') {
    await runtimePkg.ensureRuntime();
  }
}

/**
 * The committed compiled contract module's ledger decoder (see
 * src/utils/managedContracts.ts) — always resolvable, so no build (fresh
 * clone or Vercel) ever depends on a locally compiled contracts/managed.
 */
async function loadDecoder(name: 'policy' | 'settlement'): Promise<LedgerDecoder> {
  return loadManagedLedgerDecoder(name);
}

/**
 * Fetch and decode a contract's CURRENT public state from the indexer.
 * Throws ChainUnavailableError when the indexer cannot be reached, and a
 * plain Error when the state is missing or does not decode (a contract that
 * does not exist, or a non-Condition contract, must fail loudly — never
 * look like a verified Condition contract).
 */
export async function fetchSettlementState(
  indexerHttp: string,
  settlementAddress: string,
): Promise<SettlementPublicState> {
  const bare = settlementAddress.replace(/^0x/, '').toLowerCase();
  const data = await gql<{ contractAction: { state: string } | null }>(
    indexerHttp,
    `{ contractAction(address:"${bare}") { state } }`,
  );
  const raw = data.contractAction?.state;
  if (!raw) {
    throw new Error(`no public state found for settlement contract ${short(bare)}`);
  }
  const { ContractState } = await import('@midnight-ntwrk/compact-runtime');
  await ensureChainRuntime();
  const ledger = await loadDecoder('settlement');
  const decoded = ledger(ContractState.deserialize(stateHexToBytes(raw)).data);
  const spent = decoded['spent_nullifiers'] as { size: () => bigint } | undefined;
  if (!spent || typeof spent.size !== 'function') {
    throw new Error('decoded state is not a Condition settlement contract (no spent_nullifiers set)');
  }
  return {
    linked: asBool(decoded['linked'], 'linked'),
    policyId: asBytes32(decoded['policy_id'], 'policy_id'),
    termsDigest: asBytes32(decoded['terms_digest_v'], 'terms_digest_v'),
    enrollmentCommitment: asBytes32(decoded['enrollment_commitment'], 'enrollment_commitment'),
    payout: asBigint(decoded['payout'], 'payout'),
    start: asBigint(decoded['start'], 'start'),
    expiry: asBigint(decoded['expiry'], 'expiry'),
    triggerFired: asBool(decoded['trigger_fired'], 'trigger_fired'),
    spentNullifierCount: spent.size(),
    settledCount: asBigint(decoded['settled_count'], 'settled_count'),
    deniedCount: asBigint(decoded['denied_count'], 'denied_count'),
    lastReceiptHash: asBytes32(decoded['last_receipt_hash'], 'last_receipt_hash'),
    lastSettled: asBool(decoded['last_status'], 'last_status'),
    lastTimestamp: asBigint(decoded['last_timestamp'], 'last_timestamp'),
  };
}

/** Fetch and decode a policy contract's public state (terms are public — Invariant 5). */
export async function fetchPolicyState(
  indexerHttp: string,
  policyAddress: string,
): Promise<PolicyPublicState> {
  const bare = policyAddress.replace(/^0x/, '').toLowerCase();
  const data = await gql<{ contractAction: { state: string } | null }>(
    indexerHttp,
    `{ contractAction(address:"${bare}") { state } }`,
  );
  const raw = data.contractAction?.state;
  if (!raw) {
    throw new Error(`no public state found for policy contract ${short(bare)}`);
  }
  const { ContractState } = await import('@midnight-ntwrk/compact-runtime');
  await ensureChainRuntime();
  const ledger = await loadDecoder('policy');
  const decoded = ledger(ContractState.deserialize(stateHexToBytes(raw)).data);
  return {
    policyId: asBytes32(decoded['policy_id'], 'policy_id'),
    termsDigest: asBytes32(decoded['terms_digest_v'], 'terms_digest_v'),
    triggerType: asEnumInt(decoded['trigger_type'], 'trigger_type'),
    operator: asEnumInt(decoded['op'], 'op'),
    threshold: asBigint(decoded['threshold'], 'threshold'),
    payout: asBigint(decoded['payout'], 'payout'),
    premium: asBigint(decoded['premium'], 'premium'),
    start: asBigint(decoded['start'], 'start'),
    expiry: asBigint(decoded['expiry'], 'expiry'),
    funded: asBigint(decoded['funded'], 'funded'),
    enrolled: asBool(decoded['enrolled'], 'enrolled'),
    triggerFired: asBool(decoded['trigger_fired'], 'trigger_fired'),
    triggerValue: asBigint(decoded['trigger_value'], 'trigger_value'),
    triggerSource1: asBytes32(decoded['trigger_source1'], 'trigger_source1'),
    triggerSource2: asBytes32(decoded['trigger_source2'], 'trigger_source2'),
    status: asEnumInt(decoded['status'], 'status'),
    enrollmentCommitment: asBytes32(decoded['enrollment_commitment'], 'enrollment_commitment'),
  };
}

// ---------------------------------------------------------------------------
// Independent verification
// ---------------------------------------------------------------------------

export interface EvidenceCheck {
  id: string;
  label: string;
  passed: boolean;
  /** What was recomputed/fetched — shown to the visitor. */
  detail: string;
  /** Which chain object supplied the evidence. */
  source: string;
}

export interface VerificationResult {
  /** Every check that ran, in order. */
  checks: EvidenceCheck[];
  /** True only when every check passed. */
  valid: boolean;
  /** The settlement contract the verification ran against. */
  settlementAddress: string;
  /** Derived public receipt fields from chain state (when state decoded). */
  receipt?: {
    policyId: Bytes32;
    proofHash: Bytes32;
    triggerOutcome: boolean;
    settled: boolean;
    timestamp: bigint;
    recomputedId: Bytes32;
  };
}

const short = (hex: string, head = 10, tail = 6): string =>
  hex.length > head + tail + 2 ? `${hex.slice(0, head)}…${hex.slice(-tail)}` : hex;

/**
 * Hex → bytes for arbitrary-length blobs (the indexer's serialized contract
 * state). core/hashing's hexToBytes is strictly Bytes32-shaped and must not
 * be used here.
 */
function stateHexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('odd-length hex state blob');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Independently verify a claimed receipt id against ONE settlement
 * contract's public state, fetched live from the indexer. Every value used
 * comes from the chain in this call — no session state, no local mirror,
 * no wallet. The recomputation itself is the pure receiptIdDigest from
 * src/core/hashing (pinned by tests/compactParity.test.ts).
 */
export async function verifyReceiptAgainstContract(
  indexerHttp: string,
  settlementAddress: string,
  claimedReceiptId: string,
): Promise<VerificationResult> {
  const checks: EvidenceCheck[] = [];
  const claimed = claimedReceiptId.trim().replace(/^0x/, '').toLowerCase();
  const wellFormed = /^[0-9a-f]{64}$/.test(claimed);
  checks.push({
    id: 'shape',
    label: 'receipt id is a well-formed 32-byte hash',
    passed: wellFormed,
    detail: wellFormed ? `0x${claimed}` : 'not 0x + 64 hex chars',
    source: 'input',
  });
  if (!wellFormed) {
    return { checks, valid: false, settlementAddress };
  }

  let state: SettlementPublicState;
  try {
    state = await fetchSettlementState(indexerHttp, settlementAddress);
  } catch (err) {
    // Network failure is a different failure class than "receipt not
    // found" — the caller must be able to tell them apart.
    if (err instanceof ChainUnavailableError) throw err;
    checks.push({
      id: 'state',
      label: 'settlement contract public state fetched from Midnight Preprod',
      passed: false,
      detail: err instanceof Error ? err.message : String(err),
      source: `indexer · contract ${short(settlementAddress)}`,
    });
    return { checks, valid: false, settlementAddress };
  }
  checks.push({
    id: 'state',
    label: 'settlement contract public state fetched from Midnight Preprod',
    passed: true,
    detail: `linked=${state.linked} · settled=${state.settledCount} · denied=${state.deniedCount}`,
    source: `indexer · contract ${short(settlementAddress)}`,
  });

  const outcome = state.triggerFired;
  const recomputed = receiptIdDigest(
    state.policyId,
    state.lastReceiptHash,
    outcome,
    state.lastSettled,
    Number(state.lastTimestamp),
  );
  const match = recomputed.replace(/^0x/, '').toLowerCase() === claimed;
  checks.push({
    id: 'receipt-digest',
    label: 'receipt id recomputes from on-chain public fields',
    passed: match,
    detail: `H(receipt, policyId ${short(state.policyId)}, proofHash ${short(state.lastReceiptHash)}, outcome ${outcome}, settled ${state.lastSettled}, ts ${state.lastTimestamp}) = ${recomputed}`,
    source: `indexer · contract ${short(settlementAddress)}`,
  });

  const result: VerificationResult = {
    checks,
    valid: match,
    settlementAddress,
    receipt: {
      policyId: state.policyId,
      proofHash: state.lastReceiptHash,
      triggerOutcome: outcome,
      settled: state.lastSettled,
      timestamp: state.lastTimestamp,
      recomputedId: recomputed,
    },
  };

  // Cross-checks against the policy contract: find its address from the
  // known deployments (the settlement instance does not store the policy
  // contract address on chain — the smallest architecture keeps this as
  // public, committed metadata).
  const deployment = PREPROD_DEPLOYMENTS.find((d) => d.settlementAddress === settlementAddress.replace(/^0x/, ''));
  if (deployment) {
    try {
      const policy = await fetchPolicyState(indexerHttp, deployment.policyAddress);
      const idMatch = policy.policyId === state.policyId;
      checks.push({
        id: 'policy-id-mirror',
        label: 'settlement mirrors the policy contract’s policy id',
        passed: idMatch,
        detail: `${state.policyId}`,
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
      const termsMatch = policy.termsDigest === state.termsDigest;
      checks.push({
        id: 'terms-mirror',
        label: 'settlement mirrors the policy contract’s terms digest',
        passed: termsMatch,
        detail: `${state.termsDigest}`,
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
      const commitmentMatch = policy.enrollmentCommitment === state.enrollmentCommitment;
      checks.push({
        id: 'commitment-mirror',
        label: 'settlement mirrors the policy contract’s enrollment commitment',
        passed: commitmentMatch,
        detail: `${state.enrollmentCommitment}`,
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
      const outcomeMatch = policy.triggerFired === state.triggerFired;
      checks.push({
        id: 'outcome-mirror',
        label: 'settlement mirrors the policy contract’s trigger outcome',
        passed: outcomeMatch,
        detail: `outcome ${state.triggerFired}`,
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
      // Terms transparency: the digest must recompute from the public terms
      // (Invariant 5) — anyone can read the terms and re-derive the digest.
      const terms: PolicyTerms = {
        triggerType: [TriggerType.TEMPERATURE, TriggerType.RAINFALL_MM, TriggerType.FLIGHT_DELAY_MIN, TriggerType.EARTHQUAKE_MAG][policy.triggerType] ?? TriggerType.TEMPERATURE,
        operator: [ComparisonOp.GT, ComparisonOp.GTE, ComparisonOp.LT, ComparisonOp.LTE, ComparisonOp.EQ][policy.operator] ?? ComparisonOp.GTE,
        threshold: Number(policy.threshold),
        payoutAmount: policy.payout,
        premium: policy.premium,
        coverageStart: Number(policy.start),
        expiry: Number(policy.expiry),
      };
      const recomputedTerms = termsDigestOf(policy.policyId, terms);
      const TRIGGER_NAMES = ['temperature', 'rainfall_mm', 'flight_delay_min', 'earthquake_mag'];
      const OP_NAMES = ['>', '>=', '<', '<=', '=='];
      checks.push({
        id: 'terms-digest',
        label: 'terms digest recomputes from the public policy terms',
        passed: recomputedTerms === policy.termsDigest,
        detail: `${TRIGGER_NAMES[policy.triggerType] ?? '?'} ${OP_NAMES[policy.operator] ?? '?'} ${policy.threshold} · payout ${policy.payout} · premium ${policy.premium} · window ${policy.start}–${policy.expiry}`,
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
    } catch (err) {
      checks.push({
        id: 'policy-mirror',
        label: 'policy contract cross-check',
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
        source: `indexer · policy ${short(deployment.policyAddress)}`,
      });
    }
  }

  result.valid = checks.every((c) => c.passed);
  return result;
}

/**
 * Verify a receipt id against all known Condition deployments (public
 * addresses from docs/DEPLOYMENTS.md). The first contract whose state
 * recomputes the id wins; all-checks-failed results from every contract are
 * reported so the UI can be honest about "not found on the known
 * deployments".
 */
export async function verifyReceiptId(
  indexerHttp: string,
  claimedReceiptId: string,
  settlementAddressOverride?: string,
): Promise<{ results: VerificationResult[]; matched: VerificationResult | null }> {
  if (settlementAddressOverride?.trim()) {
    const r = await verifyReceiptAgainstContract(indexerHttp, settlementAddressOverride.trim(), claimedReceiptId);
    return { results: [r], matched: r.valid ? r : null };
  }
  const results: VerificationResult[] = [];
  for (const d of PREPROD_DEPLOYMENTS) {
    const r = await verifyReceiptAgainstContract(indexerHttp, d.settlementAddress, claimedReceiptId);
    if (r.valid) return { results: [r], matched: r };
    // A state fetch failure is not evidence of absence — keep trying.
    if (r.checks.some((c) => c.id === 'state' && !c.passed)) continue;
    results.push(r);
  }
  return { results, matched: null };
}

/** Find the known deployment a contract address belongs to, if any. */
export function findDeploymentByAddress(address: string): KnownDeployment | undefined {
  const bare = address.replace(/^0x/, '').toLowerCase();
  return PREPROD_DEPLOYMENTS.find(
    (d) => d.policyAddress === bare || d.settlementAddress === bare,
  );
}
