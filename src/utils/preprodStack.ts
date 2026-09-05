// Live Preprod stack — the single Node-only provider assembly (BUILD_SPEC §7).
//
// Everything here is extracted from deploy/deploy.ts (the stack that
// deployed the live contracts; docs/DEPLOYMENTS.md). It is shared by the
// deployer and by PreprodOnChainClient so the app's on-chain operations
// use EXACTLY the wiring that is verified live:
//
//   WalletFacade (unshielded + dust wallets, shielded never started)
//     → walletProvider (facade keys + balanceTx + signTransactionIntents)
//     → midnightProvider (submitTransaction)
//     → indexerPublicDataProvider (reads / tx watching, indexer API v3)
//     → NodeZkConfigProvider + httpClientProofProvider per contract
//     → createUnprovenDeployTx / createUnprovenCallTx + submitTxAsync
//
// Node-only (fs, ws, native wasm): everything is behind dynamic imports and
// must only run in CLI/Node contexts (deploy, e2e scripts). The browser
// wallet path is the Lace extension — never this module.
//
// Privacy (Invariants 1/2):
//   - Holder secrets never cross this module's public surface; they are
//     consumed only inside witness closures the caller constructs locally.
//   - UnsubmittedTxData / tx internals are never logged or serialized;
//     only the circuit's own JS return value and public confirmations
//     (tx hash, status) leave callCircuit/deployContract.
//   - Witness stubs used for deploys THROW — a witness invoked during a
//     deploy would leak witness data into the tx.

import { Buffer } from 'node:buffer';

/** Resolved lazily; never at import time. */
export interface LiveStack {
  /** wallet-sdk facade wallet (unshielded + dust started; shielded NOT). */
  readonly wallet: unknown;
  /** Structural walletProvider for midnight-js (keys, balanceTx). */
  readonly walletProvider: unknown;
  /** Structural midnightProvider (submitTx). */
  readonly midnightProvider: unknown;
  /** Indexer-backed public data provider (reads + tx watching). */
  readonly publicDataProvider: unknown;
  /** Bech32m unshielded address of the connected wallet. */
  readonly address: string;
  /** tDUST balance snapshot taken at connect time. */
  readonly dustBalance: bigint;
  /**
   * Deploy a compiled contract (constructor only — witnesses are throwing
   * stubs). Resolves to the contract address and the confirmed deploy tx
   * hash. Managed dirs resolve from the repo root (contracts/managed/<name>).
   */
  deployContract: (name: 'policy' | 'settlement') => Promise<{
    address: string;
    txHash: string;
  }>;
  /**
   * Call a circuit on a deployed contract and return the circuit result.
   * Witnesses receive only what the callers pass — holder secrets stay
   * inside the witness closures the caller constructs locally. Witness
   * functions return [nextPrivateState, value]; our contracts are
   * witness-stateless, so nextPrivateState is always undefined. Call txs
   * never persist private state, so no privateStateId is used and
   * witnesses run with undefined private state.
   */
  callCircuit: (name: 'policy' | 'settlement', options: {
    circuitId: string;
    contractAddress: string;
    args: unknown[];
    /**
     * Real witness functions (e.g. holder_secret) for the circuits that
     * consume them; every other declared witness stays a throwing stub
     * (the generated constructors validate that ALL declared witnesses
     * are function-valued, so a partial map is merged over stubs).
     */
    witnesses: Record<string, (context: unknown) => [unknown, unknown]>;
  }) => Promise<{ txHash: string; result: unknown }>;
  /** Decode a deployed contract's public ledger state via the indexer. */
  readLedger: (name: 'policy' | 'settlement', address: string) => Promise<Record<string, unknown>>;
  /** Tear down wallet WS subscriptions. */
  close: () => Promise<void>;
}

export interface LiveStackOptions {
  indexerHttp: string;
  indexerWs: string;
  proverUrl: string;
  nodeUrl: string;
  seed: string;
  /** Where the dust-wallet snapshot is cached (bootstrap on first run). */
  dustSnapshotPath: string;
  /** Indexer event id from which dust replay resumes (see deploy/deploy.ts). */
  dustResumeEventId: bigint;
}

// ---------------------------------------------------------------------------
// Shared low-level helpers (verbatim from deploy/deploy.ts, which remains
// the live-verified reference)
// ---------------------------------------------------------------------------

type Ledger = typeof import('@midnight-ntwrk/ledger-v8');

