// Deployment entry (BUILD_SPEC.md §11).
//
// Three tiers, best-first:
//
//   1. TESTNET DEPLOY — requires MIDNIGHT_NODE_URL reachable + a funded
//      wallet (seed via MIDNIGHT_WALLET_SEED env, never committed). Deploys
//      the compiled contracts with the real Midnight JS SDK
//      (deployContract + wallet + indexer + proof providers) and records
//      contract addresses + deploy tx hashes.
//
//   2. LOCAL REAL-RUNTIME VERIFICATION — when the network is unreachable
//      (e.g. this build environment's egress blocks midnight.network),
//      executes the compiled contracts against the real
//      @midnight-ntwrk/compact-runtime: the full lifecycle
//      ACTIVE → SUBMITTED → VERIFIED → SETTLED → PAID, with every digest
//      asserted identical to the TS reference runtime. Same compiled code
//      that would be deployed — proof the contracts execute.
//
//   3. REFERENCE DRY-RUN — no compiled contracts present: TS reference
//      runtime loop only (build machines without the toolchain).
//
// Every tier writes deploy/deployments.json recording exactly what ran.
// Never logs secrets — wallet identity comes from the environment.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managed = (name: string) => join(root, 'contracts', 'managed', name);

interface DeploymentRecord {
  network: string;
  deployedAt: string;
  /** tier that actually ran */
  tier: 'testnet' | 'local-real-runtime' | 'reference-dry-run';
  contracts: Record<string, string>;
  transactionHashes?: string[];
  evidence?: Record<string, unknown>;
  note: string;
}

const INDEXER_HTTP = 'https://indexer.testnet-02.midnight.network/api/v1/graphql';
const INDEXER_WS = 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws';
const PROVER_URL = 'https://prover.testnet-02.midnight.network';

async function probeNetwork(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) });
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Minimal in-memory PrivateStateProvider for the deployer's fresh states. */
function inMemoryPrivateState() {
  const store = new Map<string, unknown>();
  return {
    setContractAddress: (_address: unknown) => {},
    set: async (id: string, state: unknown) => {
      store.set(id, state);
    },
    get: async (id: string) => store.get(id) ?? null,
    remove: async (id: string) => {
      store.delete(id);
    },
    // The wallet adapter contract also expects these derived-key methods.
    derivedKeys: {
      get: async () => new Map(),
      set: async () => {},
      remove: async () => {},
    },
  };
}

async function deployToTestnet(nodeUrl: string): Promise<DeploymentRecord> {
  // Real SDK deployment. Dynamic imports so local tiers never touch the
  // network packages.
  const { WalletBuilder } = await import('@midnight-ntwrk/wallet');
  const { NetworkId } = await import('@midnight-ntwrk/zswap');
  const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
  const { NodeZkConfigProvider } = await import(
    '@midnight-ntwrk/midnight-js-node-zk-config-provider'
  );
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const loadCompiled = async (name: 'policy' | 'settlement') =>
    (await import(`../contracts/managed/${name}/contract/index.js`)) as {
      Contract: new (witnesses: unknown) => unknown;
    };
  const { Contract: PolicyContract } = await loadCompiled('policy');
  const { Contract: SettlementContract } = await loadCompiled('settlement');

  const seed = process.env['MIDNIGHT_WALLET_SEED'];
  if (!seed) {
    throw new Error(
      'testnet deploy requires MIDNIGHT_WALLET_SEED (a funded testnet seed; never commit it)',
    );
  }

  // Naive wallet built from the seed — sufficient for contract deployment.
  const wallet = await WalletBuilder.buildFromSeed(
    INDEXER_HTTP,
    INDEXER_WS,
    PROVER_URL,
    nodeUrl,
    seed,
    NetworkId.TestNet,
  );
  try {
    const privateStateProvider = inMemoryPrivateState();
    const zkConfigProvider = new NodeZkConfigProvider(join(root, 'contracts', 'managed'));
    const publicDataProvider = indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS);
    const proofProvider = httpClientProofProvider(PROVER_URL, zkConfigProvider);

    // The wallet doubles as walletProvider (balancing/keys) and
    // midnightProvider (tx submission).
    const providers = {
      privateStateProvider,
      zkConfigProvider,
      publicDataProvider,
      proofProvider,
      walletProvider: wallet,
      midnightProvider: wallet,
    } as never; // SDK composes these structurally; exact generic wiring is SDK-side

    const deployed: Array<{ name: string; address?: string; txHash?: string }> = [];
    for (const [name, contract] of [
      ['policy', PolicyContract],
      ['settlement', SettlementContract],
    ] as const) {
      const result = (await deployContract(providers, {
        contract,
        // Both Condition contracts take no constructor args (state starts
        // empty; create()/link() initialize per-policy instances).
        args: [],
      } as never)) as unknown as {
        deployTxData: { txHash?: string; contractAddress?: { address?: string } };
      };
      deployed.push({
        name,
        address: result.deployTxData?.contractAddress?.address,
        txHash: result.deployTxData?.txHash,
      });
    }

    return {
      network: nodeUrl,
      deployedAt: new Date().toISOString(),
      tier: 'testnet',
      contracts: Object.fromEntries(
        deployed.map((d) => [d.name, d.address ?? d.txHash ?? 'deployed']),
      ),
      transactionHashes: deployed
        .map((d) => d.txHash)
        .filter((h): h is string => typeof h === 'string'),
      note: 'Deployed compiled Compact contracts to Midnight testnet via midnight-js.',
    };
  } finally {
    await wallet.close();
  }
}

