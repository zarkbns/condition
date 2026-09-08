// Genuine end-to-end probe of the BROWSER connector path, run from Node.
//
// What this proves (no mocks of the parts under test):
//   1. The adapter (src/utils/laceConnector.ts) drives the whole pipeline:
//      createUnproven*Tx → proveTx (wallet-delegated interface) →
//      balanceUnsealedTransaction (hex wire format) → submitTransaction
//      (hex wire format) → indexer confirmation by identifier.
//   2. ZK proofs are REAL: the connector's getProvingProvider is answered
//      by the real local proof server (8.1.0), fed with key material that
//      the adapter fetched over HTTP from the served zk artifacts
//      (frontend/public/contracts) through the KeyMaterialProvider — the
//      exact data flow a Lace wallet performs in a visitor's browser.
//   3. The transactions are REAL Preprod transactions, confirmed via the
//      indexer, paying real dust fees.
//
// What this does NOT prove: the Lace extension itself (injection, enable
// prompt, its internal proving). That surface is exercised by opening the
// deployed site in a Lace-equipped browser; this harness is the closest
// reproducible equivalent available on a headless device.
//
// The harness wallet is the CLI facade (preprodStack.ts) wearing the
// connector interface — its balance/submit implementations ARE the
// live-verified CLI logic (deploy/deploy.ts wiring). It is a test
// harness: it never touches the app runtime and holds no product state.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// .env (MIDNIGHT_WALLET_SEED) — same policy as deploy/deploy.ts.
if (existsSync(join(root, '.env'))) {
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    console.error('malformed .env — cannot read the harness wallet seed');
    process.exit(1);
  }
}
const seed = process.env['MIDNIGHT_WALLET_SEED'];
if (!seed) {
  console.error('MIDNIGHT_WALLET_SEED missing (.env) — refusing to fake a wallet');
  process.exit(1);
}
const harnessSeed: string = seed;

const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
const PROOF_SERVER = process.env['PROBE_PROVER'] ?? 'http://127.0.0.1:6300';
const ARTIFACT_PORT = 8731;

// ---------------------------------------------------------------------------
// Static artifact server: the adapter's FetchZkConfigProvider must fetch the
// zk keys over HTTP exactly like a browser would from the deployed site
// (<origin>/contracts/<contract>/keys|zkir) — so the web root is
// frontend/public and /contracts/* maps to frontend/public/contracts/*.
// ---------------------------------------------------------------------------
const ARTIFACT_ROOT = join(root, 'frontend', 'public');

function serveArtifacts(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = normalize(decodeURIComponent(req.url ?? '/')).replace(/^(\.\.[/\\])+/, '');
      const file = join(ARTIFACT_ROOT, url);
      if (!file.startsWith(ARTIFACT_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(readFileSync(file));
    });
    server.on('error', reject);
    server.listen(ARTIFACT_PORT, '127.0.0.1', () => resolve());
  });
}

