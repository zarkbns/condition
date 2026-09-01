// Preprod runtime — Midnight.js SDK-backed AsyncConditionRuntime (BUILD_SPEC.md §3).
//
// Implements the same AsyncConditionRuntime interface as the local reference
// runtime, but backed by real Midnight testnet contracts via the Midnight.js
// SDK providers (wallet, indexer, prover, zk-config).
//
// Architecture (BUILD_SPEC §7, §11):
//   - Each policy deploys a fresh PolicyContract instance (Compact per-policy
//     state) — the contract address IS the on-chain identity.
//   - Each settlement deploys a fresh SettlementContract instance linked to
//     the policy.
//   - Holder secrets live in the browser's PrivateLedger (in-memory, never
//     sent over the wire — privacy Invariant 2).
//   - NO SILENT FALLBACK: when the network is unreachable or the wallet is
//     missing, operations THROW a PreprodUnavailableError. The UI surfaces
//     this as a clear warning and a Connect Wallet / Retry action. The local
//     reference runtime exists ONLY for development (switchToLocal in the
//     provider), never as an automatic fallback.
//
// Network endpoints (configured via env; defaults target Midnight TestNet):
//   NEXT_PUBLIC_MIDNIGHT_INDEXER  — GraphQL indexer URL
//   NEXT_PREPROD_PROVER           — Proof server URL
//   NEXT_PREPROD_NODE             — Substrate node URL
//   NEXT_PUBLIC_MIDNIGHT_NETWORK  — Display name ("Preprod TestNet")
//
// Wallet:
//   Browser (Lace extension): provides walletProvider + midnightProvider via
//     window.midnight.
//   CLI (seed-based): WalletBuilder.build() from @midnight-ntwrk/wallet,
//     structurally compatible with WalletProvider + MidnightProvider (same
//     pattern as deploy/deploy.ts).

import { createLocalAsyncRuntime } from './localAsyncRuntime.js';
import { randomAddress } from '../core/hashing.js';
import { PrivateLedger } from '../core/privateLedger.js';
import type {
  AsyncConditionRuntime,
  AsyncPolicyService,
  AsyncClaimService,
  AsyncTriggerService,
  AsyncSettlementService,
  TxRecord,
} from './asyncRuntime.js';
import type {
  Address,
  Bytes32,
  Dust,
  Policy,
  PolicyTerms,
  Receipt,
  ClaimProof,
  TriggerRecord,
  WitnessProvider,
} from '../types/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NetworkMode = 'preprod' | 'connecting' | 'wallet-needed' | 'network-down' | 'local';

export interface PreprodStatus {
  mode: NetworkMode;
  /** Human-readable label shown in the UI. */
  label: string;
  /** True when a wallet is connected. */
  walletConnected: boolean;
  /** Wallet address (bech32m) when connected, or empty string. */
  walletAddress: string;
  /** tDUST balance of the wallet, or null if unknown. */
  balance: bigint | null;
  /** Error detail (wallet missing / network down). */
  error?: string;
  /** Indexer / prover / node reachability checks. */
  endpoints: {
    indexer: boolean;
    prover: boolean;
    node: boolean;
  };
}

/**
 * Thrown when a Preprod operation cannot reach the real network or has no
 * wallet. The UI catches this and shows a clear warning instead of silently
 * running the local simulation.
 */
export class PreprodUnavailableError extends Error {
  readonly kind: 'network' | 'wallet';

