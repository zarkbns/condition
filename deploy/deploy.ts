// Deployment entry (BUILD_SPEC.md §11).
//
// Three tiers, best-first:
//
//   1. PREPROD DEPLOY — requires MIDNIGHT_NODE_URL reachable + a funded
//      wallet (seed via MIDNIGHT_WALLET_SEED env, never committed) and a
//      local proof server (no hosted Preprod prover exists). Deploys the
//      compiled contracts with the real Midnight SDK facade stack
//      (WalletFacade + midnight-js providers) and records contract
//      addresses + deploy tx hashes.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Buffer } from 'node:buffer';
// Node's global WebSocket exists, but the wallet SDK's graphql subscriptions
// need a 'ws'-compatible implementation that works against Preprod's wss
// endpoint — assign it before any wallet import loads.
import { WebSocket } from 'ws';

globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managed = (name: string) => join(root, 'contracts', 'managed', name);

// Load .env (docs say secrets/config live there). Existing process env wins,
// so explicit shell exports still take precedence over file values.
if (existsSync(join(root, '.env'))) {
  try {
    process.loadEnvFile(join(root, '.env'));
  } catch {
    // A malformed .env must not crash the deployer before it can report.
  }
}

interface DeploymentRecord {
  network: string;
  deployedAt: string;
  /** tier that actually ran */
  tier: 'preprod' | 'local-real-runtime' | 'reference-dry-run';
  contracts: Record<string, string>;
  transactionHashes?: string[];
  evidence?: Record<string, unknown>;
  note: string;
}

// Midnight Preprod. indexer API v3: the indexer-public-data-provider@4.1.1
// and wallet-sdk-indexer-client both speak this surface against Preprod
// (verified live). v4 exists but this wallet stack is v3-era.
const INDEXER_HTTP = 'https://indexer.preprod.midnight.network/api/v3/graphql';
const INDEXER_WS = 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws';
// No hosted Preprod prover exists — default to a local proof server
// (on this build device: proot-wrapped midnightntwrk/proof-server on :6300).
const DEFAULT_PROVER_URL = 'http://127.0.0.1:6300';

// Dust-wallet bootstrap snapshot. The dust commitment and generation trees
// enforce linear insertion from index 0, so a fresh wallet cannot skip ~1.1M
// events of history — the state must be collapsed to the boundary of the
// wallet's first relevant event. The snapshot carries the deployer's dust
// wallet state (public key + coin info — no secret material) and is cached
// locally (gitignored) so repeat deploys skip the bootstrap fetches.
const DUST_SNAPSHOT_PATH = join(root, 'deploy', 'dust-wallet-snapshot.json');

// The event id from which the collapsed trees end and replay begins — just
// before the deployer wallet's own registration (dust-anchoring) events.
const DUST_RESUME_EVENT_ID = 1480937n;

// Witness names per contract (from the generated index.d.ts). Deploy only
// runs constructors; these throwing stubs satisfy ctor validation without
// binding any real witness providers.
const DEPLOY_WITNESSES: Record<'policy' | 'settlement', string[]> = {
  policy: ['holder_secret'],
  settlement: [
    'holder_secret',
    'claim_time',
    'observed_value',
    'recorded_at',
    'reading1_source',
    'reading1_value',
    'reading2_source',
    'reading2_value',
  ],
};

async function probeNetwork(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    // 20s: flaky networks momentarily exceed short timeouts — the probe must
    // not skip tier 1 just because one request stalls.
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20000) });
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Minimal in-memory PrivateStateProvider for the deployer's fresh states.
 * Implements the full surface midnight-js-contracts calls: scoped private
 * states (unused — our constructors take no private state) and signing keys
 * (deploy stores the contract maintenance authority locally).
 */
function inMemoryPrivateState() {
  const states = new Map<string, unknown>();
  const signingKeys = new Map<string, unknown>();
  let scope = '';
  return {
    setContractAddress: (address: unknown) => {
      scope = String(address);
    },
    set: async (id: string, state: unknown) => {
      states.set(`${scope}:${id}`, state);
    },
    get: async (id: string) => states.get(`${scope}:${id}`) ?? null,
    remove: async (id: string) => {
      states.delete(`${scope}:${id}`);
    },
    clear: async () => {
      states.clear();
    },
    setSigningKey: async (address: string, key: unknown) => {
      signingKeys.set(address, key);
    },
    getSigningKey: async (address: string) => signingKeys.get(address) ?? null,
    removeSigningKey: async (address: string) => {
      signingKeys.delete(address);
    },
    clearSigningKeys: async () => {
      signingKeys.clear();
    },
  };
}