async function localRealRuntime(): Promise<DeploymentRecord> {
  // Same compiled contract code, executed against the real compact-runtime
  // locally. Delegates to the demo, which asserts cross-layer digest parity
  // at every stage and exits non-zero on any mismatch.
  const demo = spawnSync('npx', ['tsx', join(root, 'scripts', 'demo-lifecycle.ts'), '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
  });
  if (demo.status !== 0) {
    throw new Error(
      `local real-runtime verification failed:\n${demo.stdout ?? ''}\n${demo.stderr ?? ''}`,
    );
  }
  const payload = JSON.parse(demo.stdout!.trim().split('\n').pop()!) as {
    records: Array<Record<string, unknown>>;
    checksFailed: number;
  };
  if (payload.checksFailed !== 0) {
    throw new Error(`demo parity checks failed: ${payload.checksFailed}`);
  }
  const receiptStep = payload.records.find((r) => r.step === 'settlement-executed') as {
    receiptId?: string;
  } | undefined;

  return {
    network: 'local (@midnight-ntwrk/compact-runtime 0.15.0)',
    deployedAt: new Date().toISOString(),
    tier: 'local-real-runtime',
    contracts: {
      policy: 'local-executable (contracts/managed/policy)',
      settlement: 'local-executable (contracts/managed/settlement)',
    },
    evidence: {
      receiptId: receiptStep?.receiptId,
      stateMachine:
        'policy ACTIVE → claim SUBMITTED → ZK VERIFIED → settlement EXECUTED → payout CONFIRMED (PAID)',
      crossLayerParity:
        'all digests identical between TS reference and compiled circuits',
      demoLog: 'npx tsx scripts/demo-lifecycle.ts',
    },
    note:
      'Compiled contracts (compactc 0.30.0, same artifacts that deploy to testnet) ' +
      'executed on the real Midnight compact-runtime; full lifecycle + digest parity verified.',
  };
}

function referenceDryRun(): DeploymentRecord {
  const test = spawnSync('npx', ['vitest', 'run', 'tests/privacy.test.ts'], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    network: 'reference-runtime (dry-run)',
    deployedAt: new Date().toISOString(),
    tier: 'reference-dry-run',
    contracts: { reference: 'TS reference runtime' },
    evidence: { privacySuite: test.status === 0 ? 'passed' : 'FAILED' },
    note:
      'No compiled contracts and no network — TS reference runtime only. ' +
      'Compile with `npm run build:contracts`, then redeploy.',
  };
}

async function main(): Promise<void> {
  console.log('condition deploy');
  const nodeUrl = process.env['MIDNIGHT_NODE_URL'] ?? 'https://rpc.testnet-02.midnight.network';
  const compiled = existsSync(managed('policy'));

  let record: DeploymentRecord;

  const probe = await probeNetwork(nodeUrl);
  console.log(
    `network probe ${nodeUrl}: ${probe.ok ? 'reachable' : 'unreachable'} (${probe.detail})`,
  );

  if (probe.ok) {
    try {
      record = await deployToTestnet(nodeUrl);
      console.log('testnet deployment succeeded');
    } catch (err) {
      console.error(`testnet deploy failed: ${err instanceof Error ? err.message : err}`);
      console.log('falling back to local real-runtime verification');
      record = compiled ? await localRealRuntime() : referenceDryRun();
      record.note = `testnet attempt failed (${
        err instanceof Error ? err.message : err
      }); ${record.note}`;
    }
  } else if (compiled) {
    console.log(
      'network unreachable — running local real-runtime verification of compiled contracts',
    );
    record = await localRealRuntime();
    record.note =
      `Network unreachable from this environment (${probe.detail} on ${nodeUrl}). ` +
      'Run this script from a network with Midnight egress to record a real testnet deployment. ' +
      record.note;
  } else {
    console.log('no compiled contracts and no network — reference dry-run only');
    record = referenceDryRun();
  }

  const deployDir = join(root, 'deploy');
  if (!existsSync(deployDir)) {
    mkdirSync(deployDir, { recursive: true });
  }
  writeFileSync(join(deployDir, 'deployments.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`deployments written to deploy/deployments.json (tier: ${record.tier})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
