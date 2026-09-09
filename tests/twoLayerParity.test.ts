// Two-layer execution parity (BUILD_SPEC.md §9, §13 hooks).
//
// The strongest evidence Condition has: the REAL compiled Compact circuits
// (compactc 0.30.0 output) executing on the REAL Midnight runtime
// (@midnight-ntwrk/compact-runtime) produce byte-identical digests to the TS
// reference runtime at every stage of the lifecycle.
//
// The compiled modules resolve through src/utils/managedContracts.ts: the
// committed contracts/managed-compact copies ship with every checkout, so
// this suite RUNS on a fresh clone / CI without a local compactc compile.
// Skipped automatically (not failed) only if neither source exists.
//
// Privacy note: this suite passes the holder secret ONLY through local
// witness providers, exactly as the browser client would. Nothing is logged
// or serialized.

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triggerDigestOf } from '../src/core/hashing.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const committedDir = join(root, 'contracts', 'managed-compact');

const available = existsSync(join(committedDir, 'policy', 'contract', 'index.js'));

const maybe = available ? describe : describe.skip;

maybe('two-layer execution parity (real compact-runtime)', () => {
  // Golden timeline (tests/helpers.ts).
  const T0 = 1_700_000_000;
  const EXPIRY = T0 + 30 * 86_400;
  const T_TRIGGER = 1_700_020_000;
  const T_CLAIM = 1_700_030_000;
  const T_SETTLE = 1_700_040_000;
  const PAYOUT = 5_000_000_000n;
  const PREMIUM = 100_000_000n;

  const hex = (b: Uint8Array): string =>
    '0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  async function runFlow() {
    // All module loading happens inside this function, called from a single
    // beforeAll — vitest 1.6 can run multiple beforeAll hooks concurrently,
    // which would race outer-scope assignments.
    const rt = (await import('@midnight-ntwrk/compact-runtime')) as never as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createCircuitContext: (...args: any[]) => any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createConstructorContext: (...args: any[]) => any;
      dummyContractAddress: () => unknown;
      CostModel: { initialCostModel: () => unknown };
    };
    // Loaded through the same loader the public surfaces and the browser
    // wallet path use (committed managed-compact modules) — keeps this suite
    // pinned to exactly what production executes.
    const { loadManagedContractModule } = await import('../src/utils/managedContracts.js');
    const policyMod = (await loadManagedContractModule('policy')) as unknown as Record<string, unknown>;
    const settlementMod = (await loadManagedContractModule('settlement')) as unknown as Record<
      string,
      unknown
    >;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Policy = policyMod['Contract'] as new (w: any) => any;
    const policyLedger = policyMod['ledger'] as (s: any) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Settlement = settlementMod['Contract'] as new (w: any) => any;
    const settlementLedger = settlementMod['ledger'] as (s: any) => any;

    const {
      createRuntime,
    } = await import('../src/utils/midnight.js');
    const { hexToBytes, nullifierOf, randomAddress, sourceIdDigest } =
      await import('../src/core/hashing.js');
    const { ComparisonOp, TriggerType } = await import('../src/types/index.js');

    const runtime = createRuntime();
    const insurer = randomAddress();

    // ---- TS reference layer ------------------------------------------------
    const policy = runtime.policyService.create(
      insurer,
      {
        triggerType: TriggerType.TEMPERATURE,
        operator: ComparisonOp.GTE,
        threshold: 3500,
        payoutAmount: PAYOUT,
        premium: PREMIUM,
        coverageStart: T0,
        expiry: EXPIRY,
      },
      T0,
    );
    runtime.policyService.fund(policy.policyId, PAYOUT, T0 + 10);
    const { commitment } = runtime.claimService.enroll(policy.policyId, T0 + 20);
    runtime.policyService.publishEnrollment(policy.policyId, commitment, PREMIUM, T0 + 20);
    const secret = runtime.privateLedger.secretFor(policy.policyId);

    runtime.triggerService.registerSource('open-meteo');
    runtime.triggerService.registerSource('noaa');
    const capsRef = runtime.publicLedger.capabilityFor(policy.policyId);
    runtime.triggerService.registerOracle(policy.policyId, 'open-meteo', capsRef.oracleSecrets[0]!, T_TRIGGER);
    runtime.triggerService.registerOracle(policy.policyId, 'noaa', capsRef.oracleSecrets[1]!, T_TRIGGER);
    const triggerRecord = runtime.triggerService.submitReadings(
      policy.policyId,
      [
        { source: 'open-meteo', value: 4000, oracleSecret: capsRef.oracleSecrets[0]! },
        { source: 'noaa', value: 3600, oracleSecret: capsRef.oracleSecrets[1]! },
      ],
      T_TRIGGER,
    );

    const proof = runtime.claimService.submitClaim(policy.policyId, T_CLAIM);
    const { receipt, releasedAmount } = runtime.settlementService.settle(
      T_SETTLE,
      proof,
      policy.policyId,
      () => ({
        policyId: policy.policyId,
        holderSecret: secret,
        settlementAmount: PAYOUT,
        claimTime: T_CLAIM,
        triggerEvidence: triggerRecord,
      }),
    );

    // ---- Compiled contract layer (real Midnight runtime) -------------------
    // The v2 contracts consume the capability secrets as witnesses — the
    // SAME set the reference layer generated (one credential set across
    // layers, exactly as the on-chain flow does).
    const caps = runtime.publicLedger.capabilityFor(policy.policyId);
    const hex32 = (s: string) => hexToBytes(s);
    const policyContract = new Policy({
      holder_secret: (c: { privateState: unknown }) => [c.privateState, hex32(secret)],
      insurer_secret: (c: { privateState: unknown }) => [c.privateState, hex32(caps.insurerSecret)],
      settlement_secret: (c: { privateState: unknown }) => [c.privateState, hex32(caps.settlementSecret)],
      oracle_secret1: (c: { privateState: unknown }) => [c.privateState, hex32(caps.oracleSecrets[0]!)],
      oracle_secret2: (c: { privateState: unknown }) => [c.privateState, hex32(caps.oracleSecrets[1]!)],
    });
    let ctx = rt.createCircuitContext(
      rt.dummyContractAddress(),
      policyContract
        .initialState(rt.createConstructorContext({}, '0'.repeat(64)))
        .currentZswapLocalState.coinPublicKey,
      policyContract
        .initialState(rt.createConstructorContext({}, '0'.repeat(64)))
        .currentContractState.data,
      {},
      undefined,
      rt.CostModel.initialCostModel(),
    );

    let r = policyContract.circuits.create(
      ctx,
      hexToBytes(insurer),
      0, // TriggerType.temperature
      1, // ComparisonOp.gte
      3500n,
      PAYOUT,
      PREMIUM,
      BigInt(T0),
      BigInt(EXPIRY),
      BigInt(T0),
      0n,
    );
    ctx = r.context;
    r = policyContract.circuits.fund(ctx, PAYOUT);
    ctx = r.context;
    r = policyContract.circuits.enroll(ctx, PREMIUM);
    ctx = r.context;
    // Insurer-gated oracle credential registration (v2), then the trigger
    // with recorded_at and both credential witnesses.
    r = policyContract.circuits.register_oracle1(ctx, hexToBytes(sourceIdDigest('open-meteo')));
    ctx = r.context;
    r = policyContract.circuits.register_oracle2(ctx, hexToBytes(sourceIdDigest('noaa')));
    ctx = r.context;
    r = policyContract.circuits.record_trigger(
      ctx,
      4000n,
      3600n,
      hexToBytes(sourceIdDigest('open-meteo')),
      hexToBytes(sourceIdDigest('noaa')),
      BigInt(T_TRIGGER),
    );
    ctx = r.context;
    // Authorize the settlement instance (v2) — the mark_settled path needs it.
    r = policyContract.circuits.authorize_settlement(ctx);
    ctx = r.context;

    const pLed = policyLedger(ctx.currentQueryContext.state);
    const sContract = new Settlement({
      holder_secret: (c: { privateState: unknown }) => [c.privateState, hexToBytes(secret)],
      claim_time: (c: { privateState: unknown }) => [c.privateState, BigInt(T_CLAIM)],
      observed_value: (c: { privateState: unknown }) => [
        c.privateState,
        BigInt(triggerRecord.observedValue),
      ],
      recorded_at: (c: { privateState: unknown }) => [c.privateState, BigInt(T_TRIGGER)],
      reading1_source: (c: { privateState: unknown }) => {
        const [a, b] = canonical(triggerRecord);
        return [c.privateState, a[0]];
      },
      reading1_value: (c: { privateState: unknown }) => {
        const [a] = canonical(triggerRecord);
        return [c.privateState, BigInt(a[1])];
      },
      reading2_source: (c: { privateState: unknown }) => {
        const [, b] = canonical(triggerRecord);
        return [c.privateState, b[0]];
      },
      reading2_value: (c: { privateState: unknown }) => {
        const [, b] = canonical(triggerRecord);
        return [c.privateState, BigInt(b[1])];
      },
    });
    let sCtx = rt.createCircuitContext(
      rt.dummyContractAddress(),
      sContract
        .initialState(rt.createConstructorContext({}, '0'.repeat(64)))
        .currentZswapLocalState.coinPublicKey,
      sContract
        .initialState(rt.createConstructorContext({}, '0'.repeat(64)))
        .currentContractState.data,
      {},
      undefined,
      rt.CostModel.initialCostModel(),
    );
    let sl = sContract.circuits.link(
      sCtx,
      pLed.policy_id,
      pLed.terms_digest_v,
      pLed.enrollment_commitment,
      pLed.payout,
      pLed.start,
      pLed.expiry,
      pLed.trigger_fired,
      pLed.trigger_digest_v,
    );
    sCtx = sl.context;
    const nullifier = nullifierOf(policy.policyId, secret);
    const st = sContract.circuits.settle(sCtx, BigInt(T_SETTLE), hexToBytes(nullifier));
    const sLed = settlementLedger(st.context.currentQueryContext.state);

    function canonical(rec: {
      readings: Array<{ sourceId: string; value: number }>;
    }): [[Uint8Array, number], [Uint8Array, number]] {
      // Canonical order: value-ascending, ties by submission order — the
      // same rule the circuits apply to the Uint values.
      const rs = rec.readings.map((x) => [hexToBytes(x.sourceId), x.value] as [Uint8Array, number]);
      const [x, y] = rs as [[Uint8Array, number], [Uint8Array, number]];
      return x[1] <= y[1] ? [x, y] : [y, x];
    }

    return {
      policy,
      commitment,
      triggerRecord,
      proof,
      receipt,
      releasedAmount,
      compact: {
        policyId: hex(pLed.policy_id),
        termsDigest: hex(pLed.terms_digest_v),
        enrollmentCommitment: hex(pLed.enrollment_commitment),
        triggerFired: pLed.trigger_fired,
        triggerValue: pLed.trigger_value,
        triggerDigest: hex(pLed.trigger_digest_v),
        receiptId: hex(st.result),
        lastStatus: sLed.last_status,
        lastReceiptHash: hex(sLed.last_receipt_hash),
        settledCount: sLed.settled_count,
        deniedCount: sLed.denied_count,
      },
    };
  }

  let flow: Awaited<ReturnType<typeof runFlow>>;

  beforeAll(async () => {
    // Single hook — vitest 1.6 may run multiple beforeAll hooks
    // concurrently, which would race module loading against runFlow().
    flow = await runFlow();
  });

  it('policyId: compiled create() == TS policyIdDigest', () => {
    expect(flow.compact.policyId).toBe(flow.policy.policyId);
  });

  it('termsDigest parity', () => {
    expect(flow.compact.termsDigest).toBe(flow.policy.termsDigest);
  });

  it('enrollment commitment parity (private witness → public digest)', () => {
    expect(flow.compact.enrollmentCommitment).toBe(flow.commitment);
  });

  it('trigger outcome + observed value parity (min2 lower median)', () => {
    expect(flow.compact.triggerFired).toBe(flow.triggerRecord.outcome);
    expect(flow.compact.triggerValue).toBe(BigInt(flow.triggerRecord.observedValue));
  });

  it('canonical trigger digest parity (accepted evidence binding)', () => {
    expect(flow.compact.triggerDigest)
      .toBe(triggerDigestOf(flow.policy.policyId, flow.triggerRecord));
  });

  it('receipt id: compiled settle() == TS settlement receipt', () => {
    expect(flow.compact.receiptId).toBe(flow.receipt.receiptId);
  });

  it('proof hash on-chain == client-side proof hash', () => {
    expect(flow.compact.lastReceiptHash).toBe(flow.proof.proofHash);
  });

  it('settlement counters + status', () => {
    expect(flow.compact.lastStatus).toBe(true);
    expect(flow.compact.settledCount).toBe(1n);
    expect(flow.compact.deniedCount).toBe(0n);
    expect(flow.releasedAmount).toBe(PAYOUT);
  });
});