type Ledger = typeof import('@midnight-ntwrk/ledger-v8');

/**
 * Builds a dust-wallet snapshot: collapses the commitment and generation
 * trees over the indexer's Merkle-tree-collapsed-update queries, then
 * anchors the resume offset just before the wallet's first relevant event.
 * The apply*CollapsedUpdate methods return NEW state — reassignment is
 * mandatory, discarding the result is a silent no-op.
 */
async function bootstrapDustSnapshot(dustSecretKey: unknown, ledger: Ledger): Promise<string> {
  const { createClient } = await import('graphql-ws');
  const wsClient = createClient({ url: INDEXER_WS, shouldRetry: () => false });

  // Scan the stream from the resume point for the first DustInitialUtxo —
  // its tree indexes define the collapsed ranges (end index INCLUSIVE).
  const X = DUST_RESUME_EVENT_ID;
  let C: bigint | null = null;
  let G: bigint | null = null;
  await new Promise<void>((done, fail) => {
    const dispose = wsClient.subscribe(
      { query: `subscription { dustLedgerEvents(id: ${X}) { id raw maxId } }`, variables: {} },
      {
        next: ({ data }) => {
          const ev = (data as { dustLedgerEvents?: { id: number; raw: string } })
            .dustLedgerEvents;
          if (!ev) return;
          if (C === null) {
            const le = ledger.Event.deserialize(Buffer.from(ev.raw, 'hex'));
            const tag = le.toString().match(/content: (\w+)/)?.[1];
            if (tag === 'DustInitialUtxo') {
              const s = le.toString();
              C = BigInt(s.match(/mt_index: (\d+)/)?.[1] ?? '-1');
              G = BigInt(s.match(/generation_index: (\d+)/)?.[1] ?? '-1');
              if (C < 0n || G < 0n) {
                fail(new Error('could not parse tree indexes from first DustInitialUtxo'));
              } else {
                dispose();
                done();
              }
            }
          }
        },
        error: (e) => fail(e instanceof Error ? e : new Error(String(e))),
        complete: () => done(),
      },
    );
    setTimeout(() => {
      try {
        dispose();
      } catch {
        // subscription already closed by success path
      }
      done();
    }, 30_000);
  });
  await wsClient.dispose();
  if (C === null || G === null) {
    throw new Error('could not derive tree boundaries from the dust event stream');
  }

  const gql = async (query: string) =>
    (
      await fetch(INDEXER_HTTP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(30_000),
      })
    ).json() as Promise<{ data?: Record<string, { update?: string }>; errors?: unknown[] }>;

  const cResp = await gql(
    `{ dustCommitmentMerkleTreeUpdate(startIndex: 0, endIndex: ${C - 1n}) { update } }`,
  );
  const gResp = await gql(
    `{ dustGenerationMerkleTreeUpdate(startIndex: 0, endIndex: ${G - 1n}) { update } }`,
  );
  if (cResp.errors || gResp.errors) {
    throw new Error(
      `collapsed tree update query failed: ${JSON.stringify({ c: cResp.errors, g: gResp.errors })}`,
    );
  }

  let dustLocalState = new ledger.DustLocalState(
    ledger.LedgerParameters.initialParameters().dust,
  );
  dustLocalState = dustLocalState.applyCommitmentCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(
      Buffer.from(cResp.data?.dustCommitmentMerkleTreeUpdate?.update ?? '', 'hex'),
    ),
  );
  dustLocalState = dustLocalState.applyGenerationCollapsedUpdate(
    ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(
      Buffer.from(gResp.data?.dustGenerationMerkleTreeUpdate?.update ?? '', 'hex'),
    ),
  );

  const publicKey = (dustSecretKey as { publicKey: { toString(): string } }).publicKey.toString();
  const snapshot = JSON.stringify({
    publicKey: { publicKey },
    state: Buffer.from(dustLocalState.serialize()).toString('hex'),
    protocolVersion: '0',
    networkId: 'preprod',
    // offset is EXCLUSIVE for the restored wallet: the sync service skips
    // batches whose nextIndex <= offset, so the anchor event itself must
    // not be pre-marked as applied.
    offset: String(X - 1n),
  });
  writeFileSync(DUST_SNAPSHOT_PATH, snapshot);
  console.log(
    `dust wallet: bootstrapped snapshot (commitment ${C}, generation ${G}, resume ${X})`,
  );
  return snapshot;
}

