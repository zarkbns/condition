// E2E — complete live Preprod lifecycle through the REAL runtime the
// frontend uses (PreprodConditionRuntime over the live facade stack):
//
//   create policy → fund → enroll → 2-source trigger → private claim →
//   settle → public receipt
//
// Every operation runs the exact code path the UI drives, against the
// deployed contract family, with live parity checks (policyId, enrollment
// commitment, receipt id) between the on-chain circuits and the local
// reference runtime.
//
// Privacy (Invariant 1/2): the holder secret lives only inside the local
// witness closures; the script never logs it and the on-chain settle()
// circuit only ever discloses proof hash + status + timestamp.
//
// Usage:
//   MIDNIGHT_WALLET_SEED=<hex-seed> npx tsx scripts/e2e-preprod.ts
//
// Requires a reachable proof server for contract proving (the local Docker
// one at http://127.0.0.1:6300 by default — see docs/DEPLOYMENTS.md). When
// the network is unreachable or the seed is missing, the script FAILS
// LOUDLY — it never silently falls back to a simulation.

import {
  probeEndpoints,
  preprodConfigFromEnv,
  createPreprodRuntime,
} from '../src/utils/preprodRuntime.js';
import { inCoverageWindow } from '../src/core/payout.js';
import { randomAddress } from '../src/core/hashing.js';
import { TriggerType, ComparisonOp, type Dust } from '../src/types/index.js';

const PAYOUT: Dust = 5_000_000_000n;
const PREMIUM: Dust = 100_000_000n;
const THRESHOLD = 3500;
const NOW = Math.floor(Date.now() / 1000);
const EXPIRY = NOW + 30 * 86_400;

function step(label: string): void {
  console.log(`\n── ${label} ─────────────────────────────────────────────`);
}

async function main(): Promise<void> {
  const config = preprodConfigFromEnv(process.env);

  step('PROBE PREPROD ENDPOINTS');
  const endpoints = await probeEndpoints(config);
  console.log(
    `  indexer ${endpoints.indexer ? 'OK' : 'DOWN'} · prover ${endpoints.prover ? 'OK' : 'DOWN'} · node ${endpoints.node ? 'OK' : 'DOWN'}`,
  );
  if (!endpoints.indexer || !endpoints.node) {
    console.error(
      `\n✗ Preprod indexer/node unreachable from this device. On-chain E2E cannot run.\n` +
      `  Run this script from a network with Midnight egress.\n` +
      `  The frontend shows the same 'network down' warning instead of silently simulating.`,
    );
    process.exit(1);
  }
  if (!endpoints.prover) {
    console.error(
      `  ✗ no proof server reachable at ${config.prover} — contract proving will fail.\n` +
      `    Start the local proof server first (see docs/DEPLOYMENTS.md and .qwen/launch-proofserver810.sh).`,
    );
    process.exit(1);
  }

  step('CONNECT (live facade stack — wallet, providers, dust bootstrap)');
  const { runtime, status } = await createPreprodRuntime(config);
  console.log(`  mode          ${status.mode}`);
  console.log(`  wallet        ${status.walletAddress}`);
  console.log(`  dust balance  ${status.balance ?? 0n}`);
  if (status.mode !== 'preprod') {
    console.error(
      `\n✗ Runtime not in preprod mode (${status.mode}: ${status.error ?? 'unknown'}).`,
    );
    console.error(`  Set MIDNIGHT_WALLET_SEED (a funded preprod seed) to run on-chain.`);
    process.exit(1);
  }

  const insurer = randomAddress();
  const terms = {
    triggerType: TriggerType.TEMPERATURE,
    operator: ComparisonOp.GTE,
    threshold: THRESHOLD,
    payoutAmount: PAYOUT,
    premium: PREMIUM,
    coverageStart: NOW,
    expiry: EXPIRY,
  };

  step('CREATE POLICY (deploy PolicyContract + create(), live parity check)');
  const policy = await runtime.policyService.create(insurer, terms, NOW);
  console.log(`  policyId      ${policy.policyId}`);
  console.log(`  termsDigest   ${policy.termsDigest}`);

  step('FUND ESCROW (fund())');
  await runtime.policyService.fund(policy.policyId, PAYOUT, NOW);
  console.log('  funded on-chain + local mirror');

  step('ENROLL HOLDER (enroll() — commitment only, client-side secret)');
  const { commitment } = await runtime.claimService.enroll(policy.policyId, NOW);
  await runtime.policyService.publishEnrollment(policy.policyId, commitment, PREMIUM, NOW);
  console.log(`  commitment    ${commitment}`);

  step('RECORD 2-SOURCE TRIGGER (record_trigger())');
  await runtime.triggerService.registerSource('open-meteo');
  await runtime.triggerService.registerSource('noaa');
  await runtime.triggerService.submitReadings(
    policy.policyId,
    [
      { source: 'open-meteo', value: 4000 },
      { source: 'noaa', value: 3600 },
    ],
    NOW + 10,
  );
  const triggered = await runtime.policyService.getPolicy(policy.policyId);
  console.log(`  outcome       ${triggered.trigger?.outcome} (observed ${triggered.trigger?.observedValue})`);

  step('PRIVATE CLAIM (client-side proof — Invariant 2)');
  const claimTime = NOW + 20;
  const proof = await runtime.claimService.submitClaim(policy.policyId, claimTime);
  console.log(`  nullifier     ${proof.publicInputs.nullifier}`);
  console.log(`  proofHash     ${proof.proofHash}`);

  step('SETTLE ON PREPROD (deploy SettlementContract + link() + settle())');
  const settleTime = NOW + 30;
  const snapshot = await runtime.policyService.getPolicy(policy.policyId);
  const witnessProvider = () => ({
    policyId: policy.policyId,
    holderSecret: runtime.claimService.secretFor(policy.policyId),
    settlementAmount:
      snapshot.trigger?.outcome && inCoverageWindow(snapshot.terms, claimTime)
        ? snapshot.terms.payoutAmount
        : 0n,
    claimTime,
    triggerEvidence:
      snapshot.trigger ?? { readings: [], outcome: false, observedValue: 0, recordedAt: 0 },
  });
  const settlement = await runtime.settlementService.settle(
    settleTime, proof, policy.policyId, witnessProvider as never,
  );
  console.log(`  receipt id    ${settlement.receipt.receiptId}`);
  console.log(`  status        ${settlement.receipt.status}`);
  console.log(`  released      ${settlement.releasedAmount} (private ledger only)`);

  step('PUBLIC RECEIPT (verifiable from public data alone)');
  const verify = await runtime.settlementService.verifyReceipt(settlement.receipt.receiptId);
  console.log(`  verify        ${verify.valid ? '✅ VALID' : '❌ INVALID'}`);

  step('RESULT');
  const history = runtime.txHistory();
  console.log('  state machine: create → fund → enroll → trigger → claim → settle → receipt');
  console.log(`  on-chain txs  ${history.map((t) => t.action).join(' → ')}`);
  for (const t of history) {
    console.log(`    ${t.action.padEnd(14)} ${t.txHash}`);
  }
  console.log('\n✓ LIVE PREPROD E2E COMPLETE');
}

main().catch((err) => {
  console.error(`\n✗ E2E failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
