// Reference private ledger — the claimant's local state (BUILD_SPEC.md §3).
//
// Mirrors Midnight's private ledger from the holder's point of view: the
// holder secret (the only "identity" Condition ever has), shielded payout
// balances, and claim history. This object NEVER crosses into the public
// ledger; `toJSON` deliberately exposes balances only so accidental
// serialization in a public context cannot leak secrets (defense in depth —
// tests/privacy.test.ts verifies the public ledger never references this).

import type { Bytes32, Dust } from '../types/index.js';

export interface PrivateClaimRecord {
  policyId: Bytes32;
  amount: Dust;
  timestamp: number;
}

export class PrivateLedger {
  private readonly secrets = new Map<Bytes32, Bytes32>();
  private readonly balances = new Map<Bytes32, Dust>();
  private readonly claims: PrivateClaimRecord[] = [];

  enroll(policyId: Bytes32, holderSecret: Bytes32): void {
    if (this.secrets.has(policyId)) {
      throw new Error(`private ledger: already enrolled on ${policyId}`);
    }
    this.secrets.set(policyId, holderSecret);
  }

  secretFor(policyId: Bytes32): Bytes32 {
    const secret = this.secrets.get(policyId);
    if (!secret) {
      throw new Error(`private ledger: no enrollment for ${policyId}`);
    }
    return secret;
  }

  hasEnrollment(policyId: Bytes32): boolean {
    return this.secrets.has(policyId);
  }

  /** Credit a shielded payout. Amount is private state, never published. */
  credit(policyId: Bytes32, amount: Dust, timestamp: number): void {
    this.balances.set(policyId, (this.balances.get(policyId) ?? 0n) + amount);
    this.claims.push({ policyId, amount, timestamp });
  }

  balance(policyId: Bytes32): Dust {
    return this.balances.get(policyId) ?? 0n;
  }

  claimHistory(): PrivateClaimRecord[] {
    return [...this.claims];
  }

  /** Serializable view — balances only. Secrets are structurally excluded. */
  toJSON(): { balances: Record<string, string> } {
    const balances: Record<string, string> = {};
    for (const [policyId, amount] of this.balances) {
      balances[policyId] = amount.toString();
    }
    return { balances };
  }
}