/** GraphQL over fetch against the indexer. */
async function indexerQuery<T>(query: string): Promise<T> {
  const resp = await fetch(INDEXER_HTTP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await resp.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new Error(`indexer query failed: ${body.errors.map((e) => e.message).join('; ')}`);
  }
  return body.data as T;
}

/**
 * Signs every unshielded offer in a transaction's intents, using the proof
 * marker the intent actually carries. Works around a wallet-sdk bug where
 * signRecipe hardcodes the 'pre-proof' marker, which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data ("Failed to clone
 * intent"). Mirrors the official example-counter wiring. Without this, the
 * balancing transaction's unshielded spends are unsigned and the node
 * rejects the transaction as invalid.
 */
function signTransactionIntents(
  tx: { intents: Map<number, unknown> | undefined },
  sign: (payload: Uint8Array) => unknown,
  proofMarker: 'proof' | 'pre-proof',
  ledger: Ledger,
): void {
  if (!tx.intents || tx.intents.size === 0) return;
  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;
    const cloned = ledger.Intent.deserialize(
      'signature',
      proofMarker,
      'pre-binding',
      (intent as { serialize(): Uint8Array }).serialize(),
    ) as unknown as {
      signatureData(segmentId: number): Uint8Array;
      fallibleUnshieldedOffer: UnshieldedOfferLike | undefined;
      guaranteedUnshieldedOffer: UnshieldedOfferLike | undefined;
    };
    const signature = sign(cloned.signatureData(segment));
    if (cloned.fallibleUnshieldedOffer) {
      const offer = cloned.fallibleUnshieldedOffer;
      const sigs = offer.inputs.map((_input, i) => offer.signatures.at(i) ?? signature);
      cloned.fallibleUnshieldedOffer = offer.addSignatures(sigs) as UnshieldedOfferLike;
    }
    if (cloned.guaranteedUnshieldedOffer) {
      const offer = cloned.guaranteedUnshieldedOffer;
      const sigs = offer.inputs.map((_input, i) => offer.signatures.at(i) ?? signature);
      cloned.guaranteedUnshieldedOffer = offer.addSignatures(sigs) as UnshieldedOfferLike;
    }
    tx.intents.set(segment, cloned);
  }
}

/** Structural view of ledger.UnshieldedOffer used by signTransactionIntents. */
interface UnshieldedOfferLike {
  inputs: unknown[];
  signatures: { at(i: number): unknown };
  addSignatures(sigs: unknown[]): unknown;
}

