import Head from 'next/head';
import { useMemo, useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import type { ClaimProof, Receipt } from '../../src/types';
import { inCoverageWindow } from '../../src/core/payout';

export default function ClaimPage() {
  const { runtime, policies, refresh } = useCondition();
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<ClaimProof | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [released, setReleased] = useState<string | null>(null);

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

  const enroll = (policyId: string) => {
    setError(null);
    try {
      const { commitment } = runtime.claimService.enroll(policyId, now());
      // Holder pays the premium into escrow at enrollment.
      const policyRow = runtime.policyService.getPolicy(policyId);
      runtime.policyService.publishEnrollment(policyId, commitment, policyRow.terms.premium, now());
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const fund = (policyId: string) => {
    setError(null);
    try {
      const policyRow = runtime.policyService.getPolicy(policyId);
      // Fund the escrow so it covers payout + premium.
      const target = policyRow.terms.payoutAmount + policyRow.terms.premium;
      runtime.policyService.fund(policyId, target - policyRow.fundedAmount, now());
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const recordTrigger = (policyId: string) => {
    setError(null);
    try {
      // Cross-verified trigger: two independent registered sources.
      runtime.triggerService.registerSource('open-meteo');
      runtime.triggerService.registerSource('noaa');
      const policyRow = runtime.policyService.getPolicy(policyId);
      const fires =
        policyRow.terms.operator === 'GT' || policyRow.terms.operator === 'GTE'
          ? policyRow.terms.threshold + 100
          : policyRow.terms.threshold - 100;
      runtime.triggerService.submitReadings(
        policyId,
        [
          { source: 'open-meteo', value: fires },
          { source: 'noaa', value: fires - 50 }, // agrees, slightly different reading
        ],
        now(),
      );
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const submitClaim = () => {
    setError(null);
    setProof(null);
    setReceipt(null);
    setReleased(null);
    if (!policy) return;
    try {
      // Proof generation happens HERE, in the browser (Invariant 2).
      const generated = runtime.claimService.submitClaim(policy.policyId, now());
      setProof(generated);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const settle = () => {
    setError(null);
    if (!policy || !proof) return;
    try {
      const t = now();
      // The witness provider re-derives the witness in-process — the holder
      // secret never crosses a boundary.
      const witnessProvider = () => {
        const fresh = runtime.policyService.getPolicy(policy.policyId);
        if (fresh.trigger === null) throw new Error('trigger vanished');
        return {
          policyId: policy.policyId,
          holderSecret: runtime.privateLedger.secretFor(policy.policyId),
          settlementAmount:
            fresh.trigger.outcome && inCoverageWindow(fresh.terms, t)
              ? fresh.terms.payoutAmount
              : 0n,
          claimTime: t,
          triggerEvidence: fresh.trigger,
        };
      };
      const result = runtime.settlementService.settle(t, proof, policy.policyId, witnessProvider);
      runtime.claimService.receivePayout(policy.policyId, result.releasedAmount, t);
      setReceipt(result.receipt);
      setReleased(result.releasedAmount > 0n
        ? `${(Number(result.releasedAmount) / 1e9).toFixed(2)} tDUST credited privately`
        : 'no payout — trigger did not fire or window closed');
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <>
      <Head>
        <title>Claim — Condition</title>
      </Head>
      <div className="page-head">
        <h1 className="section-title">Submit a private claim</h1>
        <p className="section-sub">
          Your holder secret was generated in this browser and never leaves
          it. The proof is built client-side; only digests go public.
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
              <button className="button" onClick={() => enroll(p.policyId)}>
                Enroll
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
              <button className="button" onClick={() => fund(p.policyId)}>
                Fund to target
              </button>
              <button className="button" onClick={() => recordTrigger(p.policyId)}>
                Record 2-source trigger
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>3 · Claim + settle</h2>
        <label htmlFor="policy-select">Policy (triggered)</label>
        <select
          id="policy-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
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
            disabled={!selected || !claimable.some((p) => p.policyId === selected)}
          >
            Generate proof (client-side)
          </button>
          <button className="button" onClick={settle} disabled={!proof}>
            Settle privately
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
    </>
  );
}
