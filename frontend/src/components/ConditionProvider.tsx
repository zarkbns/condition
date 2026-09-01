'use client';

// The protocol runtime lives in the browser (BUILD_SPEC §10). This provider
// runs a CONNECTION STATE MACHINE — it NEVER silently falls back to the local
// simulation:
//
//   connecting → preprod        (network + wallet OK, real contracts)
//             → wallet-needed   (network OK, but no Lace/seed wallet — warn)
//             → network-down    (Preprod endpoints unreachable — warn)
//
//   switchToLocal() is an EXPLICIT dev-mode opt-in (labeled LOCAL DEV in the
//   UI), never an automatic fallback. Every non-local state surfaces a clear
//   warning and a Connect Wallet / Retry action.
//
// There are ZERO API routes by design: every service call — including ZK
// proof generation, which consumes the holder secret — executes client-side
// (Invariant 2). The holder secret is generated at enrollment, kept in
// memory only, and never persisted (no localStorage, no cookies).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createLocalAsyncRuntime } from '../../../src/utils/localAsyncRuntime';
import { preprodConfigFromEnv } from '../../../src/utils/preprodRuntime';
import type { AsyncConditionRuntime, TxRecord } from '../../../src/utils/asyncRuntime';
import type { PreprodStatus, NetworkMode } from '../../../src/utils/preprodRuntime';
import { randomAddress } from '../../../src/core/hashing';
import type { Policy, ProtocolEvent, Receipt } from '../../../src/types';

interface ConditionContextValue {
  /** Active runtime. Null when Preprod is unavailable (show warning + action). */
  runtime: AsyncConditionRuntime | null;
  /** Network mode + wallet status for the NetworkBadge and page warnings. */
  status: PreprodStatus;
  /** True when a wallet is connected (Preprod ready to transact). */
  connected: boolean;
  /** Session identity (dev account id). */
  insurer: string;
  policies: Policy[];
  receipts: Receipt[];
  /** Real on-chain transaction history (create/fund/enroll/trigger/settle). */
  txHistory: TxRecord[];
  /** Re-reads public state from the active backing store. */
  refresh: () => Promise<void>;
  /** Connect the wallet (Lace extension or MIDNIGHT_WALLET_SEED) and retry. */
  connectWallet: () => Promise<void>;
  /** Re-probe the Preprod endpoints. */
  retry: () => Promise<void>;
  /** Explicit dev-mode opt-in: run the local reference runtime. */
  switchToLocal: () => void;
}

const ConditionContext = createContext<ConditionContextValue | null>(null);

/** True when running under Vitest (network probe is skipped for determinism). */
function isTestEnv(): boolean {
  return typeof process !== 'undefined' && Boolean(process.env['VITEST']);
}

function initialStatus(): PreprodStatus {
  return {
    mode: 'connecting',
    label: 'Connecting to Preprod…',
    walletConnected: false,
    walletAddress: '',
    balance: null,
    endpoints: { indexer: false, prover: false, node: false },
  };
}

export function ConditionProvider({ children }: { children: ReactNode }) {
  const [runtime, setRuntime] = useState<AsyncConditionRuntime | null>(null);
  const [status, setStatus] = useState<PreprodStatus>(initialStatus);
  const [txHistory, setTxHistory] = useState<TxRecord[]>([]);

  const insurer = useMemo(() => randomAddress(), []);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const doRefresh = useCallback(async () => {
    const r = runtimeRef.current;
    if (!r) return;
    const [p, rc, tx] = await Promise.all([
      r.policyService.listPolicies(),
      r.settlementService.listReceipts(),
      Promise.resolve(r.txHistory()),
    ]);
    setPolicies(p);
    setReceipts(rc);
    setTxHistory(tx);
  }, []);

  const refresh = useCallback(async () => {
    await doRefresh();
  }, [doRefresh]);

  // Build the Preprod runtime: probe endpoints, connect wallet, wire services.
  const connect = useCallback(async () => {
    setStatus((s) => ({ ...s, mode: 'connecting', label: 'Connecting to Preprod…' }));
    const config = preprodConfigFromEnv(
      typeof process !== 'undefined' ? process.env : {},
    );
    const { createPreprodRuntime } = await import('../../../src/utils/preprodRuntime');
    const { runtime: preprod, status: preprodStatus } = await createPreprodRuntime(config);
    runtimeRef.current = preprod;
    setRuntime(preprod);
    setStatus(preprodStatus);
    await doRefresh();
  }, [doRefresh]);

  // Retry = re-probe endpoints and rebuild the Preprod runtime.
  const retry = useCallback(async () => {
    await connect();
  }, [connect]);

  // Explicit dev-mode opt-in — the ONLY way to use the local reference
  // runtime from the UI. Never automatic.
  const switchToLocal = useCallback(() => {
    const local = createLocalAsyncRuntime();
    runtimeRef.current = local;
    setRuntime(local);
    setStatus({
      mode: 'local',
      label: 'LOCAL DEV — reference runtime (not on-chain)',
      walletConnected: false,
      walletAddress: '',
      balance: null,
      endpoints: { indexer: false, prover: false, node: false },
    });
    void doRefresh();
  }, [doRefresh]);

  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;

  useEffect(() => {
    if (isTestEnv()) {
      // Tests exercise the local runtime deterministically.
      switchToLocal();
      return;
    }
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connected = status.mode === 'preprod';

  const value = useMemo<ConditionContextValue>(
    () => ({
      runtime,
      status,
      connected,
      insurer,
      policies,
      receipts,
      txHistory,
      refresh,
      connectWallet: connect,
      retry,
      switchToLocal,
    }),
    [runtime, status, connected, insurer, policies, receipts, txHistory, refresh, connect, retry, switchToLocal],
  );

  return <ConditionContext.Provider value={value}>{children}</ConditionContext.Provider>;
}

export function useCondition(): ConditionContextValue {
  const ctx = useContext(ConditionContext);
  if (!ctx) {
    throw new Error('useCondition must be used inside <ConditionProvider>');
  }
  return ctx;
}

export type { NetworkMode };