import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
}

export type ProvableCircuits<PS> = {
}

export type PureCircuits = {
  scalar_bytes32(n_0: bigint): Uint8Array;
  bool_bytes32(b_0: boolean): Uint8Array;
  terms_digest(policy_id_0: Uint8Array,
               trigger_type_0: bigint,
               operator_0: bigint,
               threshold_0: bigint,
               payout_0: bigint,
               premium_0: bigint,
               start_0: bigint,
               expiry_0: bigint): Uint8Array;
  derive_eligibility(secret_0: Uint8Array, policy_id_0: Uint8Array): Uint8Array;
  derive_nullifier(secret_0: Uint8Array, policy_id_0: Uint8Array): Uint8Array;
  payout_commitment(amount_0: bigint): Uint8Array;
  expected_payout(trigger_fired_0: boolean,
                  in_window_0: boolean,
                  payout_0: bigint): bigint;
  in_window(start_0: bigint, expiry_0: bigint, now_0: bigint): boolean;
  receipt_digest(policy_id_0: Uint8Array,
                 proof_hash_0: Uint8Array,
                 trigger_outcome_0: boolean,
                 settled_0: boolean,
                 timestamp_0: bigint): Uint8Array;
  statement_digest(policy_id_0: Uint8Array,
                   terms_digest_v_0: Uint8Array,
                   nullifier_0: Uint8Array,
                   trigger_outcome_0: boolean,
                   payout_commitment_v_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  scalar_bytes32(context: __compactRuntime.CircuitContext<PS>, n_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  bool_bytes32(context: __compactRuntime.CircuitContext<PS>, b_0: boolean): __compactRuntime.CircuitResults<PS, Uint8Array>;
  terms_digest(context: __compactRuntime.CircuitContext<PS>,
               policy_id_0: Uint8Array,
               trigger_type_0: bigint,
               operator_0: bigint,
               threshold_0: bigint,
               payout_0: bigint,
               premium_0: bigint,
               start_0: bigint,
               expiry_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  derive_eligibility(context: __compactRuntime.CircuitContext<PS>,
                     secret_0: Uint8Array,
                     policy_id_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  derive_nullifier(context: __compactRuntime.CircuitContext<PS>,
                   secret_0: Uint8Array,
                   policy_id_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  payout_commitment(context: __compactRuntime.CircuitContext<PS>,
                    amount_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  expected_payout(context: __compactRuntime.CircuitContext<PS>,
                  trigger_fired_0: boolean,
                  in_window_0: boolean,
                  payout_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  in_window(context: __compactRuntime.CircuitContext<PS>,
            start_0: bigint,
            expiry_0: bigint,
            now_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  receipt_digest(context: __compactRuntime.CircuitContext<PS>,
                 policy_id_0: Uint8Array,
                 proof_hash_0: Uint8Array,
                 trigger_outcome_0: boolean,
                 settled_0: boolean,
                 timestamp_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  statement_digest(context: __compactRuntime.CircuitContext<PS>,
                   policy_id_0: Uint8Array,
                   terms_digest_v_0: Uint8Array,
                   nullifier_0: Uint8Array,
                   trigger_outcome_0: boolean,
                   payout_commitment_v_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