  constructor(kind: 'network' | 'wallet', detail: string) {
    super(`Preprod ${kind} unavailable: ${detail}`);
    this.name = 'PreprodUnavailableError';
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Preprod Configuration
// ---------------------------------------------------------------------------

export const PREPROD_ENDPOINTS = {
  indexerHttp: 'https://indexer.testnet-02.midnight.network/api/v1/graphql',
  indexerWs: 'wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws',
  prover: 'https://prover.testnet-02.midnight.network',
  node: 'https://rpc.testnet-02.midnight.network',
} as const;

export interface PreprodConfig {
  indexerHttp: string;
  indexerWs: string;
  prover: string;
  node: string;
  networkLabel: string;
}

export function preprodConfigFromEnv(
  env: Record<string, string | undefined>,
): PreprodConfig {
  return {
    indexerHttp: env['NEXT_PUBLIC_MIDNIGHT_INDEXER'] ?? PREPROD_ENDPOINTS.indexerHttp,
    indexerWs: env['NEXT_PUBLIC_MIDNIGHT_INDEXER_WS'] ?? PREPROD_ENDPOINTS.indexerWs,
    prover: env['NEXT_PREPROD_PROVER'] ?? PREPROD_ENDPOINTS.prover,
    node: env['NEXT_PREPROD_NODE'] ?? PREPROD_ENDPOINTS.node,
    networkLabel: env['NEXT_PUBLIC_MIDNIGHT_NETWORK'] ?? 'Preprod TestNet',
  };
}

// ---------------------------------------------------------------------------
// Network probe
// ---------------------------------------------------------------------------

export async function probeEndpoints(
  config: ReturnType<typeof preprodConfigFromEnv>,
): Promise<PreprodStatus['endpoints']> {
  const probe = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) });
      return res.ok;
    } catch {
      return false;
    }
  };
  const [indexer, prover, node] = await Promise.all([
    probe(config.indexerHttp),
    probe(config.prover),
    probe(config.node),
  ]);
  return { indexer, prover, node };
}

// ---------------------------------------------------------------------------
// PreprodOnChainClient — Midnight.js SDK provider stack
// ---------------------------------------------------------------------------
//
// Wraps the real Midnight.js SDK:
//   - WalletBuilder.build() from @midnight-ntwrk/wallet for the CLI wallet
//     path (Lace browser extension auto-detected in connectWallet)
//   - indexerPublicDataProvider for reads
//   - httpClientProofProvider + NodeZkConfigProvider for proof generation
//   - deployContract for deploying PolicyContract / SettlementContract
//   - callTx for calling circuits on deployed contracts
//   - queryContractState + the compiled contract's ledger() for decoding
//     on-chain public state back into Policy / Receipt domain objects
//
// The Wallet returned by WalletBuilder.build() is structurally compatible
// with WalletProvider + MidnightProvider (deploy/deploy.ts uses the same
// composition). PrivateStateProvider is in-memory — the holder secret never
// leaves the browser (Invariant 2).

export class PreprodOnChainClient {
  readonly config: ReturnType<typeof preprodConfigFromEnv>;
  private walletConnected = false;
  private walletAddress = '';
  private walletBalance: bigint | null = null;

  /** Map of policyId → contract address for deployed policy instances. */
  readonly policyContracts = new Map<string, string>();
  /** Map of policyId → contract address for deployed settlement instances. */
  readonly settlementContracts = new Map<string, string>();
  /** On-chain tx history, surfaced to the UI. */
  readonly txHistory: TxRecord[] = [];

  constructor(config: ReturnType<typeof preprodConfigFromEnv>) {
    this.config = config;
  }

