import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum TriggerType { temperature = 0,
                          rainfall_mm = 1,
                          flight_delay_min = 2,
                          earthquake_mag = 3
}

export enum ComparisonOp { gt = 0, gte = 1, lt = 2, lte = 3, eq = 4 }

export enum PolicyStatus { active = 0,
                           triggered = 1,
                           settling = 2,
                           settled = 3,
                           denied = 4,
                           expired = 5,
                           closed = 6
}

export type Witnesses<PS> = {
  holder_secret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  insurer_secret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  oracle_secret1(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  oracle_secret2(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  settlement_secret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  create(context: __compactRuntime.CircuitContext<PS>,
         insurer_0: Uint8Array,
         trigger_type_v_0: TriggerType,
         op_v_0: ComparisonOp,
         threshold_v_0: bigint,
         payout_v_0: bigint,
         premium_v_0: bigint,
         start_v_0: bigint,
         expiry_v_0: bigint,
         now_0: bigint,
         nonce_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fund(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enroll(context: __compactRuntime.CircuitContext<PS>, premium_paid_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  register_oracle1(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  register_oracle2(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  record_trigger(context: __compactRuntime.CircuitContext<PS>,
                 value1_0: bigint,
                 value2_0: bigint,
                 source1_0: Uint8Array,
                 source2_0: Uint8Array,
                 recorded_at_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  authorize_settlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_settled(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_denied(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expire(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type ProvableCircuits<PS> = {
  create(context: __compactRuntime.CircuitContext<PS>,
         insurer_0: Uint8Array,
         trigger_type_v_0: TriggerType,
         op_v_0: ComparisonOp,
         threshold_v_0: bigint,
         payout_v_0: bigint,
         premium_v_0: bigint,
         start_v_0: bigint,
         expiry_v_0: bigint,
         now_0: bigint,
         nonce_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fund(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enroll(context: __compactRuntime.CircuitContext<PS>, premium_paid_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  register_oracle1(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  register_oracle2(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  record_trigger(context: __compactRuntime.CircuitContext<PS>,
                 value1_0: bigint,
                 value2_0: bigint,
                 source1_0: Uint8Array,
                 source2_0: Uint8Array,
                 recorded_at_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  authorize_settlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_settled(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_denied(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expire(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type PureCircuits = {
  expected_payout(trigger_fired_v_0: boolean,
                  in_window_v_0: boolean,
                  payout_v_0: bigint): bigint;
  in_window(start_v_0: bigint, expiry_v_0: bigint, now_0: bigint): boolean;
  nullifier_for(secret_0: Uint8Array, policy_id_v_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  expected_payout(context: __compactRuntime.CircuitContext<PS>,
                  trigger_fired_v_0: boolean,
                  in_window_v_0: boolean,
                  payout_v_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  in_window(context: __compactRuntime.CircuitContext<PS>,
            start_v_0: bigint,
            expiry_v_0: bigint,
            now_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  create(context: __compactRuntime.CircuitContext<PS>,
         insurer_0: Uint8Array,
         trigger_type_v_0: TriggerType,
         op_v_0: ComparisonOp,
         threshold_v_0: bigint,
         payout_v_0: bigint,
         premium_v_0: bigint,
         start_v_0: bigint,
         expiry_v_0: bigint,
         now_0: bigint,
         nonce_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  fund(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  enroll(context: __compactRuntime.CircuitContext<PS>, premium_paid_0: bigint): __compactRuntime.CircuitResults<PS, Uint8Array>;
  register_oracle1(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  register_oracle2(context: __compactRuntime.CircuitContext<PS>,
                   source_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  record_trigger(context: __compactRuntime.CircuitContext<PS>,
                 value1_0: bigint,
                 value2_0: bigint,
                 source1_0: Uint8Array,
                 source2_0: Uint8Array,
                 recorded_at_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  authorize_settlement(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_settled(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  mark_denied(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, []>;
  expire(context: __compactRuntime.CircuitContext<PS>, now_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  withdraw(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  nullifier_for(context: __compactRuntime.CircuitContext<PS>,
                secret_0: Uint8Array,
                policy_id_v_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
}

export type Ledger = {
  readonly created: boolean;
  readonly insurer_key: Uint8Array;
  readonly insurer_auth: Uint8Array;
  readonly terms_digest_v: Uint8Array;
  readonly trigger_type: TriggerType;
  readonly op: ComparisonOp;
  readonly threshold: bigint;
  readonly payout: bigint;
  readonly premium: bigint;
  readonly start: bigint;
  readonly expiry: bigint;
  readonly funded: bigint;
  readonly enrollment_commitment: Uint8Array;
  readonly enrolled: boolean;
  oracle_registry: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly oracle_count: bigint;
  readonly settle_auth_commit: Uint8Array;
  readonly trigger_fired: boolean;
  readonly trigger_recorded: boolean;
  readonly trigger_value: bigint;
  readonly trigger_source1: Uint8Array;
  readonly trigger_source2: Uint8Array;
  readonly trigger_digest_v: Uint8Array;
  readonly status: PolicyStatus;
  readonly created_at: bigint;
  readonly policy_id: Uint8Array;
  readonly policy_nonce: bigint;
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
