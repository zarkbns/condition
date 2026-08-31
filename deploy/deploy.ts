// Deployment entry (BUILD_SPEC.md §11).
//
// On a machine with the Compact toolchain + Midnight network access this
// compiles the contracts and deploys instances; on constrained platforms
// (Android/Termux) it runs a dry-run against the reference runtime and says
// so. Never logs secrets — deployment identity comes from the environment.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRuntime } from '../src/utils/midnight.js';
import { randomAddress } from '../src/core/hashing.js';
import { ComparisonOp, TriggerType } from '../src/types/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface DeploymentRecord {
  network: string;
  deployedAt: string;
  contracts: Record<string, string>;
  note: string;
}

function compactAvailable(): boolean {
  const probe = spawnSync('compact', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

function referenceDryRun(): DeploymentRecord {
  // Exercise the full Wave 1 loop once against the reference runtime —
  // if this fails, the deployment would fail too.
  const runtime = createRuntime({
    nodeUrl: process.env['MIDNIGHT_NODE_URL'],
    appName: 'Condition',
  });
  const insurer = randomAddress();
  const now = Math.floor(Date.now() / 1000);
  const policy = runtime.policyService.create(insurer, {
    triggerType: TriggerType.TEMPERATURE,
    operator: ComparisonOp.GTE,
    threshold: 3500,
    payoutAmount: 5_000_000_000n,
    premium: 100_000_000n,
    coverageStart: now,
    expiry: now + 30 * 86_400,
  }, now);
  runtime.policyService.fund(policy.policyId, 5_000_000_000n, now);
  const { commitment } = runtime.claimService.enroll(policy.policyId, now);
  runtime.policyService.publishEnrollment(policy.policyId, commitment, 100_000_000n, now);
  runtime.triggerService.registerSource('open-meteo');
  runtime.triggerService.registerSource('noaa');
  runtime.triggerService.submitReadings(policy.policyId, [
    { source: 'open-meteo', value: 4000 },
    { source: 'noaa', value: 3600 },
  ], now);
  const proof = runtime.claimService.submitClaim(policy.policyId, now);
  const secret = runtime.privateLedger.secretFor(policy.policyId);
  const trigger = runtime.publicLedger.getPolicy(policy.policyId).trigger!;
  const { receipt } = runtime.settlementService.settle(now, proof, policy.policyId, () => ({
    policyId: policy.policyId,
    holderSecret: secret,
    settlementAmount: 5_000_000_000n,
    claimTime: now,
    triggerEvidence: trigger,
  }));
  if (receipt.status !== 'SETTLED') {
    throw new Error(`reference dry-run failed: receipt ${receipt.status}`);
  }
  return {
    network: 'reference-runtime (dry-run)',
    deployedAt: new Date().toISOString(),
    contracts: { reference: policy.policyId },
    note: 'Full Wave 1 loop verified against the in-process reference runtime. ' +
      'Deploy to Midnight testnet from a glibc machine with the compact ' +
      'toolchain: npm install -g @midnight-ntwrk/compact && npm run deploy.',
  };
}

function main(): void {
  console.log('condition deploy');
  let record: DeploymentRecord;

  if (!compactAvailable()) {
    console.log('compact compiler not found — running reference-runtime dry-run.');
    record = referenceDryRun();
  } else {
    // Compile + deploy path (glibc machines). Addresses are recorded after
    // deployment; this placeholder path is finished by the deploy tooling
    // integration in the testnet milestone.
    const build = spawnSync('npm', ['run', 'build:contracts'], { stdio: 'inherit', cwd: root });
    if (build.status !== 0) {
      throw new Error('contract compilation failed');
    }
    record = {
      network: process.env['MIDNIGHT_NODE_URL'] ?? 'testnet',
      deployedAt: new Date().toISOString(),
      contracts: {},
      note: 'Contracts compiled. Instance deployment requires midnight-js wallet ' +
        'funding; see docs/MIDNIGHT_NOTES.md §3.',
    };
  }

  const deployDir = join(root, 'deploy');
  if (!existsSync(deployDir)) {
    mkdirSync(deployDir, { recursive: true });
  }
  writeFileSync(join(deployDir, 'deployments.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`deployments written to deploy/deployments.json (${record.network})`);
}

main();
