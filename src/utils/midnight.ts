// Runtime context factory (BUILD_SPEC.md §3.1 "Midnight context").
//
// Builds the protocol stack for a given runtime. The browser/dev context is
// the reference runtime: everything runs locally, proof generation happens
// client-side, and the public/private ledger split is enforced in-process.
// A network context (Midnight testnet via midnight-js) plugs in through the
// same service interfaces — the services are wallet/network-agnostic on
// purpose (docs/MIDNIGHT_NOTES.md §3).

import { PublicLedger } from '../core/publicLedger.js';
import { PrivateLedger } from '../core/privateLedger.js';
import { PolicyService } from '../services/policyService.js';
import { TriggerService } from '../services/triggerService.js';
import { ClaimService } from '../services/claimService.js';
import { SettlementService } from '../services/settlementService.js';

export interface ConditionRuntime {
  publicLedger: PublicLedger;
  privateLedger: PrivateLedger;
  policyService: PolicyService;
  triggerService: TriggerService;
  claimService: ClaimService;
  settlementService: SettlementService;
}

export function createRuntime(_config?: unknown): ConditionRuntime {
  // In the reference runtime the config is intentionally unused beyond
  // documentation: there is no server hop, and the reference runtime never
  // contacts a node. A network-backed context replaces the ledger
  // implementations, not this wiring.
  const publicLedger = new PublicLedger();
  const privateLedger = new PrivateLedger();
  const policyService = new PolicyService(publicLedger);
  const triggerService = new TriggerService(publicLedger);
  const claimService = new ClaimService(publicLedger, privateLedger);
  const settlementService = new SettlementService(publicLedger);
  return {
    publicLedger,
    privateLedger,
    policyService,
    triggerService,
    claimService,
    settlementService,
  };
}
