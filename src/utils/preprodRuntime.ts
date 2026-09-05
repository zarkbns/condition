// Preprod runtime — Midnight.js SDK-backed AsyncConditionRuntime (BUILD_SPEC.md §3).
//
// Implements the same AsyncConditionRuntime interface as the local reference
// runtime, but backed by real Midnight Preprod contracts via the Midnight.js
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
// Network endpoints (configured via env; defaults target Midnight Preprod):
//   NEXT_PUBLIC_MIDNIGHT_INDEXER  — GraphQL indexer URL (indexer API v3 —
//                                    the surface this repo's SDK generation
//                                    is verified against; see
//                                    docs/DEPLOYMENTS.md before switching
//                                    to v4)
//   NEXT_PREPROD_PROVER           — Proof server URL (no hosted Preprod prover
//                                    exists; run a local Docker proof server)
//   NEXT_PREPROD_NODE             — Substrate node URL
//   NEXT_PUBLIC_MIDNIGHT_NETWORK  — Display name ("Preprod")
//
// Wallet:
//   Browser (Lace extension): provides walletProvider + midnightProvider via
//     window.midnight.
//   CLI (seed-based): WalletBuilder.build() from @midnight-ntwrk/wallet,
//     structurally compatible with WalletProvider + MidnightProvider (same
//     pattern as deploy/deploy.ts).

import { createLocalAsyncRuntime } from './localAsyncRuntime.js';
import {
  randomAddress,
  sourceIdDigest,
  hexToBytes,
  nullifierOf,
  triggerTypeCode,
  comparisonOpCode,
  readingDigestOf,
} from '../core/hashing.js';
import { PrivateLedger } from '../core/privateLedger.js';
// Type-only: preprodStack statically imports node:buffer and must never
// enter the browser bundle — the value import is a dynamic (webpackIgnore'd)
// import inside connectWallet, Node only.
import type { LiveStack } from './preprodStack.js';
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
  ClaimWitness,
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

/**
 * Failure for on-chain operations when the Node-only live stack cannot be
 * built (no seed, no network, browser context). On-chain writes must fail
 * loudly — never return placeholder hashes — a fabricated "confirmed" tx
 * would leak into the UI as fake settlement evidence.
 */
function stackUnavailable(detail: string): PreprodUnavailableError {
  return new PreprodUnavailableError('network', detail);
}

// ---------------------------------------------------------------------------
// Preprod Configuration
// ---------------------------------------------------------------------------

export const PREPROD_ENDPOINTS = {
  // Midnight Preprod — indexer API v3: the wallet-sdk facade /
  // midnight-js 4.1.1 generation this repo uses is verified against v3
  // (deploy/deploy.ts pushed every wallet-stack query through it, live).
  // v4 exists and currently answers the same read queries, but nothing in
  // this repo has been verified against it — see docs/DEPLOYMENTS.md.
  // No hosted Preprod prover exists: proofs are generated client-side
  // (Invariant 2), and contract proving that needs a proof server uses a
  // local Docker proof server (localhost:6300).
  indexerHttp: 'https://indexer.preprod.midnight.network/api/v3/graphql',
  indexerWs: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
  prover: 'http://127.0.0.1:6300',
  node: 'https://rpc.preprod.midnight.network',
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
    networkLabel: env['NEXT_PUBLIC_MIDNIGHT_NETWORK'] ?? 'Preprod',
  };
}

// ---------------------------------------------------------------------------
// Network probe
// ---------------------------------------------------------------------------

/**
 * Dust ledger event id from which a bootstrapped dust wallet resumes replay
 * (mirrors deploy/deploy.ts — just before the deployer wallet's own dust
 * registration events).
 */
const DUST_RESUME_EVENT_ID = 1_480_937n;

/** Bytes32 hex string from a circuit result (Uint8Array). */
function bytesToHex32(result: unknown): Bytes32 {
  if (!(result instanceof Uint8Array) || result.length !== 32) {
    throw new PreprodUnavailableError(
      'network',
      `circuit returned unexpected bytes32 (expected Uint8Array(32), got ${typeof result})`,
    );
  }
  let hex = '0x';
  for (const b of result) {
    hex += (b >>> 4).toString(16) + (b & 0xf).toString(16);
  }
  return hex;
}

