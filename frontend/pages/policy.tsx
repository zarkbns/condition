import Head from 'next/head';
import { useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';
import { TriggerType, ComparisonOp, type Dust } from '../../src/types';

const DUST = 1_000_000_000n;
const DAY = 86_400;

export default function PolicyPage() {
  const { runtime, insurer, status, txHistory, refresh, policies } = useCondition();
  const [triggerType, setTriggerType] = useState<TriggerType>(TriggerType.TEMPERATURE);
  const [operator, setOperator] = useState<ComparisonOp>(ComparisonOp.GTE);
  const [threshold, setThreshold] = useState(3500);
  const [payout, setPayout] = useState(5);
  const [premium, setPremium] = useState(0.1);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createPolicy = async () => {
    if (!runtime) return;
    setError(null);
    setCreated(null);
    setCreating(true);
    const now = Math.floor(Date.now() / 1000);
    try {
      const policy = await runtime.policyService.create(
        insurer,
        {
          triggerType,
          operator,
          threshold,
          payoutAmount: BigInt(Math.round(payout * Number(DUST))) as Dust,
          premium: BigInt(Math.round(premium * Number(DUST))) as Dust,
          coverageStart: now,
          expiry: now + days * DAY,
        },
        now,
      );
      setCreated(policy.policyId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const createTx = txHistory.filter((t) => t.action === 'create').slice(-5).reverse();

  return (
    <ConnectionGate>
      <Head>
        <title>Create policy — Condition</title>
      </Head>
      <div className="page-head">
        <h1 className="section-title">Create a policy</h1>
        <p className="section-sub">
          Terms are public and immutable the moment the policy exists
          (Invariant 5). The payout is deterministic — nobody, not even you,
          chooses the settlement amount later.
          {status.mode === 'preprod' && (
            <span style={{ color: 'var(--text)', marginLeft: 8 }}>
              · Preprod wallet: {status.walletAddress.slice(0, 8)}…
            </span>
          )}
        </p>
      </div>

      <div className="card">
        <div className="grid three">
          <div>
            <label>Trigger</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value as TriggerType)}>
              <option value={TriggerType.TEMPERATURE}>Temperature (°C ×100)</option>
              <option value={TriggerType.RAINFALL_MM}>Rainfall (mm ×100)</option>
              <option value={TriggerType.FLIGHT_DELAY_MIN}>Flight delay (min)</option>
              <option value={TriggerType.EARTHQUAKE_MAG}>Earthquake (magnitude ×100)</option>
            </select>
          </div>
          <div>
            <label>Operator</label>
            <select value={operator} onChange={(e) => setOperator(e.target.value as ComparisonOp)}>
              <option value={ComparisonOp.GT}>&gt; greater than</option>
              <option value={ComparisonOp.GTE}>≥ at least</option>
              <option value={ComparisonOp.LT}>&lt; less than</option>
              <option value={ComparisonOp.LTE}>≤ at most</option>
              <option value={ComparisonOp.EQ}>= exactly</option>
            </select>
          </div>
          <div>
            <label>Threshold (×100)</label>
            <input type="number" value={threshold} min={-1000000} max={1000000} step={1}
              onChange={(e) => setThreshold(Number(e.target.value))} />
          </div>
          <div>
            <label>Payout (tDUST)</label>
            <input type="number" value={payout} min={0.000000001} step={0.1}
              onChange={(e) => setPayout(Number(e.target.value))} />
          </div>
          <div>
            <label>Premium (tDUST)</label>
            <input type="number" value={premium} min={0} step={0.01}
              onChange={(e) => setPremium(Number(e.target.value))} />
          </div>
          <div>
            <label>Coverage (days)</label>
            <input type="number" value={days} min={1} step={1}
              onChange={(e) => setDays(Number(e.target.value))} />
          </div>
        </div>
        <div className="button-row">
          <button className="button primary" onClick={createPolicy} disabled={creating}>
            {creating ? 'Creating…' : 'Create policy'}
          </button>
        </div>
        {error && <div className="notice error">{error}</div>}
        {created && (
          <div className="notice success">
            Policy created. <code>{created}</code>
          </div>
        )}
      </div>

      {/* On-chain transaction history */}
      {createTx.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Policy</th>
                <th>Tx Hash</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {createTx.map((t, i) => (
                <tr key={`${t.txHash}-${i}`}>
                  <td><span className={`status ${t.status}`}>{t.action}</span></td>
                  <td><code>{t.policyId.slice(0, 16)}…</code></td>
                  <td>
                    {t.txHash ? (
                      <code>{t.txHash.slice(0, 16)}…{t.txHash.slice(-4)}</code>
                    ) : (
                      <span className="mono-row">—</span>
                    )}
                  </td>
                  <td><span className="mono-row">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section-title" style={{ marginTop: 32 }}>Policies</h2>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {policies.length === 0 ? (
          <div className="empty">No policies yet in this session.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Policy</th>
                <th>Terms</th>
                <th>Escrow</th>
                <th>Status</th>
                <th>Holder</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <tr key={p.policyId}>
                  <td><code>{p.policyId.slice(0, 18)}…</code></td>
                  <td>
                    {p.terms.triggerType} {operatorGlyph(p.terms.operator)}{' '}
                    {(p.terms.threshold / 100).toFixed(2)}, payout{' '}
                    {(Number(p.terms.payoutAmount) / 1e9).toFixed(2)} tDUST
                  </td>
                  <td>{(Number(p.fundedAmount) / 1e9).toFixed(2)}</td>
                  <td><span className={`status ${p.status}`}>{p.status}</span></td>
                  <td>
                    {p.enrollmentCommitment ? (
                      <span title={p.enrollmentCommitment}>● enrolled</span>
                    ) : (
                      <span className="mono-row">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </ConnectionGate>
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