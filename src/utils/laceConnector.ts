// Browser stack — the Midnight DApp Connector (Lace) path (BUILD_SPEC §7/§10).
//
// Implements the SAME LiveStack surface as preprodStack.ts so every
// PreprodConditionRuntime on-chain method — and its live parity checks —
// works unchanged in a visitor's browser:
//
//   prove    → wallet-delegated: connector getProvingProvider (Invariant 2 —
//              key material leaves this page, witness data never does)
//   balance  → connector balanceUnsealedTransaction (wallet pays fees, signs)
//   submit   → connector submitTransaction (wallet relays to the network)
//   reads    → the same indexer v3 GraphQL the CLI/publicChain paths use
//
// BROWSER-ONLY: everything heavy is a dynamic import; there is no Node API
// here (no fs, no ws, no seed) — the wallet holds all keys and Condition
// runs no prover (the connector's deprecated proverServerUri is ignored).
//
// Privacy (Invariants 1/2):
//   - The seed never leaves the wallet extension.
//   - Holder secrets / claim evidence are consumed inside witness closures
//     in THIS page (same trust domain as the CLI path's local process);
//     the serialized preimage that goes to the WALLET's prover is the same
//     artifact the CLI path hands its local proof server.
//   - The public artifacts served from this site (.prover/.bzkir/.verifier)
//     are compiler outputs of the public circuits — no witness data.

import type { LiveStack } from './preprodStack.js';
import { loadManagedContractModule } from './managedContracts.js';
import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';

/** One wallet the page can connect to (window.midnight.{id}). */
export interface DiscoveredWallet {
  /** The key the wallet injected itself under (e.g. 'mnLace'). */
  id: string;
  rdns: string;
  name: string;
  icon: string;
  /** Connector API version the wallet implements (e.g. '4.0.1'). */
  apiVersion: string;
}

/** Thrown with a precise reason when the connector path cannot proceed. */
export class ConnectorError extends Error {
  readonly code:
    | 'no-wallet'
    | 'unsupported-version'
    | 'missing-proving'
    | 'network-mismatch'
    | 'connect-refused';

  constructor(code: ConnectorError['code'], detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'ConnectorError';
    this.code = code;
  }
}

export interface BrowserStackOptions {
  networkId: 'preprod' | 'testnet';
  indexerHttp: string;
  indexerWs: string;
  /** Base URL serving contracts/{policy,settlement}/{keys,zkir} (default: <origin>/contracts). */
  zkArtifactsBase?: string;
}