export async function probeEndpoints(
  config: ReturnType<typeof preprodConfigFromEnv>,
): Promise<PreprodStatus['endpoints']> {
  // Any HTTP response means the host answered (GraphQL endpoints return 400
  // on plain GET; the local proof server is not a REST API) — only a thrown
  // fetch (refused / DNS failure / timeout) counts as down.
  const probe = async (url: string): Promise<boolean> => {
    try {
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(6000) });
      return true;
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
  /** Live facade stack (Node only) — built lazily by connectWallet(). */
  private stack: LiveStack | null = null;

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

    // Node/CLI: seed-based wallet via the facade stack (the same wiring as
    // deploy/deploy.ts — unshielded + bootstrapped dust wallets, providers,
    // per-contract zk config). connectLiveStack assigns this.stack.
    const seed = typeof process !== 'undefined'
      ? process.env['MIDNIGHT_WALLET_SEED']
      : undefined;
    if (!seed) {
      return false;
    }
    if (this.stack) {
      return true; // already connected
    }
    try {
      // webpackIgnore: preprodStack pulls Node-only packages (node:fs, ws,
      // zswap wasm). webpack would statically bundle this dynamic import
      // into the BROWSER chunk and fail — the browser wallet path is the
      // Lace extension above, never this branch. The ignore comment leaves
      // a native dynamic import that only resolves under Node.
      const { connectLiveStack } = await import(/* webpackIgnore: true */ './preprodStack.js');
      const { join } = await import(/* webpackIgnore: true */ 'node:path');
      const stack = await connectLiveStack({
        indexerHttp: this.config.indexerHttp,
        indexerWs: this.config.indexerWs,
        proverUrl: this.config.prover,
        nodeUrl: this.config.node,
        seed,
        // Resolved from the repo root by preprodStack itself; the snapshot
        // is a local cache, gitignored.
        dustSnapshotPath: join(process.cwd(), 'deploy', 'dust-wallet-snapshot.json'),
        dustResumeEventId: DUST_RESUME_EVENT_ID,
      });
      this.stack = stack;
      this.walletAddress = stack.address;
      this.walletBalance = stack.dustBalance;
      this.walletConnected = true;
      return true;
    } catch {
      // Stack failures (network down, unfunded dust, no snapshot, wasm
      // issues) surface through the endpoint probe + status; never
      // simulate.
      return false;
    }
  }

  /** Get the wallet's current state. */
  getStatus(): { connected: boolean; address: string; balance: bigint | null } {
    return {
      connected: this.walletConnected,
      address: this.walletAddress,
      balance: this.walletBalance,
    };
  }

  /** Disconnect the wallet and tear down the live stack. */
  async disconnect(): Promise<void> {
    if (this.stack) {
      await this.stack.close().catch(() => {});
      this.stack = null;
    }
    this.walletConnected = false;
    this.walletAddress = '';
    this.walletBalance = null;
  }

  // -------------------------------------------------------------------------
  // On-chain operations (deploy + call + indexer reads via the live stack)
  //
  // These run the REAL Midnight.js SDK against the Preprod network through
  // the shared preprodStack (the exact wiring that deployed the live
  // contracts — see docs/DEPLOYMENTS.md). They never silently fall back to
  // the local runtime; on any failure they throw PreprodUnavailableError so
  // the UI can warn the user.
  //
  // Witness privacy (Invariant 2): holder secrets are consumed ONLY inside
  // the witness closures constructed in this class (holderSecretFor), at
  // circuit-execution time, in-process. They are never serialized, logged,
  // or attached to anything that leaves this device.
  // -------------------------------------------------------------------------

  /** Holder secrets keyed by policyId — client-side only (Invariant 2). */
  private readonly holderSecrets = new Map<Bytes32, Bytes32>();

  /** Register the local holder secret for a policy (from claimService.enroll). */
  registerHolderSecret(policyId: Bytes32, secret: Bytes32): void {
    this.holderSecrets.set(policyId, secret);
  }

  private holderSecretFor(policyId: Bytes32): Bytes32 {
    const secret = this.holderSecrets.get(policyId);
    if (!secret) {
      throw new PreprodUnavailableError(
        'wallet',
        `no local holder secret for ${policyId} — enroll before on-chain operations`,
      );
    }
    return secret;
  }

  private requireStack(): LiveStack {
    if (!this.walletConnected) {
      throw new PreprodUnavailableError('wallet', 'no wallet connected');
    }
    if (!this.stack) {
      throw stackUnavailable(
        'on-chain writes need the Node live stack (seed via MIDNIGHT_WALLET_SEED — CLI/e2e only). ' +
          'A browser wallet connection alone does not wire on-chain transactions yet; ' +
          'browser on-chain operations stay unavailable rather than simulated',
      );
    }
    return this.stack;
  }

  /** Record a confirmed tx in the UI-visible history. */
  private record(
    action: TxRecord['action'],
    policyId: Bytes32,
    txHash: string,
    timestamp: number,
    contractAddress?: string,
  ): void {
    this.txHistory.push({ action, policyId, txHash, contractAddress, status: 'confirmed', timestamp });
  }

  /**
   * Deploy a PolicyContract and call create() on-chain. `nonce` MUST match
   * the local reference runtime's nonce counter so both layers derive the
   * same policyId H("condition:policy:v1", insurer, nonce) — the caller
   * pins this with a parity check. Enum arguments are the 0-based ordinals
   * shared with triggerTypeCode/comparisonOpCode (the generated circuits
   * type-check plain numbers).
   */
  async createPolicyOnChain(
    insurer: Address,
    terms: PolicyTerms,
    now: number,
    nonce: number,
  ): Promise<{ policyId: Bytes32; contractAddress: string; txHash: string }> {
    const stack = this.requireStack();

    // One policy instance per policy; the create() args are fully public
    // (policy transparency — Invariant 5).
    const { address } = await stack.deployContract('policy');
    const call = await stack.callCircuit('policy', {
      circuitId: 'create',
      contractAddress: address,
      args: [
        hexToBytes(insurer),
        triggerTypeCode(terms.triggerType),
        comparisonOpCode(terms.operator),
        BigInt(terms.threshold),
        terms.payoutAmount,
        terms.premium,
        BigInt(terms.coverageStart),
        BigInt(terms.expiry),
        BigInt(now),
        BigInt(nonce),
      ],
      witnesses: {},
    });
    const policyId = bytesToHex32(call.result);
    this.policyContracts.set(policyId, address);
    this.record('create', policyId, call.txHash, now, address);
    return { policyId, contractAddress: address, txHash: call.txHash };
  }

  /** Call fund(amount) on a deployed policy contract. */
  async fundOnChain(
    policyId: Bytes32,
    amount: Dust,
    now: number,
  ): Promise<{ txHash: string }> {
    const stack = this.requireStack();
    const address = this.policyContracts.get(policyId);
    if (!address) {
      throw new PreprodUnavailableError('network', `no deployed policy for ${policyId}`);
    }
    const call = await stack.callCircuit('policy', {
      circuitId: 'fund',
      contractAddress: address,
      args: [amount],
      witnesses: {},
    });
    this.record('fund', policyId, call.txHash, now);
    return { txHash: call.txHash };
  }

  /** Call enroll(premium_paid) on a deployed policy contract. */
  async enrollOnChain(
    policyId: Bytes32,
    premium: Dust,
    now: number,
  ): Promise<{ txHash: string; commitment: Bytes32 }> {
    const stack = this.requireStack();
    const address = this.policyContracts.get(policyId);
    if (!address) {
      throw new PreprodUnavailableError('network', `no deployed policy for ${policyId}`);
    }
    const secret = this.holderSecretFor(policyId);
    const call = await stack.callCircuit('policy', {
      circuitId: 'enroll',
      contractAddress: address,
      args: [premium],
      // The holder secret is consumed by the circuit via this local
      // witness — never disclosed, never serialized (Invariant 2). The
      // witness returns [nextPrivateState, value]; our contracts are
      // witness-stateless, so the state slot is undefined.
      witnesses: {
        holder_secret: () => [undefined, hexToBytes(secret)],
      },
    });
    const commitment = bytesToHex32(call.result);
    this.record('enroll', policyId, call.txHash, now, address);
    return { txHash: call.txHash, commitment };
  }

  /** Call record_trigger(value1, value2, source1, source2) on-chain. */
  async recordTriggerOnChain(
    policyId: Bytes32,
    value1: number,
    value2: number,
    source1: Bytes32,
    source2: Bytes32,
    now: number,
  ): Promise<{ txHash: string }> {
    const stack = this.requireStack();
    const address = this.policyContracts.get(policyId);
    if (!address) {
      throw new PreprodUnavailableError('network', `no deployed policy for ${policyId}`);
    }
    const call = await stack.callCircuit('policy', {
      circuitId: 'record_trigger',
      contractAddress: address,
      // Readings and outcome are public — verifiable fairness of the
      // trigger (Invariant 5); no claimant data involved.
      args: [BigInt(value1), BigInt(value2), hexToBytes(source1), hexToBytes(source2)],
      witnesses: {},
    });
    this.record('record_trigger', policyId, call.txHash, now);
    return { txHash: call.txHash };
  }

  /**
   * Deploy a SettlementContract, call link() (public policy facts), then
   * settle() (private circuit). The ClaimWitness supplies every private
   * witness value — the holder secret and trigger evidence stay inside the
   * witness closures and are consumed in-process at circuit-execution time
   * (Invariant 2); the disclosed receipt carries only proof hash + status +
   * timestamp (Invariants 1/3).
   */
  async settleOnChain(
    policyId: Bytes32,
    now: number,
    witness: ClaimWitness,
  ): Promise<{ txHash: string; receiptId: Bytes32 }> {
    const stack = this.requireStack();
    const policyAddress = this.policyContracts.get(policyId);
    if (!policyAddress) {
      throw new PreprodUnavailableError('network', `no deployed policy for ${policyId}`);
    }
    const secret = this.holderSecretFor(policyId);
    if (witness.holderSecret !== secret) {
      throw new PreprodUnavailableError(
        'wallet',
        `settle witness secret does not match the enrolled secret for ${policyId}`,
      );
    }

    // link() mirrors the policy instance's public facts into the fresh
    // settlement instance — read straight from the policy ledger.
    const policyLedgerState = await stack.readLedger('policy', policyAddress);
    const linkArgs = [
      policyLedgerState['policy_id'],
      policyLedgerState['terms_digest_v'],
      policyLedgerState['enrollment_commitment'],
      policyLedgerState['payout'],
      policyLedgerState['start'],
      policyLedgerState['expiry'],
      policyLedgerState['trigger_fired'],
    ];

    const { address } = await stack.deployContract('settlement');
    await stack.callCircuit('settlement', {
      circuitId: 'link',
      contractAddress: address,
      args: linkArgs,
      witnesses: {},
    });

    // settle(): the nullifier is derived locally (nullifierOf — same domain
    // tag and field order as the in-circuit derive_nullifier_c) and
    // submitted as the public spent-registry key; the secret itself stays
    // in the witness closure. Readings are canonicalized digest-ascending
    // so the in-circuit witness digest hashes the same preimage as
    // witnessDigestOf (the compactParity pins).
    const evidence = witness.triggerEvidence;
    if (evidence.readings.length < 2) {
      throw new PreprodUnavailableError(
        'network',
        `settle witness needs >= 2 trigger readings, got ${evidence.readings.length}`,
      );
    }
    const [reading1, reading2] = [...evidence.readings]
      .sort((a, b) => {
        const da = readingDigestOf(a.sourceId, a.value);
        const db = readingDigestOf(b.sourceId, b.value);
        return da < db ? -1 : da > db ? 1 : 0;
      });
    const nullifier = nullifierOf(policyId, secret);
    const settleCall = await stack.callCircuit('settlement', {
      circuitId: 'settle',
      contractAddress: address,
      args: [BigInt(now), hexToBytes(nullifier)],
      witnesses: {
        holder_secret: () => [undefined, hexToBytes(secret)],
        claim_time: () => [undefined, BigInt(witness.claimTime)],
        observed_value: () => [undefined, BigInt(evidence.observedValue)],
        recorded_at: () => [undefined, BigInt(evidence.recordedAt)],
        reading1_source: () => [undefined, hexToBytes(reading1!.sourceId)],
        reading1_value: () => [undefined, BigInt(reading1!.value)],
        reading2_source: () => [undefined, hexToBytes(reading2!.sourceId)],
        reading2_value: () => [undefined, BigInt(reading2!.value)],
      },
    });
    const receiptId = bytesToHex32(settleCall.result);
    this.settlementContracts.set(policyId, address);
    this.record('settle', policyId, settleCall.txHash, now, address);
    return { txHash: settleCall.txHash, receiptId };
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
  /**
   * Mirrors the local reference runtime's policy nonce counter: both start
   * at 0 and increment once per create, so the on-chain create() derives
   * the same policyId. The parity check after create fails loudly if they
   * ever drift.
   */
  private createNonce = 0;
  private _mode: NetworkMode;
  private _status: PreprodStatus;

  constructor(
    onChainClient: PreprodOnChainClient,
    endpoints: PreprodStatus['endpoints'],
    config: ReturnType<typeof preprodConfigFromEnv>,
  ) {
    // Gate on the two hosted services the runtime cannot work without
    // (indexer reads, node submission). The prover is probed and reported
    // separately: Preprod has no hosted proof server, so a down prover must
    // not block the mode — proofs are generated client-side (Invariant 2),
    // and a local Docker proof server is only needed for contract proving.
    const walletStatus = onChainClient.getStatus();
    const walletConnected = walletStatus.connected;
    const allOk = endpoints.indexer && endpoints.node;
    this._mode = allOk ? (walletConnected ? 'preprod' : 'wallet-needed') : 'network-down';
    this._status = {
      mode: this._mode,
      label: allOk
        ? walletConnected
          ? config.networkLabel
          : `${config.networkLabel} — wallet required`
        : `${config.networkLabel} — network down`,
      walletConnected,
      walletAddress: walletStatus.address,
      balance: walletStatus.balance,
      error: allOk
        ? (walletConnected ? undefined : 'Connect a wallet (Lace extension or MIDNIGHT_WALLET_SEED)')
        : 'Preprod endpoints unreachable from this device',
      endpoints,
    };

    // The local reference runtime mirrors every on-chain write for the UI
    // and supplies the client-side proof primitives (submitClaim). The
    // on-chain client is the ALREADY-CONNECTED instance from
    // createPreprodRuntime — a fresh client would have no live stack.
    this.local = createLocalAsyncRuntime();
    this.privateLedger_ = new PrivateLedger();
    this.onChainClient_ = onChainClient;
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
      // Local mirror first: it validates the terms and assigns the
      // canonical policyId H("condition:policy:v1", insurer, nonce). The
      // on-chain create() must reproduce that exact id — the parity check
      // below fails loudly on any cross-layer divergence (the compactParity
      // pins are the offline guarantee; this is the live one).
      const policy = await this.local.policyService.create(insurer, terms, now);
      const nonce = this.createNonce++;
      const result = await this.onChainClient_.createPolicyOnChain(insurer, terms, now, nonce);
      if (result.policyId !== policy.policyId) {
        throw new PreprodUnavailableError(
          'network',
          `policy id divergence: on-chain ${result.policyId} vs local ${policy.policyId}`,
        );
      }
      return policy;
    },

    fund: async (policyId, amount, now) => {
      await this.onChainClient_.fundOnChain(policyId, amount, now);
      return this.local.policyService.fund(policyId, amount, now);
    },

    publishEnrollment: async (policyId, commitment, premium, now) => {
      // On-chain enroll() derives the commitment in-circuit from the
      // witnessed secret; the local claimService derived it with
      // enrollmentCommitmentOf. Identical preimages must produce identical
      // commitments — checked here, before either side is trusted.
      const result = await this.onChainClient_.enrollOnChain(policyId, premium, now);
      if (result.commitment !== commitment) {
        throw new PreprodUnavailableError(
          'network',
          `enrollment commitment divergence: on-chain ${result.commitment} vs local ${commitment}`,
        );
      }
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
      // The on-chain client keeps its own copy so the enroll/settle
      // circuits can consume it via the local witness provider.
      const result = await this.local.claimService.enroll(policyId, now);
      const secret = this.local.claimService.secretFor(policyId);
      this.privateLedger_.enroll(policyId, secret);
      this.onChainClient_.registerHolderSecret(policyId, secret);
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
      // Source registration is a local cache lookup (no circuit, no tx):
      // record_trigger verifies the submitted source digests against the
      // registered set, so both layers must register the same names.
      this.local.triggerService.registerSource(name);
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
      // On-chain settle is authoritative (public receipt, spent nullifier).
      // The ClaimWitness feeds the on-chain witnesses locally, in-process
      // (Invariant 2); the local mirror then replays the settlement so the
      // UI's private ledger and receipt list stay in lockstep — its receipt
      // id must equal the on-chain circuit's (live parity check).
      const witness = witnessProvider();
      const result = await this.onChainClient_.settleOnChain(policyId, now, witness);
      const localResult = await this.local.settlementService.settle(
        now, proof, policyId, witnessProvider,
      );
      if (result.receiptId !== localResult.receipt.receiptId) {
        throw new PreprodUnavailableError(
          'network',
          `receipt id divergence: on-chain ${result.receiptId} vs local ${localResult.receipt.receiptId}`,
        );
      }
      // Credit the runtime's private ledger (the one secretFor reads) —
      // per the AsyncClaimService contract, settlement credits internally
      // so callers never double-credit.
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
    // On-chain instance discovery is not wired yet (see docs/DEPLOYMENTS.md);
    // the deployed contract addresses are static config until then.
  }

  txHistory(): TxRecord[] {
    return this.onChainClient_.getTxHistory();
  }
}

// ---------------------------------------------------------------------------
// Factory: create the appropriate runtime based on environment
// ---------------------------------------------------------------------------

/** Source digest for record_trigger's on-chain source ids. */
function sourceIdFromName(name: string): Bytes32 {
  return sourceIdDigest(name);
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
  await client.connectWallet();

  // The runtime reuses THIS client (its live stack is the connected one).
  const runtime = new PreprodConditionRuntime(client, endpoints, config);

  return { runtime, status: runtime.status };
}
