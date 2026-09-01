// Async protocol runtime interface (BUILD_SPEC.md §3.1).
//
// The frontend consumes ONE interface that both backing implementations
// conform to:
//
//   1. LOCAL — wraps the synchronous reference runtime (createRuntime).
//      Every method resolves immediately; this is the dev/demo/offline path
//      and the executable spec.
//   2. PREPROD — backed by real Midnight testnet contracts via the
//      Midnight.js SDK. Every method submits a transaction and awaits chain
//      confirmation (create → fund → enroll → record_trigger → settle).
//
// Making the interface async is what lets the pages talk to real on-chain
// contracts "instead of the local TypeScript runtime": on-chain interactions
// are inherently asynchronous. Holder secrets STILL never cross the wire
// (Invariant 2) — witness values arrive via local WitnessProviders in both
// modes.

import type { Policy, PolicyTerms, Receipt, ClaimProof, TriggerRecord, WitnessProvider } from '../types/index.js';
import type { Address, Bytes32, Dust } from '../types/index.js';

export interface AsyncPolicyService {
  create(insurer: Address, terms: PolicyTerms, now: number): Promise<Policy>;
  fund(policyId: Bytes32, amount: Dust, now: number): Promise<Policy>;
  publishEnrollment(policyId: Bytes32, commitment: Bytes32, premium: Dust, now: number): Promise<Policy>;
  getPolicy(policyId: Bytes32): Promise<Policy>;
  listPolicies(): Promise<Policy[]>;
}

export interface AsyncClaimService {
  /** Generates the holder secret locally, publishes only the commitment. */
  enroll(policyId: Bytes32, now: number): Promise<{ commitment: Bytes32; policy: Policy }>;
  /** Client-side proof generation (Invariant 2) — synchronous in the prover. */
  submitClaim(policyId: Bytes32, now: number): Promise<ClaimProof>;
  receivePayout(policyId: Bytes32, amount: Dust, timestamp: number): Promise<void>;
  secretFor(policyId: Bytes32): Bytes32;
  hasEnrollment(policyId: Bytes32): boolean;
}

export interface AsyncTriggerService {
  registerSource(name: string): Promise<void>;
  submitReadings(
    policyId: Bytes32,
    readings: Array<{ source: string; value: number }>,
    now: number,
  ): Promise<TriggerRecord>;
}

export interface AsyncSettlementService {
  settle(
    now: number,
    proof: ClaimProof,
    policyId: Bytes32,
    witnessProvider: WitnessProvider,
  ): Promise<{ receipt: Receipt; releasedAmount: Dust; txHash?: string }>;
  verifyReceipt(receiptId: Bytes32): Promise<{ valid: boolean; receipt?: Receipt }>;
  listReceipts(): Promise<Receipt[]>;
}

/**
 * A recorded on-chain transaction. Populated by the Preprod runtime for
 * every circuit call (create / fund / enroll / record_trigger / settle) so
 * the UI can show real Preprod tx hashes and confirmation status. The local
 * reference runtime records nothing here (no chain to submit to).
 */
export interface TxRecord {
  action: 'create' | 'fund' | 'enroll' | 'record_trigger' | 'settle';
  policyId: Bytes32;
  /** Midnight transaction hash when submitted on-chain. */
  txHash?: string;
  /** Deployed contract address (policy/settlement instance). */
  contractAddress?: string;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
  timestamp: number;
}

export interface AsyncConditionRuntime {
  policyService: AsyncPolicyService;
  claimService: AsyncClaimService;
  triggerService: AsyncTriggerService;
  settlementService: AsyncSettlementService;
  /** Re-read public state (indexer or local ledger). */
  refresh(): Promise<void>;
  /**
   * On-chain transaction history for this session. Always an array; empty
   * for the local reference runtime. The UI renders these as real Preprod
   * tx hashes with status.
   */
  txHistory(): TxRecord[];
}
