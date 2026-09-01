import Head from 'next/head';
import { useMemo, useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';
import type { ClaimProof, Receipt } from '../../src/types';
import { inCoverageWindow } from '../../src/core/payout';

export default function ClaimPage() {
  const { runtime, status, txHistory, refresh, policies } = useCondition();
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<ClaimProof | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [released, setReleased] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const claimable = useMemo(
    () => policies.filter((p) => p.status === 'TRIGGERED'),
    [policies],
  );
  const enrollable = useMemo(
    () => policies.filter((p) => p.status === 'ACTIVE' && p.enrollmentCommitment === null),
    [policies],
  );
  const fundable = useMemo(
    () => policies.filter((p) => p.status === 'ACTIVE'),
    [policies],
  );
  const policy = policies.find((p) => p.policyId === selected) ?? null;

  const now = () => Math.floor(Date.now() / 1000);

  const run = async (key: string, fn: () => Promise<void>) => {
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
  };

  const enroll = (policyId: string) =>
    run('enroll', async () => {
      if (!runtime) return;
      const { commitment } = await runtime.claimService.enroll(policyId, now());
      const policyRow = await runtime.policyService.getPolicy(policyId);
      await runtime.policyService.publishEnrollment(
        policyId, commitment, policyRow.terms.premium, now(),
      );
    });

  const fund = (policyId: string) =>
    run('fund', async () => {
      if (!runtime) return;
      const policyRow = await runtime.policyService.getPolicy(policyId);
      const target = policyRow.terms.payoutAmount + policyRow.terms.premium;
      await runtime.policyService.fund(policyId, target - policyRow.fundedAmount, now());
    });

  const recordTrigger = (policyId: string) =>
    run('record_trigger', async () => {
      if (!runtime) return;
      await runtime.triggerService.registerSource('open-meteo');
      await runtime.triggerService.registerSource('noaa');
      const policyRow = await runtime.policyService.getPolicy(policyId);
      const fires =
        policyRow.terms.operator === 'GT' || policyRow.terms.operator === 'GTE'
          ? policyRow.terms.threshold + 100
          : policyRow.terms.threshold - 100;
      await runtime.triggerService.submitReadings(
        policyId,
        [
          { source: 'open-meteo', value: fires },
          { source: 'noaa', value: fires - 50 },
        ],
        now(),
      );
    });

  const submitClaim = () =>
    run('submit_claim', async () => {
      if (!runtime || !policy) return;
      setProof(null);
      setReceipt(null);
      setReleased(null);
      const generated = await runtime.claimService.submitClaim(policy.policyId, now());
      setProof(generated);
    });

  const settle = () =>
    run('settle', async () => {
      if (!runtime || !policy || !proof) return;
      const t = now();
      const witnessProvider = () => {
        const snapshot = policy;
        return {
          policyId: policy.policyId,
          holderSecret: runtime.claimService.secretFor(policy.policyId),
          settlementAmount:
            snapshot.trigger?.outcome && inCoverageWindow(snapshot.terms, t)
              ? snapshot.terms.payoutAmount
              : 0n,
          claimTime: t,
          triggerEvidence: snapshot.trigger ?? { readings: [], outcome: false, observedValue: 0, recordedAt: 0 },
        };
      };
      const result = await runtime.settlementService.settle(
        t, proof, policy.policyId, witnessProvider as never,
      );
      await runtime.claimService.receivePayout(
        policy.policyId, result.releasedAmount, result.receipt.timestamp,
      );
      setReceipt(result.receipt);
      setReleased(result.releasedAmount > 0n
        ? `${(Number(result.releasedAmount) / 1e9).toFixed(2)} tDUST credited privately`
        : 'no payout — trigger did not fire or window closed');
    });

  const recentTx = txHistory.slice(-6).reverse();

  return (
    <ConnectionGate>
      <Head>
        <title>Claim — Condition</title>
      </Head>
      <div className="page-head">
        <h1 className="section-title">Submit a private claim</h1>
        <p className="section-sub">
          Your holder secret was generated in this browser and never leaves
          it. The proof is built client-side; only digests go public.
          {status.mode === 'preprod' && (
            <span style={{ color: 'var(--accent)', marginLeft: 8 }}>
              · Preprod wallet: {status.walletAddress.slice(0, 8)}…
            </span>
          )}
        </p>
      </div>

      {enrollable.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>1 · Enroll as holder</h2>
          <p style={{ marginBottom: 12 }}>
            Publishes only the commitment <code>H(policyId, secret)</code> and
            pays your premium into escrow.
          </p>
          {enrollable.map((p) => (
            <div key={p.policyId} className="actions-cell" style={{ marginBottom: 8 }}>
              <code>{p.policyId.slice(0, 20)}…</code>{' '}
              <button className="button" onClick={() => enroll(p.policyId)} disabled={busy !== null}>
                {busy === 'enroll' ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          ))}
        </div>
      )}

      {fundable.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2>2 · Fund escrow (insurer)</h2>
          <p style={{ marginBottom: 12 }}>
            Escrow must cover payout + premium before settlement can succeed.
          </p>
          {fundable.map((p) => (
            <div key={p.policyId} className="actions-cell" style={{ marginBottom: 8 }}>
              <code>{p.policyId.slice(0, 20)}…</code>{' '}
              <span className="mono-row">
                escrow {(Number(p.fundedAmount) / 1e9).toFixed(2)} tDUST
              </span>{' '}
              <button className="button" onClick={() => fund(p.policyId)} disabled={busy !== null}>
                {busy === 'fund' ? 'Funding…' : 'Fund to target'}
              </button>
              <button className="button" onClick={() => recordTrigger(p.policyId)} disabled={busy !== null}>
                {busy === 'record_trigger' ? 'Recording…' : 'Record 2-source trigger'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>3 · Claim + settle</h2>
        <label htmlFor="policy-select">Policy (triggered)</label>
        <select id="policy-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">— select a triggered policy —</option>
          {claimable.map((p) => (
            <option key={p.policyId} value={p.policyId}>
              {p.policyId.slice(0, 22)}… ({(Number(p.terms.payoutAmount) / 1e9).toFixed(1)} tDUST)
            </option>
          ))}
        </select>

        <div className="button-row">
          <button
            className="button primary"
            onClick={submitClaim}
            disabled={!selected || !claimable.some((p) => p.policyId === selected) || busy !== null}
          >
            {busy === 'submit_claim' ? 'Proving…' : 'Generate proof (client-side)'}
          </button>
          <button className="button" onClick={settle} disabled={!proof || busy !== null}>
            {busy === 'settle' ? 'Settling…' : 'Settle on Preprod'}
          </button>
        </div>

        {error && <div className="notice error">{error}</div>}

        {proof && (
          <div className="notice success">
            <strong>Proof generated in your browser.</strong>
            <div className="mono-row" style={{ marginTop: 6 }}>
              statement: {proof.statement.slice(0, 34)}…
              <br />
              proofHash: {proof.proofHash.slice(0, 34)}…
              <br />
              nullifier: {proof.publicInputs.nullifier.slice(0, 34)}…
            </div>
          </div>
        )}

        {receipt && (
          <div className="notice success">
            <strong>Receipt published (public):</strong>{' '}
            <span className={`status ${receipt.status}`}>{receipt.status}</span>
            <div className="mono-row" style={{ marginTop: 6 }}>
              receiptId: {receipt.receiptId.slice(0, 34)}…
              <br />
              proofHash: {receipt.proofHash.slice(0, 34)}…
            </div>
            {released && <div style={{ marginTop: 6 }}>{released}</div>}
          </div>
        )}

        <div className="privacy-note">
          <span className="lock">🔒</span>
          <span>
            The holder secret lives in this tab&apos;s memory only. Reloading
            starts a fresh session — on the deployed path it lives in your
            wallet instead. Nothing on this page ever POSTs the secret
            anywhere; there are no API routes in this app at all.
          </span>
        </div>
      </div>

      {/* On-chain transaction history */}
      {recentTx.length > 0 && (
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
              {recentTx.map((t, i) => (
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
    </ConnectionGate>
  );
}