/** Structural view of ledger.UnshieldedOffer used by signTransactionIntents. */
interface UnshieldedOfferLike {
  inputs: unknown[];
  signatures: { at(i: number): unknown };
  addSignatures(sigs: unknown[]): unknown;
}

/**
 * Signs every unshielded offer in a transaction's intents, using the proof
 * marker the intent actually carries. Works around a wallet-sdk bug where
 * signRecipe hardcodes the 'pre-proof' marker, which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data ("Failed to clone
 * intent"). Without this, the balancing transaction's unshielded spends are
 * unsigned and the node rejects the transaction as invalid.
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

/**
 * Minimal in-memory PrivateStateProvider. Deploy only runs constructors
 * (no private state); call transactions use public states only — our
 * contracts are witness-stateless, so witnesses return plain tuples and
 * midnight-js never needs persisted private state.
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

/** GraphQL over fetch against the indexer (plain HTTPS — mobile-safe). */
async function indexerQuery<T>(indexerHttp: string, query: string): Promise<T> {
  const resp = await fetch(indexerHttp, {
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

/** Promise.race wrapper with a clear timeout error. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

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

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

/**
 * Build the live stack: facade wallet (unshielded + dust), providers, and
 * the deploy/call/read operations. Fails loudly on any missing piece —
 * never simulates.
 */
export async function connectLiveStack(options: LiveStackOptions): Promise<LiveStack> {
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
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath, pathToFileURL } = await import('node:url');

  // midnight-js consumes the string network id ('preprod') for tx
  // construction and key parsing, and throws if it was never set.
  setNetworkId('preprod');

  const seedBuf = Buffer.from(options.seed, 'hex');

  // HD derivation: account 0, three roles, index 0. Shielded keys come from
  // the RAW SEED (not the HD role) so the zswap keys match the funded
  // address family.
  const hd = HDWallet.fromSeed(seedBuf);
  if (hd.type !== 'seedOk') {
    throw new Error('invalid seed (not a valid wallet seed)');
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
      indexerHttpUrl: options.indexerHttp,
      indexerWsUrl: options.indexerWs,
    },
    provingServerUrl: new URL(options.proverUrl),
    relayURL: new URL(options.nodeUrl.replace(/^http/, 'ws')),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
  };

  // Dust wallet bootstrap — collapses the commitment/generation trees from
  // indexer data and anchors replay at the resume event id (see
  // deploy/deploy.ts for the full rationale). The snapshot carries the
  // dust wallet state only — no secret material.
  const bootstrapDustSnapshot = async (): Promise<string> => {
    const { createClient } = await import('graphql-ws');
    const wsClient = createClient({ url: options.indexerWs, shouldRetry: () => false });
    const X = options.dustResumeEventId;
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
        await fetch(options.indexerHttp, {
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

    const publicKey = (dustSecretKey as { publicKey: { toString(): string } })
      .publicKey.toString();
    return JSON.stringify({
      publicKey: { publicKey },
      state: Buffer.from(dustLocalState.serialize()).toString('hex'),
      protocolVersion: '0',
      networkId: 'preprod',
      // offset is EXCLUSIVE for the restored wallet: the sync service skips
      // batches whose nextIndex <= offset, so the anchor event itself must
      // not be pre-marked as applied.
      offset: String(X - 1n),
    });
  };

  // Resolve this module's repo root (works from src/ and dist/): the
  // compiled-contract assets live at <root>/contracts/managed/<name>.
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const managed = (name: string) => join(root, 'contracts', 'managed', name);

  // Dust wallet: restore from the cached snapshot when present, else
  // bootstrap it first.
  let dustSnapshot: string;
  if (existsSync(options.dustSnapshotPath)) {
    dustSnapshot = readFileSync(options.dustSnapshotPath, 'utf8');
  } else {
    dustSnapshot = await bootstrapDustSnapshot();
    writeFileSync(options.dustSnapshotPath, dustSnapshot);
  }

  // Shielded factory is passed to WalletFacade.init but NEVER started: the
  // shielded wallet would replay ~9h of zswap events to sync. facade.start()
  // would start all three wallets, so the unshielded and dust wallets are
  // started individually instead.
  const wallet = await WalletFacade.init({
    configuration: walletConfig,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) =>
      UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore)),
    dust: (cfg) => DustWallet(cfg).restore(dustSnapshot),
  });

  const stopAll = async () => {
    await wallet.dust.stop().catch(() => {});
    await wallet.unshielded.stop().catch(() => {});
    await wallet.stop().catch(() => {});
  };

  try {
    await wallet.unshielded.start();
    await wallet.dust.start(dustSecretKey);

    // Unshielded sync is server-filtered and near-instant; the dust wallet
    // (restored near chain head) needs its wallet-relevant events replayed.
    const dustState = await withTimeout(
      wallet.dust.waitForSyncedState(),
      600_000,
      'dust wallet failed to sync within 10 minutes',
    );
    const dustBalance = dustState.balance(new Date());
    if (dustBalance <= 0n) {
      throw new Error(
        'dust wallet synced but holds no dust — fees cannot be paid. ' +
          'Register NIGHT UTXOs for dust generation and wait for accrual, then retry.',
      );
    }

    // Checkpoint the synced state so subsequent runs resume near head.
    const checkpoint = await wallet.dust.serializeState().catch(() => null);
    if (checkpoint) {
      writeFileSync(options.dustSnapshotPath, checkpoint);
    }

    // The wallet stack ships FOUR nested copies of wallet-sdk-address-format
    // (one per wallet package); their Bech32mSymbol unique-symbols do not
    // unify across copies, so a top-level MidnightBech32m.encode cannot find
    // the codec (type error AND runtime failure). Instead, read the codec
    // off the address instance itself — the same module copy that
    // constructed it — and encode with that.
    const rawAddress = await wallet.unshielded.getAddress();
    const bech32mSymbol = Object.getOwnPropertySymbols(rawAddress)[0]!;
    const addressCodec = (rawAddress as unknown as Record<symbol, unknown>)[
      bech32mSymbol
    ] as { encode: (networkId: string, data: unknown) => { asString(): string } };
    const address: string = addressCodec.encode('preprod', rawAddress).asString();

    // ---- midnight-js providers ----
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
    const publicDataProvider = indexerPublicDataProvider(options.indexerHttp, options.indexerWs);

    const contractProviders = (managedDir: string) => {
      const zkConfigProvider = new NodeZkConfigProvider(managedDir);
      const proofProvider = httpClientProofProvider(options.proverUrl, zkConfigProvider);
      return { zkConfigProvider, proofProvider };
    };

    const loadCompiled = async (name: 'policy' | 'settlement') => {
      const managedContract = (await import(
        pathToFileURL(join(managed(name), 'contract', 'index.js')).href
      )) as unknown as Record<string, unknown>;
      return managedContract['Contract'] as Parameters<
        typeof CompiledContract.make
      >[1];
    };

    const deployWitnesses = (name: 'policy' | 'settlement') =>
      Object.fromEntries(
        DEPLOY_WITNESSES[name].map((w) => [
          w,
          () => {
            throw new Error(`witness ${w} must never be invoked during deploy`);
          },
        ]),
      );

    /**
     * Call witnesses: caller-supplied real witnesses merged over throwing
     * stubs for every declared witness. The generated constructors require
     * ALL declared witnesses to be function-valued (invoking them is a
     * separate matter — only the circuits that consume a witness call it).
     */
    const callWitnesses = (
      name: 'policy' | 'settlement',
      real: Record<string, (context: unknown) => [unknown, unknown]>,
    ) => ({
      ...deployWitnesses(name),
      ...real,
    });

    const awaitContractTxHash = async (addr: string, timeoutMs: number): Promise<string | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const data = await indexerQuery<{ contractAction: { transaction: { hash: string } } | null }>(
            options.indexerHttp,
            `{ contractAction(address: "${addr}") { ... on ContractDeploy { transaction { hash } } ... on ContractUpdate { transaction { hash } } } }`,
          );
          if (data.contractAction) return data.contractAction.transaction.hash;
        } catch {
          // transient fetch failure — retry until deadline
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
      return null;
    };

    /**
     * Confirms a tx by id via the public data provider (HTTPS polling under
     * the hood). Returns the tx hash only when the tx finalized with
     * SucceedEntirely status — anything else fails loudly rather than
     * fabricating a confirmation.
     */
    const awaitTxConfirmed = async (txId: string, timeoutMs: number): Promise<string> => {
      const finalized = await withTimeout(
        (publicDataProvider as {
          watchForTxData: (id: string) => Promise<{ status: string; txHash: string }>;
        }).watchForTxData(txId),
        timeoutMs,
        `tx ${txId.slice(0, 16)}… not finalized within ${Math.round(timeoutMs / 60_000)} minutes`,
      );
      if (finalized.status !== 'SucceedEntirely') {
        throw new Error(`tx ${finalized.txHash} finalized with status ${finalized.status}`);
      }
      return finalized.txHash;
    };

    const deployContract = async (name: 'policy' | 'settlement') => {
      const { createUnprovenDeployTx, submitTxAsync } = await import(
        '@midnight-ntwrk/midnight-js-contracts'
      );
      const Contract = await loadCompiled(name);
      const { zkConfigProvider, proofProvider } = contractProviders(managed(name));
      const compiled = CompiledContract.make(name, Contract).pipe(
        CompiledContract.withWitnesses(deployWitnesses(name) as never),
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

      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let address: string | undefined;
        try {
          const unproven = await createUnprovenDeployTx(providers, {
            compiledContract: compiled,
          } as never);
          address = unproven.public.contractAddress.toString();
          try {
            const txId = await submitTxAsync(providers, { unprovenTx: unproven.private.unprovenTx });
            const txHash = await awaitTxConfirmed(txId, 180_000);
            return { address, txHash };
          } catch (submitErr) {
            // Submit failures race an actually-landed tx (mobile WS
            // "Normal Closure" blips): poll by the locally-known address
            // over plain HTTPS before giving up.
            const landed = await (async () => {
              const deadline = Date.now() + 120_000;
              while (Date.now() < deadline) {
                const hash = await awaitContractTxHash(address!, 10_000).catch(() => null);
                if (hash) return hash;
                await new Promise((r) => setTimeout(r, 5_000));
              }
              return null;
            })();
            if (!landed) throw submitErr;
            const confirmedHash = await awaitContractTxHash(address, 180_000);
            if (!confirmedHash) {
              throw new Error(
                `${name}: deployed but not confirmable on the indexer within 3 minutes`,
              );
            }
            return { address, txHash: confirmedHash };
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (attempt === maxAttempts) {
            throw new Error(`${name} deploy failed after ${maxAttempts} attempts: ${message}`);
          }
          await new Promise((r) => setTimeout(r, 15_000));
        }
      }
      throw new Error('unreachable');
    };

    const callCircuit: LiveStack['callCircuit'] = async (name, options) => {
      const { createUnprovenCallTx, submitTxAsync } = await import(
        '@midnight-ntwrk/midnight-js-contracts'
      );
      const { asContractAddress } = await import('@midnight-ntwrk/midnight-js-types');
      const Contract = await loadCompiled(name);
      const { zkConfigProvider, proofProvider } = contractProviders(managed(name));
      const compiled = CompiledContract.make(name, Contract).pipe(
        CompiledContract.withWitnesses(callWitnesses(name, options.witnesses) as never),
        CompiledContract.withCompiledFileAssets(managed(name)),
      );
      const providers = {
        publicDataProvider,
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
        // No privateStateId in the call options → witnesses run with
        // undefined private state (our contracts are witness-stateless).
      } as never;

      const unproven = await createUnprovenCallTx(providers, {
        compiledContract: compiled,
        circuitId: options.circuitId,
        contractAddress: asContractAddress(options.contractAddress),
        args: options.args as never,
      } as never);
      // Only the circuit's own JS return value is extracted — never the
      // unproven tx, ZK inputs, or private transcript (privacy Invariant 2).
      const result = (unproven as { private?: { result?: unknown } }).private?.result;

      const txId = await submitTxAsync(providers, { unprovenTx: unproven.private.unprovenTx });
      const txHash = await awaitTxConfirmed(txId, 180_000);
      return { txHash, result };
    };

    const readLedger: LiveStack['readLedger'] = async (name, addr) => {
      const { getPublicStates } = await import('@midnight-ntwrk/midnight-js-contracts');
      const { asContractAddress } = await import('@midnight-ntwrk/midnight-js-types');
      const managedContract = (await import(
        pathToFileURL(join(managed(name), 'contract', 'index.js')).href
      )) as unknown as {
        ledger: (state: unknown) => Record<string, unknown>;
      };
      const states = await getPublicStates(publicDataProvider as never, asContractAddress(addr));
      // ContractState.data is the ChargedState the generated ledger()
      // accessor expects (it also accepts StateValue, but the indexer
      // provider hands back a full ContractState).
      return managedContract.ledger(states.contractState.data);
    };

    return {
      wallet,
      walletProvider,
      midnightProvider,
      publicDataProvider,
      address,
      dustBalance,
      deployContract,
      callCircuit,
      readLedger,
      close: stopAll,
    };
  } catch (err) {
    await stopAll();
    throw err;
  }
}