async function deployToPreprod(nodeUrl: string): Promise<DeploymentRecord> {
  // Real SDK deployment on the wallet-sdk facade stack. Dynamic imports so
  // local tiers never touch the network packages.
  const ledger = await import('@midnight-ntwrk/ledger-v8');
  const { HDWallet, Roles } = await import('@midnight-ntwrk/wallet-sdk-hd');
  const { WalletFacade } = await import('@midnight-ntwrk/wallet-sdk-facade');
  const { ShieldedWallet } = await import('@midnight-ntwrk/wallet-sdk-shielded');
  const {
    UnshieldedWallet,
    createKeystore,
    PublicKey,
    InMemoryTransactionHistoryStorage,
  } = await import('@midnight-ntwrk/wallet-sdk-unshielded-wallet');
  const { DustWallet } = await import('@midnight-ntwrk/wallet-sdk-dust-wallet');
  const { NodeZkConfigProvider } = await import(
    '@midnight-ntwrk/midnight-js-node-zk-config-provider'
  );
  const { indexerPublicDataProvider } = await import(
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider'
  );
  const { httpClientProofProvider } = await import(
    '@midnight-ntwrk/midnight-js-http-client-proof-provider'
  );
  const { setNetworkId, getNetworkId } = await import(
    '@midnight-ntwrk/midnight-js-network-id'
  );
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');

  // midnight-js consumes the string network id ('preprod') for tx
  // construction and key parsing, and throws if it was never set.
  setNetworkId('preprod');

  const seed = process.env['MIDNIGHT_WALLET_SEED'];
  if (!seed) {
    throw new Error(
      'preprod deploy requires MIDNIGHT_WALLET_SEED (a funded preprod seed; never commit it)',
    );
  }
  const proverUrl = process.env['MIDNIGHT_PROVER_URL'] ?? DEFAULT_PROVER_URL;
  const seedBuf = Buffer.from(seed, 'hex');

  // HD derivation: account 0, three roles, index 0 — the canonical
  // example-counter wiring. Shielded keys come from the RAW SEED (not the
  // HD role) so the zswap keys match the old funded address family.
  const hd = HDWallet.fromSeed(seedBuf);
  if (hd.type !== 'seedOk') {
    throw new Error('invalid MIDNIGHT_WALLET_SEED (not a valid seed)');
  }
  const derivation = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivation.type !== 'keysDerived') {
    throw new Error('HD key derivation failed');
  }
  hd.hdWallet.clear();
  const roleKeys = derivation.keys;

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(seedBuf);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(roleKeys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(roleKeys[Roles.NightExternal], getNetworkId());

  const walletConfig = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: INDEXER_HTTP,
      indexerWsUrl: INDEXER_WS,
    },
    provingServerUrl: new URL(proverUrl),
    relayURL: new URL(nodeUrl.replace(/^http/, 'ws')),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  // Dust wallet: restore from the bootstrapped snapshot when present, else
  // bootstrap it (collapse trees from the indexer) first.
  let dustSnapshot: string;
  if (existsSync(DUST_SNAPSHOT_PATH)) {
    dustSnapshot = readFileSync(DUST_SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(dustSnapshot) as { offset?: string };
    console.log(`dust wallet: restoring from snapshot @ offset ${parsed.offset ?? '?'}`);
  } else {
    dustSnapshot = await bootstrapDustSnapshot(dustSecretKey, ledger);
  }

  // Shielded factory is passed to WalletFacade.init (it composes the shared
  // configuration) but NEVER started: the shielded wallet would replay ~9h
  // of zswap events to sync. facade.start() would start all three wallets,
  // so the unshielded and dust wallets are started individually instead.
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).restore(dustSnapshot),
  });
  try {
    await wallet.unshielded.start();
    await wallet.dust.start(dustSecretKey);

    // Unshielded sync is server-filtered and near-instant; the dust wallet
    // (restored near chain head) needs its wallet-relevant events replayed.
    // 10 min covers slow mobile links before giving up.
    const dustState = await withTimeout(
      wallet.dust.waitForSyncedState(),
      600_000,
      'dust wallet failed to sync within 10 minutes',
    );
    const dustBalance = dustState.balance(new Date());
    console.log(
      `wallet up: unshielded started, dust balance ${dustBalance} (coins: ${dustState.availableCoins.length})`,
    );
    if (dustBalance <= 0n) {
      throw new Error(
        'dust wallet synced but holds no dust — fees cannot be paid. ' +
          'Register NIGHT UTXOs for dust generation and wait for accrual, ' +
          'then redeploy.',
      );
    }

    // Checkpoint the synced state so subsequent runs resume near head.
    const checkpoint = await wallet.dust.serializeState().catch(() => null);
    if (checkpoint) {
      writeFileSync(DUST_SNAPSHOT_PATH, checkpoint);
      console.log('dust wallet: state re-checkpointed at head');
    }

    // ---- providers (midnight-js contract stack) ----
    // Keys from the raw seed directly — no shielded wallet state required.
    // CoinPublicKey/EncPublicKey are hex strings in ledger-v8.
    const coinPublicKey: string = shieldedSecretKeys.coinPublicKey;
    const encryptionPublicKey: string = shieldedSecretKeys.encryptionPublicKey;
    const walletProvider = {
      getCoinPublicKey: () => coinPublicKey,
      getEncryptionPublicKey: () => encryptionPublicKey,
      balanceTx: async (tx: unknown, ttl?: Date) => {
        const recipe = await wallet.balanceUnboundTransaction(
          tx as never,
          { shieldedSecretKeys, dustSecretKey },
          {
            ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
            tokenKindsToBalance: ['unshielded', 'dust'],
          },
        );
        // Sign the unshielded spends the balancing attaches — unsigned
        // spends are rejected by the node as invalid transactions (see
        // signTransactionIntents).
        const sign = (payload: Uint8Array) => unshieldedKeystore.signData(payload);
        signTransactionIntents(recipe.baseTransaction, sign, 'proof', ledger);
        if (recipe.balancingTransaction) {
          signTransactionIntents(recipe.balancingTransaction, sign, 'pre-proof', ledger);
        }
        return wallet.finalizeRecipe(recipe);
      },
    };
    const midnightProvider = {
      submitTx: (tx: unknown) => wallet.submitTransaction(tx as never) as never,
    };
    const publicDataProvider = indexerPublicDataProvider(INDEXER_HTTP, INDEXER_WS);

    const deployed: Array<{ name: string; address?: string; txHash?: string }> = [];
    for (const name of ['policy', 'settlement'] as const) {
      // The managed contract's generated `Contract` ctor is structural:
      // cast to the ctor shape compact-js expects.
      const managedContract = (await import(
        pathToFileURL(join(managed(name), 'contract', 'index.js')).href
      )) as unknown as Record<string, Parameters<typeof CompiledContract.make>[1]>;
      const Contract = managedContract['Contract'] as Parameters<
        typeof CompiledContract.make
      >[1];
      const zkConfigProvider = new NodeZkConfigProvider(managed(name));
      const proofProvider = httpClientProofProvider(proverUrl, zkConfigProvider);
      // The deploy path only runs the constructor (no circuits), but the
      // generated Contract ctor validates witness fields at instantiation,
      // so withVacantWitnesses ({} — fine for witness-free contracts like
      // the counter example) is unusable here. Pass throwing stubs instead:
      // a witness invoked during deploy would leak witness data into a
      // deploy tx — a privacy violation — so failing loudly is correct.
      const deployWitnesses = Object.fromEntries(
        DEPLOY_WITNESSES[name].map((w) => [
          w,
          () => {
            throw new Error(`witness ${w} must never be invoked during deploy`);
          },
        ]),
      );
      const compiled = CompiledContract.make(name, Contract).pipe(
        CompiledContract.withWitnesses(deployWitnesses as never),
        CompiledContract.withCompiledFileAssets(managed(name)),
      );
      const providers = {
        privateStateProvider: inMemoryPrivateState(),
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
      } as never;

      const result = await deployWithRetry(
        providers,
        compiled as never,
        name,
      );
      deployed.push(result);
    }

    return {
      network: nodeUrl,
      deployedAt: new Date().toISOString(),
      tier: 'preprod',
      contracts: Object.fromEntries(
        deployed.map((d) => [d.name, d.address ?? d.txHash ?? 'deployed']),
      ),
      transactionHashes: deployed
        .map((d) => d.txHash)
        .filter((h): h is string => typeof h === 'string'),
      evidence: {
        coinPublicKey: coinPublicKey.slice(0, 16) + '…',
        dustBalanceAtDeploy: dustBalance.toString(),
      },
      note:
        'Deployed compiled Compact contracts to Midnight Preprod via the ' +
        'wallet-sdk facade stack (unshielded + bootstrapped dust wallets).',
    };
  } finally {
    // Try the dust wallet first (its sync holds a WS subscription); the
    // facade's own stop() is safe even after individual wallets stopped.
    await wallet.dust.stop().catch(() => {});
    await wallet.unshielded.stop().catch(() => {});
    await wallet.stop().catch(() => {});
  }
}

