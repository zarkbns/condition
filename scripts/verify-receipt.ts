// Live re-verification of Condition's public receipt against Midnight
// Preprod — the exact path /verify runs in a stranger's browser (plain
// HTTPS GraphQL + authoritative onchain-runtime state decode + NIST sha256
// recomputation). No wallet, no seed, no session state.
//
//   npx tsx scripts/verify-receipt.ts            # verify the documented receipt
//   npx tsx scripts/verify-receipt.ts 0x<id>     # verify any receipt id
//
// Exit 0 only when every evidence check passes. Writes nothing.

import {
  DEFAULT_INDEXER_HTTP,
  PREPROD_DEPLOYMENTS,
  fetchChainHead,
  fetchTxByHash,
  fetchBlockByHeight,
  verifyReceiptAgainstContract,
  verifyReceiptId,
} from '../src/utils/publicChain.js';

const INDEXER = process.env['NEXT_PUBLIC_MIDNIGHT_INDEXER'] ?? DEFAULT_INDEXER_HTTP;
const claimed = process.argv[2] ?? PREPROD_DEPLOYMENTS[0]!.receiptId;
const d = PREPROD_DEPLOYMENTS[0]!;

console.log(`Condition public receipt verification — Midnight Preprod`);
console.log(`indexer: ${INDEXER}`);
console.log(`claimed receipt id: ${claimed}\n`);

// 1. The network is alive and moving.
const head = await fetchChainHead(INDEXER);
console.log(`chain head: block ${head.height} (${new Date(head.timeMs).toISOString()})`);
if (head.timeMs < Date.now() - 60 * 60 * 1000) {
  console.log('  [note] indexer appears stale (>1h behind wall clock)');
}

// 2. The documented lifecycle txs exist on chain with SUCCESS status.
console.log(`\nrecorded lifecycle txs (${d.label}):`);
for (const step of d.lifecycle) {
  const tx = await fetchTxByHash(INDEXER, step.txHash);
  const status = tx?.status ?? 'NOT FOUND';
  const height = tx?.blockHeight ?? 0;
  const ok = status === 'SUCCESS' && height === step.block;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step.step.padEnd(18)} block ${String(height).padStart(7)} (expect ${step.block})  ${status}`);
  if (!ok) process.exitCode = 1;
}

// 3. The settle block still holds the settle tx with SUCCESS.
const settle = d.lifecycle[d.lifecycle.length - 1]!;
const block = await fetchBlockByHeight(INDEXER, settle.block);
const blockHasSettle = block?.transactions.some((t) => t.hash === settle.txHash && t.status === 'SUCCESS');
console.log(`\nblock ${settle.block} re-scanned: settle tx ${blockHasSettle ? 'PRESENT + SUCCESS' : 'MISSING'}`);
if (!blockHasSettle) process.exitCode = 1;

// 4. Independent receipt verification from live contract state.
const deployment = d.settlementAddress;
console.log(`\nverifying against settlement contract ${deployment}`);
const result = await verifyReceiptAgainstContract(INDEXER, deployment, claimed);
for (const c of result.checks) {
  console.log(`  ${c.passed ? 'PASS' : 'FAIL'}  ${c.label}`);
  console.log(`        ${c.detail}`);
  console.log(`        source: ${c.source}`);
}
console.log(`\nVERDICT: ${result.valid ? 'VERIFIED — every check recomputed from live Preprod data' : 'NOT VERIFIED'}`);
if (!result.valid) process.exitCode = 1;

// 5. The generic discovery path (all known deployments) agrees.
const { matched } = await verifyReceiptId(INDEXER, claimed);
console.log(`discovery path (verifyReceiptId): ${matched ? 'matched' : 'no match'}`);
if (!matched && result.valid) process.exitCode = 1;
