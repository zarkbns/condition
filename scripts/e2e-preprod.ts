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
// Stages (--stage=…):
//   full    (default) the whole lifecycle in one process
//   public  create + fund, then record the PUBLIC state and stop
//   claim   adopt that recorded state, then enroll + trigger + claim + settle
//
// The split exists for memory-constrained devices (this repo's dev host has
// 2.7GB): the wallet stack plus eight sequential proving steps in one
// process gets Android's low-memory killer. Each stage is still a real
// on-chain run with the same parity checks — nothing is simulated, and the
// hand-off file carries ONLY public data (policy id, contract address,
// terms, timestamps). The holder secret is generated inside the `claim`
// process and never leaves it (Invariant 2).
//
// Usage:
//   MIDNIGHT_WALLET_SEED=<hex-seed> npx tsx scripts/e2e-preprod.ts
//   MIDNIGHT_WALLET_SEED=<hex-seed> npx tsx scripts/e2e-preprod.ts --stage=public
//   MIDNIGHT_WALLET_SEED=<hex-seed> npx tsx scripts/e2e-preprod.ts --stage=claim
//
// Requires a reachable proof server for contract proving (the local
// midnightntwrk/proof-server:8.1.0 — see docs/DEPLOYMENTS.md). When the
// network is unreachable or the seed is missing, the script FAILS LOUDLY —
// it never silently falls back to a simulation.

import {
  probeEndpoints,
  preprodConfigFromEnv,
  createPreprodRuntime,
} from '../src/utils/preprodRuntime.js';
import { inCoverageWindow } from '../src/core/payout.js';
import { randomAddress } from '../src/core/hashing.js';
import { TriggerType, ComparisonOp, type Dust, type PolicyTerms } from '../src/types/index.js';

const PAYOUT: Dust = 5_000_000_000n;
const PREMIUM: Dust = 100_000_000n;
const THRESHOLD = 3500;
const NOW = Math.floor(Date.now() / 1000);
const EXPIRY = NOW + 30 * 86_400;

type Stage = 'full' | 'public' | 'claim';

/** Public hand-off between stages — never contains secret material. */
interface E2EState {
  insurer: string;
  terms: {
    triggerType: string;
    operator: string;
    threshold: number;
    payoutAmount: string;
    premium: string;
    coverageStart: number;
    expiry: number;
  };
  createdAt: number;
  policyId: string;
  contractAddress: string;
  fundedAmount: string;
  readings: Array<{ source: string; value: number }>;
  triggerAt: number;
  claimAt: number;
  settleAt: number;
}

function step(label: string): void {
  console.log(`\n── ${label} ─────────────────────────────────────────────`);
}

function parseStage(): Stage {
  const arg = process.argv.find((a) => a.startsWith('--stage='));
  const value = arg?.split('=')[1] ?? 'full';
  if (value !== 'full' && value !== 'public' && value !== 'claim') {
    console.error(`✗ unknown --stage=${value} (expected full | public | claim)`);
    process.exit(1);
  }
  return value;
}

async function statePath(): Promise<string> {
  const { join, dirname } = await import(/* webpackIgnore: true */ 'node:path');
  const { fileURLToPath } = await import(/* webpackIgnore: true */ 'node:url');
  return join(dirname(fileURLToPath(import.meta.url)), '..', '.qwen', 'e2e-state.json');
}

async function writeState(state: E2EState): Promise<void> {
  const { mkdir, writeFile } = await import(/* webpackIgnore: true */ 'node:fs/promises');
  const { dirname } = await import(/* webpackIgnore: true */ 'node:path');
  const path = await statePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`  state file    ${path} (public fields only)`);
}

async function readState(): Promise<E2EState> {
  const { readFile } = await import(/* webpackIgnore: true */ 'node:fs/promises');
  const { dirname, join } = await import(/* webpackIgnore: true */ 'node:path');
  const { fileURLToPath } = await import(/* webpackIgnore: true */ 'node:url');
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.qwen', 'e2e-state.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    console.error(
      `✗ no hand-off state at ${path}\n  Run --stage=public first (it records the deployed policy).`,
    );
    process.exit(1);
  }
  return JSON.parse(raw) as E2EState;
}

function termsFromState(s: E2EState): PolicyTerms {
  return {
    triggerType: s.terms.triggerType as TriggerType,
    operator: s.terms.operator as ComparisonOp,
    threshold: s.terms.threshold,
    payoutAmount: BigInt(s.terms.payoutAmount),
    premium: BigInt(s.terms.premium),
    coverageStart: s.terms.coverageStart,
    expiry: s.terms.expiry,
  };
}

function termsToState(terms: PolicyTerms) {
  return {
    triggerType: String(terms.triggerType),
    operator: String(terms.operator),
    threshold: terms.threshold,
    payoutAmount: terms.payoutAmount.toString(),
    premium: terms.premium.toString(),
    coverageStart: terms.coverageStart,
    expiry: terms.expiry,
  };
}