/** Promise.race wrapper with a clear timeout error. */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/**
 * Splits deploy into address-creation and submission so a mobile WS blip
 * does not lose the contract address: createUnprovenDeployTx computes the
 * address locally before any network submit, and failures distinguish
 * "submit failed before landing" (retry with a fresh tx) from "landing
 * unknown" (poll the indexer by the known address over plain HTTPS).
 */
async function deployWithRetry(
  providers: never,
  compiled: never,
  name: string,
): Promise<{ name: string; address?: string; txHash?: string }> {
  const { createUnprovenDeployTx, submitTxAsync } = (await import(
    '@midnight-ntwrk/midnight-js-contracts'
  )) as unknown as {
    createUnprovenDeployTx: (providers: never, options: never) => Promise<{
      public: { contractAddress: { toString(): string } };
      private: { unprovenTx: unknown };
    }>;
    submitTxAsync: (providers: never, options: { unprovenTx: unknown }) => Promise<string>;
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`deploying ${name} (attempt ${attempt}/${maxAttempts})…`);
    let address: string | undefined;
    try {
      const unproven = await createUnprovenDeployTx(providers, {
        compiledContract: compiled,
      } as never);
      address = unproven.public.contractAddress.toString();
      console.log(`${name}: contract address ${address}`);
      try {
        const txId = await submitTxAsync(providers, { unprovenTx: unproven.private.unprovenTx });
        console.log(`${name}: submitted, tx id ${txId}`);
      } catch (submitErr) {
        // Submit failures race an actually-landed tx (mobile WS "Normal
        // Closure" blips): poll by the known address before deciding.
        const message = submitErr instanceof Error ? submitErr.message : String(submitErr);
        console.log(`${name}: submit error (${message.slice(0, 200)}) — checking indexer`);
        const landed = await pollContractOnChain(address, 120_000);
        if (!landed) throw submitErr;
        console.log(`${name}: tx landed despite the submit error`);
      }
      const txHash = await awaitContractTxHash(address, 180_000);
      console.log(`${name}: confirmed on chain, tx hash ${txHash ?? '(unconfirmed)'}`);
      if (!txHash) {
        throw new Error(`${name}: deployed but not confirmable on the indexer within 3 minutes`);
      }
      return { name, address, txHash };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${name}: attempt failed: ${message.slice(0, 300)}`);
      if (attempt === maxAttempts) {
        throw new Error(`${name} deploy failed after ${maxAttempts} attempts: ${message}`);
      }
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  throw new Error('unreachable');
}

/** Polls the indexer for a contract's deploy transaction by address. */
async function awaitContractTxHash(
  address: string,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = await indexerQuery<{ contractAction: { transaction: { hash: string } } | null }>(
        `{ contractAction(address: "${address}") { ... on ContractDeploy { transaction { hash } } ... on ContractUpdate { transaction { hash } } } }`,
      );
      if (data.contractAction) return data.contractAction.transaction.hash;
    } catch {
      // transient fetch failure — retry until deadline
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return null;
}

/** Boolean form of awaitContractTxHash for submit-failure recovery. */
async function pollContractOnChain(address: string, timeoutMs: number): Promise<boolean> {
  return (await awaitContractTxHash(address, timeoutMs)) !== null;
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
      `local real-runtime verification failed:${demo.stdout ?? ''}${demo.stderr ?? ''}`,
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
      crossLayerParity: 'all digests identical between TS reference and compiled circuits',
      demoLog: 'npx tsx scripts/demo-lifecycle.ts',
    },
    note:
      'Compiled contracts (compactc 0.30.0, same artifacts that deploy to Preprod) ' +
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
  const nodeUrl = process.env['MIDNIGHT_NODE_URL'] ?? 'https://rpc.preprod.midnight.network';
  const compiled = existsSync(managed('policy'));

  let record: DeploymentRecord;

  const probe = await probeNetwork(nodeUrl);
  console.log(
    `network probe ${nodeUrl}: ${probe.ok ? 'reachable' : 'unreachable'} (${probe.detail})`,
  );

  if (probe.ok) {
    try {
      record = await deployToPreprod(nodeUrl);
      console.log('preprod deployment succeeded');
    } catch (err) {
      console.error(`preprod deploy failed: ${err instanceof Error ? err.message : err}`);
      console.log('falling back to local real-runtime verification');
      record = compiled ? await localRealRuntime() : referenceDryRun();
      record.note = `preprod attempt failed (${
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
      'Run this script from a network with Midnight egress to record a real preprod deployment. ' +
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
