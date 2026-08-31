// Policy lifecycle service (BUILD_SPEC.md §4.1).
//
// Knows terms, escrow, and enrollment commitments. NEVER touches holder
// secrets — the commitment arrives precomputed from the claimant's client
// (claimService), preserving the service-level privacy boundary.

import { ErrorCode, ProtocolError } from '../types/index.js';
import type { Address, Bytes32, Dust, Policy, PolicyTerms } from '../types/index.js';
import type { PublicLedger } from '../core/publicLedger.js';

export class PolicyService {
  constructor(private readonly ledger: PublicLedger) {}

  create(insurer: Address, terms: PolicyTerms, now: number): Policy {
    return this.ledger.createPolicy(insurer, terms, now);
  }

  fund(policyId: Bytes32, amount: Dust, now: number): Policy {
    return this.ledger.fund(policyId, amount, now);
  }

  /** Publishes an enrollment commitment computed client-side. Premium is escrowed. */
  publishEnrollment(
    policyId: Bytes32,
    commitment: Bytes32,
    premium: Dust,
    now: number,
  ): Policy {
    return this.ledger.enrollHolder(policyId, commitment, premium, now);
  }

  /** Lazy expiry: flips the policy to EXPIRED if past its window. */
  expire(policyId: Bytes32, now: number): Policy {
    const policy = this.ledger.refreshExpiry(policyId, now);
    if (policy.status !== 'EXPIRED') {
      throw new ProtocolError(ErrorCode.EXPIRY_REQUIRED, 'not yet expired');
    }
    return policy;
  }

  /** Insurer withdraws the unclaimed escrow remainder after settlement/expiry. */
  withdraw(policyId: Bytes32, now: number): { refunded: Dust; policy: Policy } {
    return this.ledger.withdraw(policyId, now);
  }

  getPolicy(policyId: Bytes32): Policy {
    return this.ledger.getPolicy(policyId);
  }

  listPolicies(): Policy[] {
    return this.ledger.listPolicies();
  }
}
