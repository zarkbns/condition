// Deterministic payout function — the heart of parametric fairness
// (BUILD_SPEC.md §5.1 rule 3). This exact function is mirrored by the
// `expected_payout` pure circuit in contracts/proofs.compact and
// contracts/policy.compact, and recomputed by the settlement flow from PUBLIC
// terms only. Nobody — not even the claimant — can choose the amount.

import type { Dust, PolicyTerms } from '../types/index.js';

/**
 * amount = (outcome ∧ inWindow) ? payoutAmount : 0
 * where inWindow = coverageStart ≤ now ≤ expiry.
 */
export function expectedPayout(terms: PolicyTerms, triggerOutcome: boolean, now: number): Dust {
  const inWindow = now >= terms.coverageStart && now <= terms.expiry;
  return triggerOutcome && inWindow ? terms.payoutAmount : 0n;
}

/** True when `now` falls inside the coverage window. */
export function inCoverageWindow(terms: PolicyTerms, now: number): boolean {
  return now >= terms.coverageStart && now <= terms.expiry;
}
