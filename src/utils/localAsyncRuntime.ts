// LOCAL async runtime — wraps the synchronous reference runtime
// (createRuntime) behind the AsyncConditionRuntime interface.
//
// This is the dev/demo/offline path. Every operation resolves immediately
// against the in-memory ledgers (the executable spec). It exists so the
// pages can use ONE async interface regardless of which backing layer is
// active — local reference runtime or real Preprod contracts.
//
// publicLedger is exposed so the Preprod runtime (and tests) can reach the
// session's own capability secrets — the reference layer of the SAME
// credential set the on-chain witnesses consume.

import { createRuntime } from './midnight.js';
import type { PublicLedger } from '../core/publicLedger.js';
import type { AsyncConditionRuntime } from './asyncRuntime.js';
import type { ClaimProof, TriggerRecord, WitnessProvider } from '../types/index.js';
import type { Address, Bytes32, Dust, Policy, PolicyTerms, Receipt } from '../types/index.js';

export interface LocalAsyncRuntime extends AsyncConditionRuntime {
  /** The underlying reference public ledger (capabilities, audit view). */
  readonly publicLedger: PublicLedger;
}

export function createLocalAsyncRuntime(): LocalAsyncRuntime {
  const runtime = createRuntime({ appName: 'Condition' });

  const policyService: AsyncConditionRuntime['policyService'] = {
    create: async (insurer, terms, now) => runtime.policyService.create(insurer, terms, now),
    fund: async (policyId, amount, now) => runtime.policyService.fund(policyId, amount, now),
    publishEnrollment: async (policyId, commitment, premium, now) =>
      runtime.policyService.publishEnrollment(policyId, commitment, premium, now),
    getPolicy: async (policyId) => runtime.policyService.getPolicy(policyId),
    listPolicies: async () => runtime.policyService.listPolicies(),
  };

  const claimService: AsyncConditionRuntime['claimService'] = {
    enroll: async (policyId, now) => runtime.claimService.enroll(policyId, now),
    submitClaim: async (policyId, now) => runtime.claimService.submitClaim(policyId, now),
    receivePayout: async (policyId, amount, timestamp) =>
      runtime.claimService.receivePayout(policyId, amount, timestamp),
    secretFor: (policyId) => runtime.claimService.secretFor(policyId),
    hasEnrollment: (policyId) => runtime.claimService.hasEnrollment(policyId),
  };

  const triggerService: AsyncConditionRuntime['triggerService'] = {
    registerSource: async (name) => {
      runtime.triggerService.registerSource(name);
    },
    registerOracle: async (policyId, source, oracleSecret, now) => {
      runtime.triggerService.registerOracle(policyId, source, oracleSecret, now);
    },
    submitReadings: async (policyId, submissions, now) =>
      runtime.triggerService.submitReadings(policyId, submissions, now),
  };

  const settlementService: AsyncConditionRuntime['settlementService'] = {
    settle: async (now, proof, policyId, witnessProvider) => {
      const result = runtime.settlementService.settle(now, proof, policyId, witnessProvider);
      runtime.claimService.receivePayout(policyId, result.releasedAmount, result.receipt.timestamp);
      return result;
    },
    verifyReceipt: async (receiptId) => runtime.settlementService.verifyReceipt(receiptId),
    listReceipts: async () => runtime.publicLedger.listReceipts(),
  };

  return {
    policyService,
    claimService,
    triggerService,
    settlementService,
    publicLedger: runtime.publicLedger,
    capabilityFor: (policyId) => runtime.publicLedger.capabilityFor(policyId),
    refresh: async () => {
      // Local in-memory ledger — nothing to sync.
    },
    txHistory: () => [],
  };
}
