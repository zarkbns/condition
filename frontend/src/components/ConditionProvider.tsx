'use client';

// The entire protocol runtime lives in the browser (BUILD_SPEC §10).
//
// There are ZERO API routes by design: every service call — including ZK
// proof generation, which consumes the holder secret — executes client-side
// (Invariant 2). The holder secret is generated at enrollment, kept in
// memory only, and never persisted (no localStorage, no cookies).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createRuntime, type ConditionRuntime } from '../../../src/utils/midnight';
import { randomAddress } from '../../../src/core/hashing';
import type { Policy, ProtocolEvent, Receipt } from '../../../src/types';

interface ConditionContextValue {
  runtime: ConditionRuntime;
  /** Session identity (reference-runtime account id). */
  insurer: string;
  policies: Policy[];
  receipts: Receipt[];
  events: ProtocolEvent[];
  /** Re-reads the reference runtime's public state. */
  refresh: () => void;
  /** Subscribe to public-state changes (simple observer; optional). */
}

const ConditionContext = createContext<ConditionContextValue | null>(null);

export function ConditionProvider({ children }: { children: ReactNode }) {
  // useMemo with no deps: one runtime per browser session. State lives in
  // memory; a page reload starts a fresh reference-ledger session (the
  // deployed path swaps this for midnight-js against a real network).
  const runtime = useMemo(() => createRuntime({ appName: 'Condition' }), []);
  const insurer = useMemo(() => randomAddress(), []);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [events, setEvents] = useState<ProtocolEvent[]>([]);

  const refresh = useCallback(() => {
    setPolicies(runtime.publicLedger.listPolicies());
    setReceipts(runtime.publicLedger.listReceipts());
    setEvents(runtime.publicLedger.listEvents());
  }, [runtime]);

  const value = useMemo<ConditionContextValue>(
    () => ({ runtime, insurer, policies, receipts, events, refresh }),
    [runtime, insurer, policies, receipts, events, refresh],
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
