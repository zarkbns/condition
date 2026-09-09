import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  holder_secret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  claim_time(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  observed_value(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  recorded_at(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  reading1_source(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reading1_value(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  reading2_source(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reading2_value(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  link(context: __compactRuntime.CircuitContext<PS>,
       policy_id_in_0: Uint8Array,
       terms_digest_in_0: Uint8Array,
       enrollment_commitment_in_0: Uint8Array,
       payout_in_0: bigint,
       start_in_0: bigint,
       expiry_in_0: bigint,
       trigger_fired_in_0: boolean,
       trigger_digest_in_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         now_0: bigint,
         submitted_nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  settled_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  denied_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type ProvableCircuits<PS> = {
  link(context: __compactRuntime.CircuitContext<PS>,
       policy_id_in_0: Uint8Array,
       terms_digest_in_0: Uint8Array,
       enrollment_commitment_in_0: Uint8Array,
       payout_in_0: bigint,
       start_in_0: bigint,
       expiry_in_0: bigint,
       trigger_fired_in_0: boolean,
       trigger_digest_in_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         now_0: bigint,
         submitted_nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  settled_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  denied_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  link(context: __compactRuntime.CircuitContext<PS>,
       policy_id_in_0: Uint8Array,
       terms_digest_in_0: Uint8Array,
       enrollment_commitment_in_0: Uint8Array,
       payout_in_0: bigint,
       start_in_0: bigint,
       expiry_in_0: bigint,
       trigger_fired_in_0: boolean,
       trigger_digest_in_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  settle(context: __compactRuntime.CircuitContext<PS>,
         now_0: bigint,
         submitted_nullifier_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  settled_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
  denied_total(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, bigint>;
}

export type Ledger = {
  readonly linked: boolean;
  readonly policy_id: Uint8Array;
  readonly terms_digest_v: Uint8Array;
  readonly enrollment_commitment: Uint8Array;
  readonly payout: bigint;
  readonly start: bigint;
  readonly expiry: bigint;
  readonly trigger_fired: boolean;
  readonly trigger_digest_v: Uint8Array;
  spent_nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly settled_count: bigint;
  readonly denied_count: bigint;
  readonly last_receipt_hash: Uint8Array;
  readonly last_status: boolean;
  readonly last_timestamp: bigint;
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
