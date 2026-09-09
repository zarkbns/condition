import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.15.0');

const _descriptor_0 = new __compactRuntime.CompactTypeBytes(32);

const _descriptor_1 = __compactRuntime.CompactTypeBoolean;

const _descriptor_2 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_3 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_4 = new __compactRuntime.CompactTypeVector(2, _descriptor_0);

const _descriptor_5 = new __compactRuntime.CompactTypeVector(6, _descriptor_0);

const _descriptor_6 = new __compactRuntime.CompactTypeVector(9, _descriptor_0);

const _descriptor_7 = new __compactRuntime.CompactTypeVector(3, _descriptor_0);

class _Either_0 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_0.alignment().concat(_descriptor_0.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_1.fromValue(value_0),
      left: _descriptor_0.fromValue(value_0),
      right: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.is_left).concat(_descriptor_0.toValue(value_0.left).concat(_descriptor_0.toValue(value_0.right)));
  }
}

const _descriptor_8 = new _Either_0();

const _descriptor_9 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_0.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_0.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.bytes);
  }
}

const _descriptor_10 = new _ContractAddress_0();

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      scalar_bytes32(context, ...args_1) {
        return { result: pureCircuits.scalar_bytes32(...args_1), context };
      },
      bool_bytes32(context, ...args_1) {
        return { result: pureCircuits.bool_bytes32(...args_1), context };
      },
      terms_digest(context, ...args_1) {
        return { result: pureCircuits.terms_digest(...args_1), context };
      },
      derive_eligibility(context, ...args_1) {
        return { result: pureCircuits.derive_eligibility(...args_1), context };
      },
      derive_nullifier(context, ...args_1) {
        return { result: pureCircuits.derive_nullifier(...args_1), context };
      },
      payout_commitment(context, ...args_1) {
        return { result: pureCircuits.payout_commitment(...args_1), context };
      },
      expected_payout(context, ...args_1) {
        return { result: pureCircuits.expected_payout(...args_1), context };
      },
      in_window(context, ...args_1) {
        return { result: pureCircuits.in_window(...args_1), context };
      },
      receipt_digest(context, ...args_1) {
        return { result: pureCircuits.receipt_digest(...args_1), context };
      },
      statement_digest(context, ...args_1) {
        return { result: pureCircuits.statement_digest(...args_1), context };
      }
    };
    this.impureCircuits = {};
    this.provableCircuits = {};
  }
  initialState(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    const context = __compactRuntime.createCircuitContext(__compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    state_0.data = new __compactRuntime.ChargedState(context.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.currentPrivateState,
      currentZswapLocalState: context.currentZswapLocalState
    }
  }
  _persistentHash_0(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_6, value_0);
    return result_0;
  }
  _persistentHash_1(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_7, value_0);
    return result_0;
  }
  _persistentHash_2(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_4, value_0);
    return result_0;
  }
  _persistentHash_3(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_5, value_0);
    return result_0;
  }
  _scalar_bytes32_0(n_0) {
    return __compactRuntime.convertFieldToBytes(32,
                                                n_0,
                                                'proofs.compact line 30 char 10');
  }
  _bool_bytes32_0(b_0) {
    if (b_0) {
      return __compactRuntime.convertFieldToBytes(32,
                                                  1n,
                                                  'proofs.compact line 35 char 12');
    } else {
      return __compactRuntime.convertFieldToBytes(32,
                                                  0n,
                                                  'proofs.compact line 37 char 12');
    }
  }
  _terms_digest_0(policy_id_0,
                  trigger_type_0,
                  operator_0,
                  threshold_0,
                  payout_0,
                  premium_0,
                  start_0,
                  expiry_0)
  {
    return this._persistentHash_0([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 116, 101, 114, 109, 115, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   policy_id_0,
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        trigger_type_0,
                                                                        'proofs.compact line 58 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        operator_0,
                                                                        'proofs.compact line 59 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        threshold_0,
                                                                        'proofs.compact line 60 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        payout_0,
                                                                        'proofs.compact line 61 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        premium_0,
                                                                        'proofs.compact line 62 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        start_0,
                                                                        'proofs.compact line 63 char 5'),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        expiry_0,
                                                                        'proofs.compact line 64 char 5')]);
  }
  _derive_eligibility_0(secret_0, policy_id_0) {
    return this._persistentHash_1([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 101, 108, 105, 103, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   policy_id_0,
                                   secret_0]);
  }
  _derive_nullifier_0(secret_0, policy_id_0) {
    return this._persistentHash_1([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 110, 117, 108, 108, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   policy_id_0,
                                   secret_0]);
  }
  _payout_commitment_0(amount_0) {
    return this._persistentHash_2([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 97, 109, 111, 117, 110, 116, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   __compactRuntime.convertFieldToBytes(32,
                                                                        amount_0,
                                                                        'proofs.compact line 94 char 5')]);
  }
  _expected_payout_0(trigger_fired_0, in_window_0, payout_0) {
    if (trigger_fired_0 && in_window_0) { return payout_0; } else { return 0n; }
  }
  _in_window_0(start_0, expiry_0, now_0) {
    return start_0 <= now_0 && now_0 <= expiry_0;
  }
  _receipt_digest_0(policy_id_0,
                    proof_hash_0,
                    trigger_outcome_0,
                    settled_0,
                    timestamp_0)
  {
    return this._persistentHash_3([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 114, 101, 99, 101, 105, 112, 116, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   policy_id_0,
                                   proof_hash_0,
                                   this._bool_bytes32_0(trigger_outcome_0),
                                   this._bool_bytes32_0(settled_0),
                                   this._scalar_bytes32_0(timestamp_0)]);
  }
  _statement_digest_0(policy_id_0,
                      terms_digest_v_0,
                      nullifier_0,
                      trigger_outcome_0,
                      payout_commitment_v_0)
  {
    return this._persistentHash_3([new Uint8Array([99, 111, 110, 100, 105, 116, 105, 111, 110, 58, 115, 116, 109, 116, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   policy_id_0,
                                   terms_digest_v_0,
                                   nullifier_0,
                                   this._bool_bytes32_0(trigger_outcome_0),
                                   payout_commitment_v_0]);
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()),
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
  };
}
const _emptyContext = {
  currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress())
};
const _dummyContract = new Contract({ });
export const pureCircuits = {
  scalar_bytes32: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`scalar_bytes32: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const n_0 = args_0[0];
    if (!(typeof(n_0) === 'bigint' && n_0 >= 0n && n_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('scalar_bytes32',
                                 'argument 1',
                                 'proofs.compact line 29 char 1',
                                 'Uint<0..18446744073709551616>',
                                 n_0)
    }
    return _dummyContract._scalar_bytes32_0(n_0);
  },
  bool_bytes32: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`bool_bytes32: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const b_0 = args_0[0];
    if (!(typeof(b_0) === 'boolean')) {
      __compactRuntime.typeError('bool_bytes32',
                                 'argument 1',
                                 'proofs.compact line 33 char 1',
                                 'Boolean',
                                 b_0)
    }
    return _dummyContract._bool_bytes32_0(b_0);
  },
  terms_digest: (...args_0) => {
    if (args_0.length !== 8) {
      throw new __compactRuntime.CompactError(`terms_digest: expected 8 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const policy_id_0 = args_0[0];
    const trigger_type_0 = args_0[1];
    const operator_0 = args_0[2];
    const threshold_0 = args_0[3];
    const payout_0 = args_0[4];
    const premium_0 = args_0[5];
    const start_0 = args_0[6];
    const expiry_0 = args_0[7];
    if (!(policy_id_0.buffer instanceof ArrayBuffer && policy_id_0.BYTES_PER_ELEMENT === 1 && policy_id_0.length === 32)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 1',
                                 'proofs.compact line 45 char 1',
                                 'Bytes<32>',
                                 policy_id_0)
    }
    if (!(typeof(trigger_type_0) === 'bigint' && trigger_type_0 >= 0n && trigger_type_0 <= 255n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 2',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..256>',
                                 trigger_type_0)
    }
    if (!(typeof(operator_0) === 'bigint' && operator_0 >= 0n && operator_0 <= 255n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 3',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..256>',
                                 operator_0)
    }
    if (!(typeof(threshold_0) === 'bigint' && threshold_0 >= 0n && threshold_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 4',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..18446744073709551616>',
                                 threshold_0)
    }
    if (!(typeof(payout_0) === 'bigint' && payout_0 >= 0n && payout_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 5',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..18446744073709551616>',
                                 payout_0)
    }
    if (!(typeof(premium_0) === 'bigint' && premium_0 >= 0n && premium_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 6',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..18446744073709551616>',
                                 premium_0)
    }
    if (!(typeof(start_0) === 'bigint' && start_0 >= 0n && start_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 7',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..18446744073709551616>',
                                 start_0)
    }
    if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('terms_digest',
                                 'argument 8',
                                 'proofs.compact line 45 char 1',
                                 'Uint<0..18446744073709551616>',
                                 expiry_0)
    }
    return _dummyContract._terms_digest_0(policy_id_0,
                                          trigger_type_0,
                                          operator_0,
                                          threshold_0,
                                          payout_0,
                                          premium_0,
                                          start_0,
                                          expiry_0);
  },
  derive_eligibility: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`derive_eligibility: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const secret_0 = args_0[0];
    const policy_id_0 = args_0[1];
    if (!(secret_0.buffer instanceof ArrayBuffer && secret_0.BYTES_PER_ELEMENT === 1 && secret_0.length === 32)) {
      __compactRuntime.typeError('derive_eligibility',
                                 'argument 1',
                                 'proofs.compact line 74 char 1',
                                 'Bytes<32>',
                                 secret_0)
    }
    if (!(policy_id_0.buffer instanceof ArrayBuffer && policy_id_0.BYTES_PER_ELEMENT === 1 && policy_id_0.length === 32)) {
      __compactRuntime.typeError('derive_eligibility',
                                 'argument 2',
                                 'proofs.compact line 74 char 1',
                                 'Bytes<32>',
                                 policy_id_0)
    }
    return _dummyContract._derive_eligibility_0(secret_0, policy_id_0);
  },
  derive_nullifier: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`derive_nullifier: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const secret_0 = args_0[0];
    const policy_id_0 = args_0[1];
    if (!(secret_0.buffer instanceof ArrayBuffer && secret_0.BYTES_PER_ELEMENT === 1 && secret_0.length === 32)) {
      __compactRuntime.typeError('derive_nullifier',
                                 'argument 1',
                                 'proofs.compact line 82 char 1',
                                 'Bytes<32>',
                                 secret_0)
    }
    if (!(policy_id_0.buffer instanceof ArrayBuffer && policy_id_0.BYTES_PER_ELEMENT === 1 && policy_id_0.length === 32)) {
      __compactRuntime.typeError('derive_nullifier',
                                 'argument 2',
                                 'proofs.compact line 82 char 1',
                                 'Bytes<32>',
                                 policy_id_0)
    }
    return _dummyContract._derive_nullifier_0(secret_0, policy_id_0);
  },
  payout_commitment: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`payout_commitment: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const amount_0 = args_0[0];
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('payout_commitment',
                                 'argument 1',
                                 'proofs.compact line 91 char 1',
                                 'Uint<0..18446744073709551616>',
                                 amount_0)
    }
    return _dummyContract._payout_commitment_0(amount_0);
  },
  expected_payout: (...args_0) => {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`expected_payout: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const trigger_fired_0 = args_0[0];
    const in_window_0 = args_0[1];
    const payout_0 = args_0[2];
    if (!(typeof(trigger_fired_0) === 'boolean')) {
      __compactRuntime.typeError('expected_payout',
                                 'argument 1',
                                 'proofs.compact line 103 char 1',
                                 'Boolean',
                                 trigger_fired_0)
    }
    if (!(typeof(in_window_0) === 'boolean')) {
      __compactRuntime.typeError('expected_payout',
                                 'argument 2',
                                 'proofs.compact line 103 char 1',
                                 'Boolean',
                                 in_window_0)
    }
    if (!(typeof(payout_0) === 'bigint' && payout_0 >= 0n && payout_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('expected_payout',
                                 'argument 3',
                                 'proofs.compact line 103 char 1',
                                 'Uint<0..18446744073709551616>',
                                 payout_0)
    }
    return _dummyContract._expected_payout_0(trigger_fired_0,
                                             in_window_0,
                                             payout_0);
  },
  in_window: (...args_0) => {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`in_window: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const start_0 = args_0[0];
    const expiry_0 = args_0[1];
    const now_0 = args_0[2];
    if (!(typeof(start_0) === 'bigint' && start_0 >= 0n && start_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('in_window',
                                 'argument 1',
                                 'proofs.compact line 111 char 1',
                                 'Uint<0..18446744073709551616>',
                                 start_0)
    }
    if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('in_window',
                                 'argument 2',
                                 'proofs.compact line 111 char 1',
                                 'Uint<0..18446744073709551616>',
                                 expiry_0)
    }
    if (!(typeof(now_0) === 'bigint' && now_0 >= 0n && now_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('in_window',
                                 'argument 3',
                                 'proofs.compact line 111 char 1',
                                 'Uint<0..18446744073709551616>',
                                 now_0)
    }
    return _dummyContract._in_window_0(start_0, expiry_0, now_0);
  },
  receipt_digest: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`receipt_digest: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const policy_id_0 = args_0[0];
    const proof_hash_0 = args_0[1];
    const trigger_outcome_0 = args_0[2];
    const settled_0 = args_0[3];
    const timestamp_0 = args_0[4];
    if (!(policy_id_0.buffer instanceof ArrayBuffer && policy_id_0.BYTES_PER_ELEMENT === 1 && policy_id_0.length === 32)) {
      __compactRuntime.typeError('receipt_digest',
                                 'argument 1',
                                 'proofs.compact line 119 char 1',
                                 'Bytes<32>',
                                 policy_id_0)
    }
    if (!(proof_hash_0.buffer instanceof ArrayBuffer && proof_hash_0.BYTES_PER_ELEMENT === 1 && proof_hash_0.length === 32)) {
      __compactRuntime.typeError('receipt_digest',
                                 'argument 2',
                                 'proofs.compact line 119 char 1',
                                 'Bytes<32>',
                                 proof_hash_0)
    }
    if (!(typeof(trigger_outcome_0) === 'boolean')) {
      __compactRuntime.typeError('receipt_digest',
                                 'argument 3',
                                 'proofs.compact line 119 char 1',
                                 'Boolean',
                                 trigger_outcome_0)
    }
    if (!(typeof(settled_0) === 'boolean')) {
      __compactRuntime.typeError('receipt_digest',
                                 'argument 4',
                                 'proofs.compact line 119 char 1',
                                 'Boolean',
                                 settled_0)
    }
    if (!(typeof(timestamp_0) === 'bigint' && timestamp_0 >= 0n && timestamp_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('receipt_digest',
                                 'argument 5',
                                 'proofs.compact line 119 char 1',
                                 'Uint<0..18446744073709551616>',
                                 timestamp_0)
    }
    return _dummyContract._receipt_digest_0(policy_id_0,
                                            proof_hash_0,
                                            trigger_outcome_0,
                                            settled_0,
                                            timestamp_0);
  },
  statement_digest: (...args_0) => {
    if (args_0.length !== 5) {
      throw new __compactRuntime.CompactError(`statement_digest: expected 5 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const policy_id_0 = args_0[0];
    const terms_digest_v_0 = args_0[1];
    const nullifier_0 = args_0[2];
    const trigger_outcome_0 = args_0[3];
    const payout_commitment_v_0 = args_0[4];
    if (!(policy_id_0.buffer instanceof ArrayBuffer && policy_id_0.BYTES_PER_ELEMENT === 1 && policy_id_0.length === 32)) {
      __compactRuntime.typeError('statement_digest',
                                 'argument 1',
                                 'proofs.compact line 137 char 1',
                                 'Bytes<32>',
                                 policy_id_0)
    }
    if (!(terms_digest_v_0.buffer instanceof ArrayBuffer && terms_digest_v_0.BYTES_PER_ELEMENT === 1 && terms_digest_v_0.length === 32)) {
      __compactRuntime.typeError('statement_digest',
                                 'argument 2',
                                 'proofs.compact line 137 char 1',
                                 'Bytes<32>',
                                 terms_digest_v_0)
    }
    if (!(nullifier_0.buffer instanceof ArrayBuffer && nullifier_0.BYTES_PER_ELEMENT === 1 && nullifier_0.length === 32)) {
      __compactRuntime.typeError('statement_digest',
                                 'argument 3',
                                 'proofs.compact line 137 char 1',
                                 'Bytes<32>',
                                 nullifier_0)
    }
    if (!(typeof(trigger_outcome_0) === 'boolean')) {
      __compactRuntime.typeError('statement_digest',
                                 'argument 4',
                                 'proofs.compact line 137 char 1',
                                 'Boolean',
                                 trigger_outcome_0)
    }
    if (!(payout_commitment_v_0.buffer instanceof ArrayBuffer && payout_commitment_v_0.BYTES_PER_ELEMENT === 1 && payout_commitment_v_0.length === 32)) {
      __compactRuntime.typeError('statement_digest',
                                 'argument 5',
                                 'proofs.compact line 137 char 1',
                                 'Bytes<32>',
                                 payout_commitment_v_0)
    }
    return _dummyContract._statement_digest_0(policy_id_0,
                                              terms_digest_v_0,
                                              nullifier_0,
                                              trigger_outcome_0,
                                              payout_commitment_v_0);
  }
};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
//# sourceMappingURL=index.js.map
