// Loader for the compiled Compact contract modules (ledger decoder, Contract
// class, pure circuits, compact enums).
//
// Two copies of the same compiler output exist:
//   - contracts/managed/<name>/contract — gitignored LOCAL build output
//     (npm run build:contracts), absent from a fresh clone or a Vercel
//     checkout;
//   - contracts/managed-compact/<name>/contract — the committed copies
//     (see that directory's README), always present.
//
// This module resolves ONLY the committed copies: the dynamic import below
// is a webpack context module over committed files, so `next build` succeeds
// in any checkout and the decoder ships as a lazy chunk (the onchain-runtime
// wasm stays off routes that never decode state). contracts/managed stays
// optional local build output — it is never statically imported anywhere, so
// no build step and no webpack alias depends on a local compile. Node-side
// consumers that want a freshly compiled module first (demo, parity tests,
// deployer) resolve contracts/managed themselves at runtime.
//
// The committed modules are public by construction — compiler output of the
// committed public .compact sources, no witness data, no secrets — and each
// checks its exact @midnight-ntwrk/compact-runtime version on import, so a
// stale committed copy cannot silently mismatch the runtime dependency.

import type * as PolicyMod from '../../contracts/managed-compact/policy/contract/index.js';
import type * as SettlementMod from '../../contracts/managed-compact/settlement/contract/index.js';
import type * as ProofsMod from '../../contracts/managed-compact/proofs/contract/index.js';

export type PolicyModule = typeof PolicyMod;
export type SettlementModule = typeof SettlementMod;
export type ProofsModule = typeof ProofsMod;

export type ManagedContractName = 'policy' | 'settlement' | 'proofs';

/** The compiled ledger decoder, read loosely by the public-state surfaces. */
export type LedgerDecoder = (state: unknown) => Record<string, unknown>;

/**
 * Map each contract name to its committed compiled module. A mapped type
 * (not overload signatures) so call sites with union arguments like
 * 'policy' | 'settlement' distribute correctly.
 */
type ManagedModules = {
  policy: PolicyModule;
  settlement: SettlementModule;
  proofs: ProofsModule;
};

export async function loadManagedContractModule<N extends ManagedContractName>(
  name: N,
): Promise<ManagedModules[N]> {
  const mod = (await import(
    `../../contracts/managed-compact/${name}/contract/index.js`
  )) as { default?: unknown } & Record<string, unknown>;
  // vitest's transform graph can re-wrap the ESM namespace depending on
  // import order across suites; normalize both shapes.
  return mod.default as ManagedModules[N] ?? (mod as ManagedModules[N]);
}

/** Loose ledger decoder for the public-state surfaces (no typed reads). */
export async function loadManagedLedgerDecoder(
  name: 'policy' | 'settlement',
): Promise<LedgerDecoder> {
  const mod = (await loadManagedContractModule(name)) as unknown as { ledger: LedgerDecoder };
  return mod.ledger;
}
