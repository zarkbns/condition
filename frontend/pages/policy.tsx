import Head from 'next/head';
import { useMemo, useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';
import { JourneyRail, StageNav, completedStages, type StageId } from '../src/components/JourneyRail';
import { ModeBanner } from '../src/components/ModeBanner';
import { TriggerType, ComparisonOp, type Dust, type Policy } from '../../src/types';

const DUST = 1_000_000_000n;
const DAY = 86_400;

const TRIGGERS: { value: TriggerType; label: string; unit: string }[] = [
  { value: TriggerType.TEMPERATURE, label: 'Temperature', unit: '°C ×100' },
  { value: TriggerType.RAINFALL_MM, label: 'Rainfall', unit: 'mm ×100' },
  { value: TriggerType.FLIGHT_DELAY_MIN, label: 'Flight delay', unit: 'minutes' },
  { value: TriggerType.EARTHQUAKE_MAG, label: 'Earthquake', unit: 'magnitude ×100' },
];

const OPERATORS: { value: ComparisonOp; label: string }[] = [
  { value: ComparisonOp.GT, label: '> greater than' },
  { value: ComparisonOp.GTE, label: '≥ at least' },
  { value: ComparisonOp.LT, label: '< less than' },
  { value: ComparisonOp.LTE, label: '≤ at most' },
  { value: ComparisonOp.EQ, label: '= exactly' },
];

export default function PolicyPage() {
  const { runtime, status, insurer, policies, receipts, refresh } = useCondition();
  const [triggerType, setTriggerType] = useState<TriggerType>(TriggerType.TEMPERATURE);
  const [operator, setOperator] = useState<ComparisonOp>(ComparisonOp.GTE);
  const [threshold, setThreshold] = useState(3500);
  const [payout, setPayout] = useState(5);
  const [premium, setPremium] = useState(0.1);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Stage 2 needs escrow that covers payout + premium, and a holder
  // commitment. Anything short of that is still open on this page.
  const fundable = useMemo(
    () => policies.filter((p) => {
      const target = p.terms.payoutAmount + p.terms.premium;
      return p.status === 'ACTIVE' && (p.fundedAmount < target || p.enrollmentCommitment === null);
    }),
    [policies],
  );

  const now = () => Math.floor(Date.now() / 1000);

  const createPolicy = async () => {
    if (!runtime) return;
    setError(null);
    setCreated(null);
    setCreating(true);
    const t = now();
    try {
      const policy = await runtime.policyService.create(
        insurer,
        {
          triggerType,
          operator,
          threshold,
          payoutAmount: BigInt(Math.round(payout * Number(DUST))) as Dust,
          premium: BigInt(Math.round(premium * Number(DUST))) as Dust,
          coverageStart: t,
          expiry: t + days * DAY,
        },
        t,
      );
      setCreated(policy.policyId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const run = (key: string, fn: () => Promise<void>) =>
    (async () => {
      if (!runtime) return;
      setError(null);
      setBusy(key);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    })();

  const fund = (policyId: string) =>
    run(`fund:${policyId}`, async () => {
      if (!runtime) return;
      const p = await runtime.policyService.getPolicy(policyId);
      const target = p.terms.payoutAmount + p.terms.premium;
      if (p.fundedAmount < target) {
        await runtime.policyService.fund(policyId, target - p.fundedAmount, now());
      }
    });

  const enroll = (policyId: string) =>
    run(`enroll:${policyId}`, async () => {
      if (!runtime) return;
      const { commitment } = await runtime.claimService.enroll(policyId, now());
      const p = await runtime.policyService.getPolicy(policyId);
      await runtime.policyService.publishEnrollment(policyId, commitment, p.terms.premium, now());
    });

  const current: StageId = fundable.length > 0 ? 'fund' : 'policy';
  const furthest = policies.reduce<StageId[]>((best, p) => {
    const done = completedStages(p, { receipts });
    return done.length > best.length ? done : best;
  }, []);

  return (
    <ConnectionGate>
      <Head>
        <title>Policy — Condition</title>
      </Head>

      <ModeBanner status={status} />
      <JourneyRail current={current} done={furthest} />

      <div className="page-head">
        <span className="stamp">[ stage 01 · policy ]</span>
        <h1 className="section-title">Set the terms. They are public forever.</h1>
        <p className="section-sub">
          A policy is a promise with a number attached. Trigger, threshold,
          payout and premium are fixed at creation and visible to anyone
          (Invariant 5) — which is exactly why nobody, not even the insurer,
          can decide the settlement amount later.
        </p>
      </div>

      <div className="card stage-card">
        <div className="grid three">
          <div>
            <label htmlFor="trigger">Trigger source</label>
            <select id="trigger" value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
              {TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>{t.label} ({t.unit})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="operator">Pays out when</label>
            <select id="operator" value={operator} onChange={(e) => setOperator(e.target.value as ComparisonOp)}>
              {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="threshold">Threshold (×100)</label>
            <input id="threshold" type="number" value={threshold} min={-1000000} max={1000000} step={1}
              onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="payout">Payout (tDUST)</label>
            <input id="payout" type="number" value={payout} min={0.000000001} step={0.1}
              onChange={(e) => setPayout(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="premium">Premium (tDUST)</label>
            <input id="premium" type="number" value={premium} min={0} step={0.01}
              onChange={(e) => setPremium(Number(e.target.value))} />
          </div>
          <div>
            <label htmlFor="days">Coverage (days)</label>
            <input id="days" type="number" value={days} min={1} step={1}
              onChange={(e) => setDays(Number(e.target.value))} />
          </div>
        </div>

        <div className="terms-preview">
          <span className="stamp">[ the promise ]</span>
          <p>
            If <strong>{TRIGGERS.find((t) => t.value === triggerType)?.label.toLowerCase()}</strong>{' '}
            reads <strong>{operatorGlyph(operator)} {(threshold / 100).toFixed(2)}</strong> during the{' '}
            <strong>{days}-day</strong> window, this policy pays{' '}
            <strong>{payout} tDUST</strong> — deterministically, to whoever holds the enrollment.
          </p>
        </div>

        <div className="button-row">
          <button className="button primary" onClick={createPolicy} disabled={creating} aria-busy={creating || undefined}>
            {creating ? 'Creating…' : 'Create policy'}
          </button>
        </div>

        {error && (
          <div className="notice error" role="alert">
            <span className="stamp">[ error ]</span> {error}
          </div>
        )}
        {created && (
          <div className="notice success">
            <strong>Policy created.</strong>{' '}
            <code title={created}>{shortHash(created)}</code>
            <div className="mono-row" style={{ marginTop: 6 }}>
              Next: fund the escrow and enroll as holder below — then the event stage opens.
            </div>
          </div>
        )}
      </div>

      {/* ── Stage 02: fund + enroll ─────────────────────────────────── */}
      <div className="page-head" style={{ marginTop: 40 }}>
        <span className="stamp">[ stage 02 · fund ]</span>
        <h2 className="section-title">Back the escrow. Enroll the holder.</h2>
        <p className="section-sub">
          Settlement can only pay what is already funded, and only to an
          enrolled commitment. Enrolling publishes just{' '}
          <code>H(policyId, secret)</code> — the secret stays in this browser.
        </p>
      </div>

      {fundable.length === 0 ? (
        <div className="card empty-state">
          <img src="/brand/mark-white.png" alt="" aria-hidden="true" className="empty-mark" />
          <p>
            {policies.length === 0
              ? 'Nothing to fund yet — create a policy above.'
              : 'Every policy in this session is fully funded and enrolled. The event stage is open.'}
          </p>
          {policies.length > 0 && <a className="button ghost small" href="/claim">Continue to verified event →</a>}
        </div>
      ) : (
        <div className="stage-list">
          {fundable.map((p) => (
            <PolicyFundRow
              key={p.policyId}
              policy={p}
              busy={busy}
              onFund={() => fund(p.policyId)}
              onEnroll={() => enroll(p.policyId)}
            />
          ))}
        </div>
      )}

      <StageNav next={{ href: '/claim', label: 'Verified event — record two sources' }} />
    </ConnectionGate>
  );
}

function PolicyFundRow({ policy, busy, onFund, onEnroll }: {
  policy: Policy;
  busy: string | null;
  onFund: () => void;
  onEnroll: () => void;
}) {
  const target = policy.terms.payoutAmount + policy.terms.premium;
  const funded = policy.fundedAmount >= target;
  const enrolled = policy.enrollmentCommitment !== null;
  const pct = target > 0n ? Math.min(100, Number((policy.fundedAmount * 100n) / target)) : 100;

  return (
    <div className="card policy-row">
      <div className="policy-row-head">
        <code title={policy.policyId}>{shortHash(policy.policyId)}</code>
        <span className={`status ${policy.status}`}>{policy.status}</span>
      </div>
      <p className="policy-terms">
        {policy.terms.triggerType} {operatorGlyph(policy.terms.operator)}{' '}
        {(policy.terms.threshold / 100).toFixed(2)} · payout{' '}
        {(Number(policy.terms.payoutAmount) / 1e9).toFixed(2)} tDUST · premium{' '}
        {(Number(policy.terms.premium) / 1e9).toFixed(3)} tDUST
      </p>

      <div className="escrow">
        <div className="escrow-bar" role="img" aria-label={`escrow ${pct}% funded`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="mono-row">
          escrow {(Number(policy.fundedAmount) / 1e9).toFixed(2)} / {(Number(target) / 1e9).toFixed(2)} tDUST
        </span>
      </div>

      <div className="button-row">
        <button className="button" onClick={onFund} disabled={funded || busy !== null}
          aria-busy={busy === `fund:${policy.policyId}` || undefined}>
          {funded ? 'Escrowed ✓' : busy === `fund:${policy.policyId}` ? 'Funding…' : 'Fund to target'}
        </button>
        <button className="button" onClick={onEnroll} disabled={enrolled || busy !== null}
          aria-busy={busy === `enroll:${policy.policyId}` || undefined}>
          {enrolled ? 'Enrolled ✓' : busy === `enroll:${policy.policyId}` ? 'Enrolling…' : 'Enroll as holder'}
        </button>
      </div>

      {enrolled && (
        <p className="mono-row" style={{ marginTop: 10 }}>
          commitment {shortHash(String(policy.enrollmentCommitment))} · secret never left this browser
        </p>
      )}
    </div>
  );
}

function operatorGlyph(op: ComparisonOp): string {
  switch (op) {
    case ComparisonOp.GT: return '>';
    case ComparisonOp.GTE: return '≥';
    case ComparisonOp.LT: return '<';
    case ComparisonOp.LTE: return '≤';
    case ComparisonOp.EQ: return '=';
  }
}

function shortHash(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