// ---------------------------------------------------------------------------
// The CLI facade wallet (live-verified CLI wiring) as the harness wallet.
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  await serveArtifacts();
  console.log(`[probe] artifacts served at http://127.0.0.1:${ARTIFACT_PORT}/contracts`);

  const { connectLiveStack } = await import('../src/utils/preprodStack.js');
  const cliStack = await connectLiveStack({
    indexerHttp: INDEXER_HTTP,
    indexerWs: INDEXER_WS,
    proverUrl: PROOF_SERVER,
    nodeUrl: 'https://rpc.preprod.midnight.network',
    seed: harnessSeed,
    dustSnapshotPath: join(root, 'deploy', 'dust-wallet-snapshot.json'),
    dustResumeEventId: 1_480_937n,
  });
  console.log(`[probe] harness wallet connected: ${cliStack.address}`);

  const { toHex, fromHex } = await import('@midnight-ntwrk/midnight-js-utils');
  const ledger = await import('@midnight-ntwrk/ledger-v8');
  const { ZKConfigProvider, createZKIR, createProverKey, createVerifierKey } = await import(
    '@midnight-ntwrk/midnight-js-types'
  );
  const { httpClientProvingProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const { NodeZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-node-zk-config-provider');

  const balanceTxOf = cliStack.walletProvider as {
    balanceTx: (tx: unknown, ttl?: Date) => Promise<unknown>;
  };
  const submitTxOf = cliStack.midnightProvider as { submitTx: (tx: unknown) => Promise<unknown> };

  /**
   * A ZKConfigProvider that resolves artifacts through the KeyMaterialProvider
   * the ADAPTER handed us (its FetchZkConfigProvider over the served artifacts)
   * — the proof server therefore receives exactly the key material a Lace
   * wallet would have fetched from the dapp.
   */
  class KeyMaterialBackedZkConfigProvider extends ZKConfigProvider<string> {
    constructor(private readonly kmp: {
      getZKIR(location: string): Promise<Uint8Array>;
      getProverKey(location: string): Promise<Uint8Array>;
      getVerifierKey(location: string): Promise<Uint8Array>;
    }) {
      super();
    }
    async getZKIR(circuitId: string) {
      return createZKIR(await this.kmp.getZKIR(circuitId));
    }
    async getProverKey(circuitId: string) {
      return createProverKey(await this.kmp.getProverKey(circuitId));
    }
    async getVerifierKey(circuitId: string) {
      return createVerifierKey(await this.kmp.getVerifierKey(circuitId));
    }
  }

  // The harness wallet wearing the DApp Connector interface. Every method
  // maps onto the live-verified CLI logic; the wire formats (hex tx strings,
  // marker pairs) are the connector contract the browser path uses.
  const connectorApi = {
    async getConfiguration() {
      return { networkId: 'preprod' };
    },
    async getShieldedAddresses() {
      const cpk = (cliStack.walletProvider as { getCoinPublicKey(): string }).getCoinPublicKey();
      const epk = (cliStack.walletProvider as { getEncryptionPublicKey(): string }).getEncryptionPublicKey();
      // hex passes through parseCoinPublicKeyToHex/parseEncPublicKeyToHex
      return { shieldedAddress: cliStack.address, shieldedCoinPublicKey: cpk, shieldedEncryptionPublicKey: epk };
    },
    async getUnshieldedAddress() {
      return { unshieldedAddress: cliStack.address };
    },
    async getDustBalance() {
      return { cap: 0n, balance: cliStack.dustBalance };
    },
    async balanceUnsealedTransaction(txHex: string) {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', fromHex(txHex));
      const finalized = await balanceTxOf.balanceTx(tx);
      return { tx: toHex((finalized as { serialize(): Uint8Array }).serialize()) };
    },
    async submitTransaction(sealedHex: string) {
      const sealed = ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(sealedHex));
      await submitTxOf.submitTx(sealed);
    },
    async getProvingProvider(keyMaterialProvider: {
      getZKIR(location: string): Promise<Uint8Array>;
      getProverKey(location: string): Promise<Uint8Array>;
      getVerifierKey(location: string): Promise<Uint8Array>;
    }) {
      // The REAL proof server, proven through key material fetched via the
      // adapter's KeyMaterialProvider (HTTP static artifacts) — the exact
      // data flow of a Lace wallet proving for a visitor.
      return httpClientProvingProvider(
        PROOF_SERVER,
        new KeyMaterialBackedZkConfigProvider(keyMaterialProvider),
      );
    },
  };

  const { connectBrowserStack } = await import('../src/utils/laceConnector.js');
  const stack = await connectBrowserStack(
    {
      networkId: 'preprod',
      indexerHttp: INDEXER_HTTP,
      indexerWs: INDEXER_WS,
      zkArtifactsBase: `http://127.0.0.1:${ARTIFACT_PORT}/contracts`,
    },
    undefined,
    connectorApi as never,
  );
  console.log('[probe] browser adapter stack built (connector wire format)');

  // --- lifecycle through the adapter ---------------------------------------
  const { hexToBytes, triggerTypeCode, comparisonOpCode } = await import('../src/core/hashing.js');
  const { TriggerType, ComparisonOp } = await import('../src/types/index.js');
  const now = Math.floor(Date.now() / 1000);
  const insurer = '0x' + '11'.repeat(32); // probe identity (public create arg)
  const nonce = now % 1_000_000;

  const deploy = await stack.deployContract('policy');
  console.log(`[probe] policy deployed   address=${deploy.address} tx=${deploy.txHash}`);

  const create = await stack.callCircuit('policy', {
    circuitId: 'create',
    contractAddress: deploy.address,
    args: [
      hexToBytes(insurer),
      triggerTypeCode(TriggerType.TEMPERATURE),
      comparisonOpCode(ComparisonOp.GTE),
      3500n,
      5_000_000_000n,
      100_000_000n,
      BigInt(now),
      BigInt(now + 30 * 86_400),
      BigInt(now),
      BigInt(nonce),
    ],
    witnesses: {},
  });
  const policyId = bytesToHex(create.result);
  console.log(`[probe] create confirmed  policyId=${policyId} tx=${create.txHash}`);

  const fund = await stack.callCircuit('policy', {
    circuitId: 'fund',
    contractAddress: deploy.address,
    args: [5_000_000_000n],
    witnesses: {},
  });
  console.log(`[probe] fund confirmed    tx=${fund.txHash}`);

  const holderSecret = '0x' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const enroll = await stack.callCircuit('policy', {
    circuitId: 'enroll',
    contractAddress: deploy.address,
    args: [100_000_000n],
    witnesses: { holder_secret: () => [undefined, hexToBytes(holderSecret)] },
  });
  console.log(`[probe] enroll confirmed  commitment=${bytesToHex(enroll.result)} tx=${enroll.txHash}`);

  const trigger = await stack.callCircuit('policy', {
    circuitId: 'record_trigger',
    contractAddress: deploy.address,
    args: [4000n, 3600n, hexToBytes('0x' + 'aa'.repeat(32)), hexToBytes('0x' + 'bb'.repeat(32))],
    witnesses: {},
  });
  console.log(`[probe] trigger confirmed tx=${trigger.txHash}`);

  console.log('\n[probe] LIFECYCLE COMPLETE through the browser adapter path');
  console.log(
    JSON.stringify(
      {
        policyAddress: deploy.address,
        policyId,
        txs: {
          deploy: deploy.txHash,
          create: create.txHash,
          fund: fund.txHash,
          enroll: enroll.txHash,
          record_trigger: trigger.txHash,
        },
        commitment: bytesToHex(enroll.result),
      },
      null,
      2,
    ),
  );

  await stack.close();
  await cliStack.close();
  process.exit(0);
}

function bytesToHex(result: unknown): string {
  if (!(result instanceof Uint8Array) || result.length !== 32) {
    throw new Error(`expected bytes32 result, got ${typeof result}`);
  }
  return '0x' + Buffer.from(result).toString('hex');
}

main().catch((err) => {
  console.error('[probe] FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