async function main(): Promise<void> {
  const stage = parseStage();
  const config = preprodConfigFromEnv(process.env);

  step(`PROBE PREPROD ENDPOINTS (stage: ${stage})`);
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

  // `claim` adopts the policy deployed by a previous `public` stage; the
  // rest of the lifecycle then runs against that same live contract.
  let insurer: string;
  let terms: PolicyTerms;
  let policyId: string;
  let createdAt: number;

  if (stage === 'claim') {
    const state = await readState();
    insurer = state.insurer;
    terms = termsFromState(state);
    createdAt = state.createdAt;
    step(`ADOPT POLICY ${state.policyId.slice(0, 18)}… (no txs — mirror replay only)`);
    const adopted = await runtime.adoptPolicy({
      insurer: insurer as `0x${string}`,
      terms,
      createdAt,
      expectedPolicyId: state.policyId as `0x${string}`,
      contractAddress: state.contractAddress,
      fundedAmount: BigInt(state.fundedAmount),
    });
    policyId = adopted.policyId;
    console.log(`  policyId      ${policyId} (replay matched the record)`);
    console.log(`  contract      ${state.contractAddress}`);
    await runClaimStage(runtime, policyId, state);
    return;
  }

  insurer = randomAddress();
  terms = {
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
  policyId = policy.policyId;
  const contractAddress = runtime.onChainClient.policyContracts.get(policyId) ?? '';
  console.log(`  policyId      ${policyId}`);
  console.log(`  termsDigest   ${policy.termsDigest}`);
  console.log(`  contract      ${contractAddress}`);

  step('FUND ESCROW (fund())');
  await runtime.policyService.fund(policyId, PAYOUT, NOW);
  console.log('  funded on-chain + local mirror');

  const state: E2EState = {
    insurer,
    terms: termsToState(terms),
    createdAt: NOW,
    policyId,
    contractAddress,
    fundedAmount: PAYOUT.toString(),
    readings: [
      { source: 'open-meteo', value: 4000 },
      { source: 'noaa', value: 3600 },
    ],
    triggerAt: NOW + 10,
    claimAt: NOW + 20,
    settleAt: NOW + 30,
  };

  if (stage === 'public') {
    step('RECORD PUBLIC STATE (stop here; --stage=claim finishes the loop)');
    await writeState(state);
    console.log('\n✓ STAGE 1 COMPLETE — policy deployed and funded on Preprod');
    console.log(`  next: npx tsx scripts/e2e-preprod.ts --stage=claim`);
    return;
  }

  await runClaimStage(runtime, policyId, state);
}

/** enroll → trigger → claim proof → settle → public receipt verification. */
async function runClaimStage(
  runtime: Awaited<ReturnType<typeof createPreprodRuntime>>['runtime'],
  policyId: string,
  state: E2EState,
): Promise<void> {
  step('ENROLL HOLDER (enroll() — commitment only, client-side secret)');
  const { commitment } = await runtime.claimService.enroll(policyId, state.createdAt);
  await runtime.policyService.publishEnrollment(
    policyId, commitment, BigInt(state.terms.premium), state.createdAt,
  );
  console.log(`  commitment    ${commitment}`);

  step('RECORD 2-SOURCE TRIGGER (record_trigger())');
  await runtime.triggerService.registerSource('open-meteo');
  await runtime.triggerService.registerSource('noaa');
  await runtime.triggerService.submitReadings(policyId, state.readings, state.triggerAt);
  const triggered = await runtime.policyService.getPolicy(policyId);
  console.log(`  outcome       ${triggered.trigger?.outcome} (observed ${triggered.trigger?.observedValue})`);

  step('PRIVATE CLAIM (client-side proof — Invariant 2)');
  const proof = await runtime.claimService.submitClaim(policyId, state.claimAt);
  console.log(`  nullifier     ${proof.publicInputs.nullifier}`);
  console.log(`  proofHash     ${proof.proofHash}`);

  step('SETTLE ON PREPROD (deploy SettlementContract + link() + settle())');
  const snapshot = await runtime.policyService.getPolicy(policyId);
  const witnessProvider = () => ({
    policyId,
    holderSecret: runtime.claimService.secretFor(policyId),
    settlementAmount:
      snapshot.trigger?.outcome && inCoverageWindow(snapshot.terms, state.claimAt)
        ? snapshot.terms.payoutAmount
        : 0n,
    claimTime: state.claimAt,
    triggerEvidence:
      snapshot.trigger ?? { readings: [], outcome: false, observedValue: 0, recordedAt: 0 },
  });
  const settlement = await runtime.settlementService.settle(
    state.settleAt, proof, policyId, witnessProvider as never,
  );
  console.log(`  receipt id    ${settlement.receipt.receiptId}`);
  console.log(`  status        ${settlement.receipt.status}`);
  console.log(`  released      ${settlement.releasedAmount} (private ledger only)`);

  step('PUBLIC RECEIPT (verifiable from public data alone)');
  const verify = await runtime.settlementService.verifyReceipt(settlement.receipt.receiptId);
  console.log(`  verify        ${verify.valid ? 'VALID' : 'INVALID'}`);
  if (!verify.valid) {
    console.error('\n✗ receipt did not verify from public data — that is a real failure.');
    process.exit(1);
  }

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