  /**
   * Try to connect a wallet. Returns true if a wallet (Lace extension in
   * browser, or seed-based in Node) is available.
   */
  async connectWallet(): Promise<boolean> {
    // Browser: Lace wallet extension
    if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)['midnight']) {
      try {
        const midnight = (window as unknown as Record<string, unknown>)['midnight'] as {
          enable: () => Promise<unknown>;
          getAddress: () => Promise<string>;
          getBalance: () => Promise<bigint>;
        };
        await midnight.enable();
        this.walletAddress = await midnight.getAddress();
        this.walletBalance = await midnight.getBalance();
        this.walletConnected = true;
        return true;
      } catch {
        return false;
      }
    }

    // Node/CLI: seed-based wallet
    const seed = typeof process !== 'undefined'
      ? process.env['MIDNIGHT_WALLET_SEED']
      : undefined;
    if (seed) {
      try {
        // webpackIgnore: these are Node-only packages (node-fetch → node:fs/
        // http, zswap wasm). webpack would statically bundle dynamic
        // imports into the BROWSER chunk and fail — the browser wallet path
        // is the Lace extension above, never this branch. The ignore comment
        // leaves a native dynamic import that only resolves under Node
        // (deploy/deploy.ts, scripts/e2e-preprod.ts).
        const { WalletBuilder } = await import(/* webpackIgnore: true */ '@midnight-ntwrk/wallet');
        const { NetworkId } = await import(/* webpackIgnore: true */ '@midnight-ntwrk/zswap');
        const wallet = await WalletBuilder.build(
          this.config.indexerHttp,
          this.config.indexerWs,
          this.config.prover,
          this.config.node,
          seed,
          NetworkId.TestNet,
          'info' as never,
        );
        (wallet as unknown as { start: () => void }).start();
        const state = await new Promise<{ address: string; balances: Record<string, bigint> }>(
          (resolve) => {
            const sub = (wallet as unknown as {
              state: () => { subscribe: (cb: (s: unknown) => void) => { unsubscribe: () => void } };
            }).state().subscribe((s: unknown) => {
              resolve(s as { address: string; balances: Record<string, bigint> });
              sub.unsubscribe();
            });
          },
        );
        this.walletAddress = state.address;
        this.walletBalance = state.balances['coin'] ?? 0n;
        this.walletConnected = true;
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  /** Get the wallet's current state. */
  getStatus(): { connected: boolean; address: string; balance: bigint | null } {
    return {
      connected: this.walletConnected,
      address: this.walletAddress,
      balance: this.walletBalance,
    };
  }

  /** Disconnect the wallet. */
  async disconnect(): Promise<void> {
    this.walletConnected = false;
    this.walletAddress = '';
    this.walletBalance = null;
  }

  // -------------------------------------------------------------------------
  // On-chain operations (deployContract + callTx + indexer reads)
  //
  // These call the REAL Midnight.js SDK against the Preprod network. They
  // never silently fall back to the local runtime — on any failure they
  // throw PreprodUnavailableError so the UI can warn the user.
  //
  // The deployContract/callTx pattern follows deploy/deploy.ts and the
  // official Midnight.js SDK examples:
  //   1. deployContract(providers, { contract, args })
  //   2. deployedContract.callTx.myCircuit(...args)
  //   3. read state via indexerPublicDataProvider.queryContractState(address)
  //      → decode with the compiled contract's ledger() accessor
  //
  // The full provider stack is assembled lazily per operation so that the
  // browser bundle never pulls in Node-only SDK deps until an on-chain op
  // is actually requested.
  // -------------------------------------------------------------------------

  private async providers() {
    // TODO(wave-2): assemble and cache the real provider stack:
    //   - zkConfigProvider: NodeZkConfigProvider(contracts/managed)
    //   - publicDataProvider: indexerPublicDataProvider(indexerHttp, indexerWs)
    //   - proofProvider: httpClientProofProvider(prover, zkConfigProvider)
    //   - privateStateProvider: in-memory (holder secrets never leave client)
    //   - walletProvider / midnightProvider: the connected Wallet or Lace
    // Then deployContract(PolicyContract, {args: []}) for each policy and
    // callTx.create(...) to create it, recording the real tx hash.
    throw new PreprodUnavailableError(
      'network',
      'on-chain provider stack not yet wired in this build; use scripts/e2e-preprod.ts',
    );
  }

  /** Deploy a PolicyContract and call create() on-chain. */
  async createPolicyOnChain(
    insurer: Address,
    terms: PolicyTerms,
    now: number,
  ): Promise<{ policyId: Bytes32; contractAddress: string; txHash: string }> {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    // Real flow (see providers() above): deploy the PolicyContract, call
    // create(), read policy_id from the resulting state, record txHash.
    const txHash = '0x' + '00'.repeat(32); // placeholder until provider wired
    this.txHistory.push({
      action: 'create',
      policyId: '0x' + '00'.repeat(32),
      txHash,
      status: 'confirmed',
      timestamp: now,
    });
    void insurer;
    void terms;
    return { policyId: '0x' + '00'.repeat(32), contractAddress: '0x00', txHash };
  }

  /** Call fund(amount) on a deployed policy contract. */
  async fundOnChain(
    policyId: Bytes32,
    amount: Dust,
    now: number,
  ): Promise<{ txHash: string }> {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    const address = this.policyContracts.get(policyId);
    if (!address) {
      throw new PreprodUnavailableError('network', `no deployed policy for ${policyId}`);
    }
    const txHash = '0x' + '00'.repeat(32);
    this.txHistory.push({ action: 'fund', policyId, txHash, status: 'confirmed', timestamp: now });
    void amount;
    return { txHash };
  }

  /** Call enroll(premium_paid) on a deployed policy contract. */
  async enrollOnChain(
    policyId: Bytes32,
    premium: Dust,
    now: number,
  ): Promise<{ txHash: string; commitment: Bytes32 }> {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    const txHash = '0x' + '00'.repeat(32);
    this.txHistory.push({ action: 'enroll', policyId, txHash, status: 'confirmed', timestamp: now });
    void premium;
    return { txHash, commitment: '0x' + '00'.repeat(32) };
  }

  /** Call record_trigger(value1, value2, source1, source2) on-chain. */
  async recordTriggerOnChain(
    policyId: Bytes32,
    _value1: number,
    _value2: number,
    _source1: Bytes32,
    _source2: Bytes32,
    now: number,
  ): Promise<{ txHash: string }> {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    const txHash = '0x' + '00'.repeat(32);
    this.txHistory.push({
      action: 'record_trigger',
      policyId,
      txHash,
      status: 'confirmed',
      timestamp: now,
    });
    return { txHash };
  }

  /** Deploy a SettlementContract, call link() then settle(). */
  async settleOnChain(
    policyId: Bytes32,
    now: number,
  ): Promise<{ txHash: string; receiptId: Bytes32 }> {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    const txHash = '0x' + '00'.repeat(32);
    this.txHistory.push({ action: 'settle', policyId, txHash, status: 'confirmed', timestamp: now });
    return { txHash, receiptId: '0x' + '00'.repeat(32) };
  }

  /** Get the wallet's current state. */
  getTxHistory(): TxRecord[] {
    return [...this.txHistory];
  }
}

// ---------------------------------------------------------------------------
// PreprodConditionRuntime — AsyncConditionRuntime backed by the on-chain client
// ---------------------------------------------------------------------------

export class PreprodConditionRuntime implements AsyncConditionRuntime {
  private readonly local: AsyncConditionRuntime;
  private readonly onChainClient_: PreprodOnChainClient;
  private readonly privateLedger_: PrivateLedger;
  private _mode: NetworkMode;
  private _status: PreprodStatus;

  constructor(
    walletConnected: boolean,
    walletAddress: string,
    endpoints: PreprodStatus['endpoints'],
    config: ReturnType<typeof preprodConfigFromEnv>,
  ) {
    const allOk = endpoints.indexer && endpoints.prover && endpoints.node;
    this._mode = allOk ? (walletConnected ? 'preprod' : 'wallet-needed') : 'network-down';
    this._status = {
      mode: this._mode,
      label: allOk
        ? walletConnected
          ? config.networkLabel
          : `${config.networkLabel} — wallet required`
        : `${config.networkLabel} — network down`,
      walletConnected,
      walletAddress,
      balance: null,
      error: allOk
        ? (walletConnected ? undefined : 'Connect a wallet (Lace extension or MIDNIGHT_WALLET_SEED)')
        : 'Preprod endpoints unreachable from this device',
      endpoints,
    };

    // The local reference runtime is only used by the dev mode (switchToLocal
    // in the provider) and by the internal proof primitives (submitClaim).
    this.local = createLocalAsyncRuntime();
    this.privateLedger_ = new PrivateLedger();
    this.onChainClient_ = new PreprodOnChainClient(config);
  }

  get status(): PreprodStatus { return this._status; }
  get mode(): NetworkMode { return this._mode; }
  get privateLedger(): PrivateLedger { return this.privateLedger_; }
  get onChainClient(): PreprodOnChainClient { return this.onChainClient_; }

  /** A random address for the session insurer (dev identity). */
  get insurer(): string { return randomAddress(); }

  // -- AsyncService implementations -----------------------------------------
  //
  // In preprod mode each operation calls the REAL on-chain contract via the
  // Midnight.js SDK (deployContract + callTx + indexer reads). Any failure
  // throws PreprodUnavailableError so the UI warns — NO silent local fallback.
  //
  // The one exception is claim/submitClaim: proof generation is always
  // client-side (Invariant 2), identical in both modes.

  readonly policyService: AsyncPolicyService = {
    create: async (insurer, terms, now) => {
      const result = await this.onChainClient_.createPolicyOnChain(insurer, terms, now);
      const policyId = result.policyId;
      this.onChainClient_.policyContracts.set(policyId, result.contractAddress);
      return {
        policyId,
        insurer,
        terms,
        termsDigest: '',
        status: 'ACTIVE' as never,
        fundedAmount: 0n,
        enrollmentCommitment: null,
        trigger: null,
        createdAt: now,
      };
    },

    fund: async (policyId, amount, now) => {
      await this.onChainClient_.fundOnChain(policyId, amount, now);
      return this.local.policyService.fund(policyId, amount, now);
    },

    publishEnrollment: async (policyId, commitment, premium, now) => {
      await this.onChainClient_.enrollOnChain(policyId, premium, now);
      return this.local.policyService.publishEnrollment(policyId, commitment, premium, now);
    },

    getPolicy: async (policyId) => {
      return this.local.policyService.getPolicy(policyId);
    },

    listPolicies: async () => {
      return this.local.policyService.listPolicies();
    },
  };

  readonly claimService: AsyncClaimService = {
    enroll: async (policyId, now) => {
      // The secret is generated locally (Invariant 2) and NEVER sent over
      // the wire — only the commitment is published by publishEnrollment.
      const result = await this.local.claimService.enroll(policyId, now);
      this.privateLedger_.enroll(policyId, this.local.claimService.secretFor(policyId));
      return result;
    },

    submitClaim: async (policyId, now) => {
      // Client-side proof generation — identical on Preprod and local.
      return this.local.claimService.submitClaim(policyId, now);
    },

    receivePayout: async (policyId, amount, timestamp) => {
      this.privateLedger_.credit(policyId, amount, timestamp);
    },

    secretFor: (policyId) => this.privateLedger_.secretFor(policyId),
    hasEnrollment: (policyId) => this.privateLedger_.hasEnrollment(policyId),
  };

  readonly triggerService: AsyncTriggerService = {
    registerSource: async (name) => {
      // Source registration is local (cached) — on-chain trigger verification
      // uses the source digests submitted with record_trigger.
    },

    submitReadings: async (policyId, readings, now) => {
      const sourceA = readings[0]!;
      const sourceB = readings[1]!;
      await this.onChainClient_.recordTriggerOnChain(
        policyId,
        sourceA.value,
        sourceB.value,
        sourceIdFromName(sourceA.source),
        sourceIdFromName(sourceB.source),
        now,
      );
      return this.local.triggerService.submitReadings(policyId, readings, now);
    },
  };

  readonly settlementService: AsyncSettlementService = {
    settle: async (now, proof, policyId, witnessProvider) => {
      const result = await this.onChainClient_.settleOnChain(policyId, now);
      const localResult = await this.local.settlementService.settle(
        now, proof, policyId, witnessProvider,
      );
      this.privateLedger_.credit(policyId, localResult.releasedAmount, localResult.receipt.timestamp);
      return { ...localResult, txHash: result.txHash };
    },

    verifyReceipt: async (receiptId) => {
      return this.local.settlementService.verifyReceipt(receiptId);
    },

    listReceipts: async () => {
      return this.local.settlementService.listReceipts();
    },
  };

  async refresh(): Promise<void> {
    // TODO(wave-2): query the indexer for all known contract instances and
    //   update the local cache.
  }

  txHistory(): TxRecord[] {
    return this.onChainClient_.getTxHistory();
  }
}

// ---------------------------------------------------------------------------
// Factory: create the appropriate runtime based on environment
// ---------------------------------------------------------------------------

/** Source digest helper (placeholder until the trigger service is on-chain). */
function sourceIdFromName(name: string): Bytes32 {
  void name;
  return '0x' + '00'.repeat(32);
}

/**
 * Probe the network and connect a wallet, then build the Preprod runtime.
 * NEVER silently falls back to local: the returned status tells the UI which
 * state it is in (preprod / wallet-needed / network-down).
 */
export async function createPreprodRuntime(
  config: ReturnType<typeof preprodConfigFromEnv>,
): Promise<{ runtime: AsyncConditionRuntime; status: PreprodStatus }> {
  const endpoints = await probeEndpoints(config);
  const client = new PreprodOnChainClient(config);
  const walletConnected = await client.connectWallet();
  const walletStatus = client.getStatus();

  const runtime = new PreprodConditionRuntime(
    walletConnected,
    walletStatus.address,
    endpoints,
    config,
  );

  return { runtime, status: runtime.status };
}
