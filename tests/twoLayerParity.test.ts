// Two-layer execution parity (BUILD_SPEC.md §9, §13 hooks).
//
// The strongest evidence Condition has: the REAL compiled Compact circuits
// (contracts/managed/, produced by compactc 0.30.0) executing on the REAL
// Midnight runtime (@midnight-ntwrk/compact-runtime) produce byte-identical
// digests to the TS reference runtime at every stage of the lifecycle.
//
// Skipped automatically (not failed) when the compiled contracts or the
// runtime package are absent — e.g. CI before `npm run build:contracts`.
//
// Privacy note: this suite passes the holder secret ONLY through local
// witness providers, exactly as the browser client would. Nothing is logged
// or serialized.

import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managedDir = join(root, 'contracts', 'managed');

const available =
  existsSync(join(managedDir, 'policy', 'contract', 'index.js')) &&
  existsSync(join(managedDir, 'settlement', 'contract', 'index.js'));

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
    // Interop-tolerant loading via absolute file URLs: vitest's transform
    // graph can re-wrap the ESM namespace depending on import order across
    // suites; a direct file-URL load sidesteps the resolver ambiguity.
    const load = async (name: string): Promise<Record<string, unknown>> => {
      const url = new URL(`../contracts/managed/${name}/contract/index.js`, import.meta.url);
      const mod = (await import(url.href)) as Record<string, unknown> & { default?: unknown };
      return ((mod.default as Record<string, unknown> | undefined) ?? mod) as Record<string, unknown>;
    };
    const policyMod = await load('policy');
    const settlementMod = await load('settlement');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Policy = policyMod['Contract'] as new (w: any) => any;
    const policyLedger = policyMod['ledger'] as (s: any) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Settlement = settlementMod['Contract'] as new (w: any) => any;
    const settlementLedger = settlementMod['ledger'] as (s: any) => any;

    const {
      createRuntime,
    } = await import('../src/utils/midnight.js');
    const { hexToBytes, nullifierOf, randomAddress, sourceIdDigest, readingDigestOf } =
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
    const triggerRecord = runtime.triggerService.submitReadings(
      policy.policyId,
      [
        { source: 'open-meteo', value: 4000 },
        { source: 'noaa', value: 3600 },
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
    const policyContract = new Policy({
      holder_secret: (c: { privateState: unknown }) => [c.privateState, hexToBytes(secret)],
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
    r = policyContract.circuits.record_trigger(
      ctx,
      4000n,
      3600n,
      hexToBytes(sourceIdDigest('open-meteo')),
      hexToBytes(sourceIdDigest('noaa')),
    );
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
    );
    sCtx = sl.context;
    const nullifier = nullifierOf(policy.policyId, secret);
    const st = sContract.circuits.settle(sCtx, BigInt(T_SETTLE), hexToBytes(nullifier));
    const sLed = settlementLedger(st.context.currentQueryContext.state);

    function canonical(rec: {
      readings: Array<{ sourceId: string; value: number }>;
    }): [[Uint8Array, number], [Uint8Array, number]] {
      const rs = rec.readings.map((x) => [hexToBytes(x.sourceId), x.value] as [Uint8Array, number]);
      const [x, y] = rs as [[Uint8Array, number], [Uint8Array, number]];
      return readingDigestOf(hex(x[0]), x[1]) < readingDigestOf(hex(y[0]), y[1]) ? [x, y] : [y, x];
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