// Witness names per contract — MUST stay in lockstep with DEPLOY_WITNESSES
// in preprodStack.ts (the CLI live-verified reference) and with the witness
// declarations in contracts/*.compact. Duplicated here so the browser bundle
// never imports the Node-only module. v2 adds the capability witnesses
// (insurer/oracle/settlement secrets) on the policy contract.
const DEPLOY_WITNESSES: Record<'policy' | 'settlement', string[]> = {
  policy: [
    'holder_secret',
    'insurer_secret',
    'oracle_secret1',
    'oracle_secret2',
    'settlement_secret',
  ],
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

function midnightWindow(): Record<string, InitialAPI> | undefined {
  if (typeof window === 'undefined') return undefined;
  const m = (window as unknown as Record<string, unknown>)['midnight'];
  return (m ?? undefined) as Record<string, InitialAPI> | undefined;
}

/**
 * Enumerate wallets that injected the connector Initial API. No connection
 * is attempted — enable/connect prompts require a user gesture.
 */
export function discoverWallets(): DiscoveredWallet[] {
  const m = midnightWindow();
  if (!m) return [];
  return Object.entries(m)
    .filter(([, api]) => Boolean(api) && typeof api.connect === 'function')
    .map(([id, api]) => ({
      id,
      rdns: String(api.rdns ?? ''),
      name: String(api.name ?? id),
      icon: String(api.icon ?? ''),
      apiVersion: String(api.apiVersion ?? ''),
    }));
}

function majorOf(apiVersion: string): number {
  return Number.parseInt(apiVersion.split('.')[0] ?? '0', 10) || 0;
}

/**
 * Select the wallet to connect to. Preference: an explicitly requested id,
 * then anything Lace-ish, then the first wallet implementing connector
 * API v4 (the generation this adapter speaks).
 */
export function pickWallet(wallets: DiscoveredWallet[], preferredId?: string): DiscoveredWallet {
  if (preferredId) {
    const exact = wallets.find((w) => w.id === preferredId);
    if (exact) return exact;
    throw new ConnectorError('no-wallet', `wallet "${preferredId}" is not injected`);
  }
  const laceFirst = [...wallets].sort((a, b) => {
    const lace = (w: DiscoveredWallet) =>
      /lace/i.test(w.rdns) || /lace/i.test(w.name) || /lace/i.test(w.id) ? 0 : 1;
    return lace(a) - lace(b);
  });
  const v4 = laceFirst.find((w) => majorOf(w.apiVersion) >= 4);
  if (v4) return v4;
  const any = laceFirst[0];
  if (!any) {
    throw new ConnectorError('no-wallet', 'no DApp Connector wallet is injected (window.midnight)');
  }
  throw new ConnectorError(
    'unsupported-version',
    `wallet "${any.name}" implements connector API ${any.apiVersion || 'unknown'}; ` +
      'this app needs the v4 connector generation (getProvingProvider). Update the wallet extension.',
  );
}

/**
 * Connect to a wallet and probe every capability this stack needs —
 * failing loudly with the exact missing capability instead of degrading.
 * Returns the connected API plus the wallet's own service configuration.
 */
export async function connectLace(
  opts: Pick<BrowserStackOptions, 'networkId'>,
  preferredId?: string,
): Promise<{ api: ConnectedAPI; wallet: DiscoveredWallet; config: { indexerUri?: string; indexerWsUri?: string; networkId?: string } }> {
  const wallets = discoverWallets();
  const wallet = pickWallet(wallets, preferredId);
  const initial = midnightWindow()![wallet.id]!;

  let api: ConnectedAPI;
  try {
    api = await initial.connect(opts.networkId);
  } catch (err) {
    throw new ConnectorError(
      'connect-refused',
      `wallet "${wallet.name}" refused connection: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // The proving capability is the linchpin of the browser path — without it
  // custom-circuit proofs have no honest source, so fail rather than fake.
  if (typeof (api as Record<string, unknown>)['getProvingProvider'] !== 'function') {
    throw new ConnectorError(
      'missing-proving',
      'wallet does not expose getProvingProvider — it cannot prove Condition’s circuits. ' +
        'Update the wallet extension to a connector API v4 build.',
    );
  }

  let config: { indexerUri?: string; indexerWsUri?: string; networkId?: string } = {};
  try {
    config = (await api.getConfiguration()) as typeof config;
  } catch {
    // Non-fatal: the wallet may not expose its services; we use our endpoints.
  }
  if (config.networkId && config.networkId !== opts.networkId) {
    throw new ConnectorError(
      'network-mismatch',
      `wallet is connected to "${config.networkId}" but the app needs "${opts.networkId}" — ` +
        'switch the wallet’s network and reconnect.',
    );
  }
  return { api, wallet, config };
}

/**
 * Capability-probe and read the service configuration of an INJECTED
 * connector API (verification-harness path). Same gates as connectLace —
 * the injected api must still expose the proving capability — minus wallet
 * discovery/enable.
 */
async function readWalletConfig(
  api: ConnectedAPI,
  networkId: BrowserStackOptions['networkId'],
): Promise<{ indexerUri?: string; indexerWsUri?: string; networkId?: string }> {
  if (typeof (api as Record<string, unknown>)['getProvingProvider'] !== 'function') {
    throw new ConnectorError(
      'missing-proving',
      'injected wallet API does not expose getProvingProvider — the adapter would have no honest prover',
    );
  }
  try {
    const config = (await api.getConfiguration()) as {
      indexerUri?: string;
      indexerWsUri?: string;
      networkId?: string;
    };
    if (config.networkId && config.networkId !== networkId) {
      throw new ConnectorError(
        'network-mismatch',
        `injected wallet is on "${config.networkId}", the harness needs "${networkId}"`,
      );
    }
    return config;
  } catch (err) {
    if (err instanceof ConnectorError) throw err;
    return {};
  }
}

/**
 * Build the browser LiveStack: connector-backed wallet/midnight providers,
 * wallet-delegated proving, static-artifact zk config. The returned object
 * is structurally the LiveStack preprodStack returns in Node — the runtime
 * cannot tell them apart (that is the point).
 *
 * `injectedApi` is for VERIFICATION harnesses only (a Node-side connector
 * implementation backed by the CLI wallet facade — scripts/probe-browser-stack.ts):
 * it skips discovery/enable and drives the exact adapter code path. In the
 * browser it is never passed, and the capability probes still run.
 */
export async function connectBrowserStack(
  opts: BrowserStackOptions,
  preferredWalletId?: string,
  injectedApi?: ConnectedAPI,
): Promise<LiveStack> {
  // Gates FIRST, with nothing loaded: wallet discovery, the connector-version
  // requirement and the proving-capability probe are pure checks, so a wallet
  // that cannot serve this app fails immediately instead of after megabytes of
  // browser chunks.
  const { api, config } = injectedApi
    ? { api: injectedApi, config: await readWalletConfig(injectedApi, opts.networkId) }
    : await connectLace(opts, preferredWalletId);

  // Dynamic imports: nothing browser-heavy loads until a visitor connects.
  const { setNetworkId } = await import('@midnight-ntwrk/midnight-js-network-id');
  const { parseCoinPublicKeyToHex, parseEncPublicKeyToHex, toHex, fromHex } = await import(
    '@midnight-ntwrk/midnight-js-utils'
  );
  const { asContractAddress } = await import('@midnight-ntwrk/midnight-js-types');
  const { CompiledContract } = await import('@midnight-ntwrk/compact-js');
  const { createUnprovenDeployTx, createUnprovenCallTx, submitTxAsync, getPublicStates } = await import(
    '@midnight-ntwrk/midnight-js-contracts'
  );
  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { FetchZkConfigProvider } = await import('@midnight-ntwrk/midnight-js-fetch-zk-config-provider');
  const { dappConnectorProofProvider } = await import('@midnight-ntwrk/midnight-js-dapp-connector-proof-provider');
  const ledger = await import('@midnight-ntwrk/ledger-v8');
  // In the browser, ledger-v8 resolves to a wasm shim that instantiates
  // asynchronously (webpack cannot parse the binary — see
  // frontend/src/utils/ledgerWasmShim.js). Under Node the package exports no
  // ensureLedger, so this await is a no-op and the CLI path is untouched.
  const ensureLedger = (ledger as { ensureLedger?: () => Promise<void> }).ensureLedger;
  if (ensureLedger) await ensureLedger();

  setNetworkId(opts.networkId);

  const addresses = await api.getShieldedAddresses();
  const coinPublicKey = parseCoinPublicKeyToHex(addresses.shieldedCoinPublicKey, opts.networkId);
  const encryptionPublicKey = parseEncPublicKeyToHex(addresses.shieldedEncryptionPublicKey, opts.networkId);
  const unshielded = await api.getUnshieldedAddress();
  const dust = await api.getDustBalance();

  const zkBase =
    opts.zkArtifactsBase ??
    (typeof window !== 'undefined' ? new URL('/contracts', window.location.origin).toString() : '');
  if (!zkBase) {
    throw new ConnectorError('no-wallet', 'no zk artifact base URL available outside a browser');
  }

  const zkConfigProvider = (name: 'policy' | 'settlement') => {
    const inner = new FetchZkConfigProvider(`${zkBase}/${name}`);
    // The wallet addresses circuits GLOBALLY as `contract#circuit` (it proves
    // for many contracts), while artifact files are per-contract
    // `<circuit>.prover|.bzkir`. Resolve the global location against this
    // contract's own artifact scope — same rule the CLI deployer's
    // per-contract NodeZkConfigProvider instances realize implicitly.
    const resolve = (circuitId: string) => circuitId.replace(/^policy#|^settlement#/, '');
    return {
      getZKIR: (circuitId: string) => inner.getZKIR(resolve(circuitId)),
      getProverKey: (circuitId: string) => inner.getProverKey(resolve(circuitId)),
      getVerifierKey: (circuitId: string) => inner.getVerifierKey(resolve(circuitId)),
      get: async (circuitId: string) => inner.get(resolve(circuitId)),
      getVerifierKeys: async (circuitIds: string[]) => inner.getVerifierKeys(circuitIds.map(resolve)),
      // The KeyMaterialProvider the wallet receives (dapp-connector-api):
      // the SDK's ZKConfigProvider.asKeyMaterialProvider() returns `this`,
      // i.e. the three loaders themselves — resolved here against the
      // contract scope.
      asKeyMaterialProvider: () => ({
        getZKIR: (location: string) => inner.getZKIR(resolve(location)),
        getProverKey: (location: string) => inner.getProverKey(resolve(location)),
        getVerifierKey: (location: string) => inner.getVerifierKey(resolve(location)),
      }),
    };
  };

  // One proving session per contract; the wallet's provider is obtained once
  // and reused (dappConnectorProofProvider semantics).
  const proofProviderFor = async (name: 'policy' | 'settlement') => {
    const { CostModel } = await import('@midnight-ntwrk/ledger-v8');
    return dappConnectorProofProvider(
      api,
      zkConfigProvider(name),
      CostModel.initialCostModel(),
    );
  };
  const proofProviders = new Map<'policy' | 'settlement', Promise<unknown>>();
  const proofProvider = (name: 'policy' | 'settlement') => {
    let p = proofProviders.get(name);
    if (!p) {
      p = proofProviderFor(name);
      proofProviders.set(name, p);
    }
    return p;
  };

  // The wallet's indexer when it provides one over https (documented
  // preference — the user may run services with better privacy), else ours.
  // Plain-http wallet endpoints would be mixed content from an https page —
  // not usable from a visitor's browser.
  const indexerHttp =
    config.indexerUri && /^https:\/\//.test(config.indexerUri) ? config.indexerUri : opts.indexerHttp;
  const indexerWs =
    config.indexerWsUri && /^wss:\/\//.test(config.indexerWsUri) ? config.indexerWsUri : opts.indexerWs;
  const publicDataProvider = indexerPublicDataProvider(indexerHttp, indexerWs);

  /** Minimal in-memory PrivateStateProvider (mirrors preprodStack's). */
  const privateStates = new Map<string, unknown>();
  const privateStateProvider = {
    setContractAddress: (_address: unknown) => {
      /* scope derived per-id; contract deployments carry no private state */
    },
    set: async (id: string, state: unknown) => {
      privateStates.set(id, state);
    },
    get: async (id: string) => privateStates.get(id) ?? null,
    remove: async (id: string) => {
      privateStates.delete(id);
    },
    clear: async () => {
      privateStates.clear();
    },
    setSigningKey: async (_address: string, _key: unknown) => {
      /* signing keys live in the wallet — never in this page */
    },
    getSigningKey: async () => null,
    removeSigningKey: async (_address: string) => {
      /* nothing to remove */
    },
    clearSigningKeys: async () => {
      /* nothing stored */
    },
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

  const callWitnesses = (
    name: 'policy' | 'settlement',
    real: Record<string, (context: unknown) => [unknown, unknown]>,
  ) => ({
    ...deployWitnesses(name),
    ...real,
  });

  /** Load the committed compiled contract module (see managedContracts.ts). */
  const loadCompiled = async (name: 'policy' | 'settlement') => {
    const mod = (await loadManagedContractModule(name)) as unknown as Record<string, unknown>;
    return mod['Contract'] as Parameters<typeof CompiledContract.make>[1];
  };

  const withTimeout = <T>(p: Promise<T>, ms: number, message: string): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

  const awaitTxConfirmed = async (txId: string, timeoutMs: number): Promise<string> => {
    const finalized = (await withTimeout(
      (publicDataProvider as {
        watchForTxData: (id: string) => Promise<{ status: string; txHash: string }>;
      }).watchForTxData(txId),
      timeoutMs,
      `tx not finalized within ${Math.round(timeoutMs / 60_000)} minutes`,
    )) as { status: string; txHash: string };
    if (finalized.status !== 'SucceedEntirely') {
      throw new Error(`tx ${finalized.txHash} finalized with status ${finalized.status}`);
    }
    return finalized.txHash;
  };

  const deployContract = async (name: 'policy' | 'settlement') => {
    const Contract = await loadCompiled(name);
    const compiled = CompiledContract.make(name, Contract).pipe(
      CompiledContract.withWitnesses(deployWitnesses(name) as never),
    );
    const providers = {
      privateStateProvider,
      publicDataProvider,
      zkConfigProvider: zkConfigProvider(name),
      proofProvider: await proofProvider(name),
      walletProvider,
      midnightProvider,
    } as never;

    // createUnprovenDeployTx derives the contract address locally, BEFORE
    // submit — the address is the recovery key if submission blips.
    const unproven = (await createUnprovenDeployTx(providers, {
      compiledContract: compiled,
    } as never)) as { public: { contractAddress: { toString(): string } } };
    const address = unproven.public.contractAddress.toString();

    try {
      const txId = (await submitTxAsync(providers, {
        unprovenTx: (unproven as unknown as { private: { unprovenTx: unknown } }).private.unprovenTx,
      } as never)) as string;
      const txHash = await awaitTxConfirmed(txId, 180_000);
      return { address, txHash };
    } catch (err) {
      // A SUBMIT failure can race an actually-landed tx: poll the address's
      // own action trail before giving up. The recovered tx must have
      // SUCCEEDED on-chain — a landed-but-failed deploy is a hard error,
      // never relabeled as confirmation.
      const recovered = await pollContractTxHash(address, 120_000);
      if (!recovered) throw err;
      if (recovered.status !== 'SucceedEntirely') {
        throw new Error(
          `${name} deploy tx ${recovered.txHash} finalized with status ${recovered.status}`,
        );
      }
      return { address, txHash: recovered.txHash };
    }
  };

  const pollContractTxHash = async (
    addr: string,
    timeoutMs: number,
  ): Promise<{ txHash: string; status: string } | null> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const resp = await fetch(indexerHttp, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ contractAction(address: "${addr}") {
                ... on ContractDeploy { transaction { hash ... on RegularTransaction { transactionResult { status } } } }
                ... on ContractUpdate { transaction { hash ... on RegularTransaction { transactionResult { status } } } }
              } }`,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await resp.json()) as {
          data?: { contractAction?: { transaction?: { hash?: string; status?: string } } | null };
        };
        const tx = body.data?.contractAction?.transaction;
        if (tx?.hash) return { txHash: tx.hash, status: tx.status ?? 'UNKNOWN' };
      } catch {
        // transient — retry until the deadline
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    return null;
  };

  const callCircuit: LiveStack['callCircuit'] = async (name, options) => {
    const Contract = await loadCompiled(name);
    const compiled = CompiledContract.make(name, Contract).pipe(
      CompiledContract.withWitnesses(callWitnesses(name, options.witnesses) as never),
    );
    const providers = {
      publicDataProvider,
      zkConfigProvider: zkConfigProvider(name),
      proofProvider: await proofProvider(name),
      walletProvider,
      midnightProvider,
    } as never;

    const unproven = (await createUnprovenCallTx(providers, {
      compiledContract: compiled,
      circuitId: options.circuitId,
      contractAddress: asContractAddress(options.contractAddress),
      args: options.args as never,
    } as never)) as { private: { result?: unknown; unprovenTx: unknown } };
    // Only the circuit's own JS return value is extracted — never the
    // unproven tx, ZK inputs, or private transcript (privacy Invariant 2).
    const result = unproven.private.result;

    const txId = (await submitTxAsync(providers, {
      unprovenTx: unproven.private.unprovenTx,
    } as never)) as string;
    const txHash = await awaitTxConfirmed(txId, 180_000);
    return { txHash, result };
  };

  const readLedger: LiveStack['readLedger'] = async (name, addr) => {
    const managedContract = (await loadManagedContractModule(name)) as unknown as {
      ledger: (state: unknown) => Record<string, unknown>;
    };
    const states = (await getPublicStates(publicDataProvider as never, asContractAddress(addr))) as {
      contractState: { data: unknown };
    };
    return managedContract.ledger(states.contractState.data);
  };

  const walletProvider = {
    getCoinPublicKey: () => coinPublicKey,
    getEncryptionPublicKey: () => encryptionPublicKey,
    /**
     * The tx arrives PROVEN (UnboundTransaction — proof present, pre-binding)
     * which is exactly balanceUnsealedTransaction's documented input; the
     * wallet pays fees, adds balancing inputs/outputs, signs, and returns a
     * sealed tx (bound). TTL is the wallet's concern here.
     */
    balanceTx: async (tx: unknown) => {
      const hex = toHex((tx as { serialize(): Uint8Array }).serialize());
      const { tx: sealedHex } = await api.balanceUnsealedTransaction(hex, { payFees: true });
      return ledger.Transaction.deserialize('signature', 'proof', 'binding', fromHex(sealedHex)) as never;
    },
  };

  const midnightProvider = {
    /**
     * submitTransaction resolves once the wallet has RELAYED the tx; the
     * watch id comes from the sealed tx's own identifiers (the indexer
     * matches transactions by identifier — TX_ID_QUERY offset).
     */
    submitTx: async (finalized: unknown) => {
      const sealed = finalized as { serialize(): Uint8Array; identifiers(): string[] };
      const hex = toHex(sealed.serialize());
      await api.submitTransaction(hex);
      const ids = sealed.identifiers();
      if (!ids.length) {
        throw new Error('balanced tx exposes no identifiers — confirmation would be unverifiable');
      }
      return ids[0]!;
    },
  };

  return {
    wallet: api as unknown,
    walletProvider,
    midnightProvider,
    publicDataProvider: publicDataProvider as unknown,
    address: unshielded.unshieldedAddress,
    dustBalance: dust.balance,
    deployContract,
    callCircuit,
    readLedger,
    close: async () => {
      /* the connector manages its own session; nothing to tear down */
    },
  };
}
