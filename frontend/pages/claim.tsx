import Head from 'next/head';
import { useMemo, useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';
import { JourneyRail, StageNav, completedStages, type StageId } from '../src/components/JourneyRail';
import { ModeBanner } from '../src/components/ModeBanner';
import type { ClaimProof, Receipt } from '../../src/types';
import { inCoverageWindow } from '../../src/core/payout';

export default function ClaimPage() {
  const { runtime, status, txHistory, refresh, policies, receipts } = useCondition();
  const [selected, setSelected] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<ClaimProof | null>(null);
  const [claimTime, setClaimTime] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [released, setReleased] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const enrollable = useMemo(
    () => policies.filter((p) => p.status === 'ACTIVE' && p.enrollmentCommitment === null),
    [policies],
  );
  const claimable = useMemo(
    () => policies.filter((p) => p.status === 'TRIGGERED'),
    [policies],
  );
  const awaitingEvent = useMemo(
    () => policies.filter((p) => {
      const target = p.terms.payoutAmount + p.terms.premium;
      return p.status === 'ACTIVE' && p.fundedAmount >= target && p.enrollmentCommitment !== null;
    }),
    [policies],
  );
  // The dropdown defaults to the first actionable policy, so the panels
  // below must read from that same default — otherwise the select shows a
  // policy while the stage beneath claims nothing is selected.
  const effectiveId = selected || awaitingEvent[0]?.policyId || claimable[0]?.policyId || '';
  const policy = policies.find((p) => p.policyId === effectiveId) ?? null;

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

  const recordTrigger = (policyId: string) =>
    run('record_trigger', async () => {
      if (!runtime) return;
      await runtime.triggerService.registerSource('open-meteo');
      await runtime.triggerService.registerSource('noaa');
      const row = await runtime.policyService.getPolicy(policyId);
      const fires =
        row.terms.operator === 'GT' || row.terms.operator === 'GTE'
          ? row.terms.threshold + 100
          : row.terms.threshold - 100;
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
      setClaimTime(null);
      setReceipt(null);
      setReleased(null);
      const t = now();
      const generated = await runtime.claimService.submitClaim(policy.policyId, t);
      setProof(generated);
      setClaimTime(t);
    });

  const settle = () =>
    run('settle', async () => {
      if (!runtime || !policy || !proof || claimTime === null) return;
      const t = now();
      // The witness must reproduce the proof-generation moment: the witness
      // digest (and the on-chain witness_digest_c) hashes claimTime, and
      // the payout was computed with the window evaluated at that moment —
      // a settle-time value would fail the proof-hash binding.
      const witnessProvider = () => ({
        policyId: policy.policyId,
        holderSecret: runtime.claimService.secretFor(policy.policyId),
        settlementAmount:
          policy.trigger?.outcome && inCoverageWindow(policy.terms, claimTime)
            ? policy.terms.payoutAmount
            : 0n,
        claimTime,
        triggerEvidence: policy.trigger ?? { readings: [], outcome: false, observedValue: 0, recordedAt: 0 },
      });
      const result = await runtime.settlementService.settle(t, proof, policy.policyId, witnessProvider as never);
      // The payout credit happens inside settle (AsyncClaimService contract:
      // settlementService credits the private ledger) — calling
      // receivePayout again here would double-credit.
      setReceipt(result.receipt);
      setReleased(result.releasedAmount > 0n
        ? `${(Number(result.releasedAmount) / 1e9).toFixed(2)} tDUST credited to your private ledger`
        : 'no payout — trigger did not fire or the window closed');
    });

  // Where the user actually is: no verified event yet → stage 03; event
  // fired but no proof → 04; proof in hand → 05 (settlement is the action).
  const current: StageId = proof ? 'settle' : policy?.trigger ? 'claim' : 'event';
  const furthest = completedStages(policy ?? awaitingEvent[0] ?? null, {
    claimed: proof !== null,
    settled: receipt !== null,
    receipts,
  });

  return (
    <ConnectionGate>
      <Head>
        <title>Claim — Condition</title>
      </Head>

      <ModeBanner status={status} />
      <JourneyRail current={current} done={furthest} />

      <div className="page-head">
        <span className="stamp">[ stage 03 · verified event ]</span>
        <h1 className="section-title">Two sources have to agree. Then nobody decides.</h1>
        <p className="section-sub">
          A payout fires only when two independent readings cross the same
          threshold — the trigger is recorded publicly, and from that moment
          the settlement amount is arithmetic, not judgement.
        </p>
      </div>

      {enrollable.length > 0 && (
        <div className="notice" role="status">
          <strong>{enrollable.length} policy still needs a holder.</strong>{' '}
          <a href="/policy">Enroll it on the fund stage →</a>
        </div>
      )}

      {awaitingEvent.length === 0 && claimable.length === 0 ? (
        <div className="card empty-state">
          <img src="/brand/mark-white.png" alt="" aria-hidden="true" className="empty-mark" />
          <p>
            No policy is funded and enrolled yet, so there is nothing to
            trigger. Create and fund one first.
          </p>
          <a className="button ghost small" href="/policy">← Back to policy &amp; fund</a>
        </div>
      ) : (
        <div className="card stage-card">
          <label htmlFor="event-select">Policy in play</label>
          <select
            id="event-select"
            value={effectiveId}
            onChange={(e) => { setSelected(e.target.value); setProof(null); setReceipt(null); }}
          >
            {[...awaitingEvent, ...claimable].map((p) => (
              <option key={p.policyId} value={p.policyId}>
                {shortHash(p.policyId)} · {p.terms.triggerType} {operatorGlyph(p.terms.operator)}{' '}
                {(p.terms.threshold / 100).toFixed(2)} · {p.status}
              </option>
            ))}
          </select>

          {policy && policy.trigger === null && (
            <>
              <div className="source-pair">
                <div className="source">
                  <span className="stamp">[ source a · open-meteo ]</span>
                  <strong>awaiting</strong>
                </div>
                <span className="source-vs">vs</span>
                <div className="source">
                  <span className="stamp">[ source b · noaa ]</span>
                  <strong>awaiting</strong>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => recordTrigger(policy.policyId)}
                  disabled={busy !== null}
                  aria-busy={busy === 'record_trigger' || undefined}
                >
                  {busy === 'record_trigger' ? 'Recording…' : 'Record 2-source trigger'}
                </button>
              </div>
            </>
          )}

          {policy && policy.trigger !== null && (
            <div className="event-fired">
              <div className="event-fired-head">
                <span className="stamp">[ event recorded ]</span>
                <span className={`status ${policy.status}`}>{policy.status}</span>
              </div>
              <dl className="evidence">
                <div className="evidence-row">
                  <dt>threshold</dt>
                  <dd>{operatorGlyph(policy.terms.operator)} {(policy.terms.threshold / 100).toFixed(2)}</dd>
                </div>
                <div className="evidence-row">
                  <dt>observed</dt>
                  <dd>{(policy.trigger.observedValue / 100).toFixed(2)}</dd>
                </div>
                <div className="evidence-row">
                  <dt>sources</dt>
                  <dd>{policy.trigger.readings.length} agreeing</dd>
                </div>
                <div className="evidence-row">
                  <dt>outcome</dt>
                  <dd>{policy.trigger.outcome ? 'FIRED' : 'no payout'}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}

      {/* ── Stage 04: claim ─────────────────────────────────────────── */}
      <div className="page-head" style={{ marginTop: 40 }}>
        <span className="stamp">[ stage 04 · claim ]</span>
        <h2 className="section-title">Prove you are the holder. Reveal nothing else.</h2>
        <p className="section-sub">
          The proof is built here, in this tab: that you hold the secret behind
          the published commitment, that your nullifier is fresh, and that the
          payout matches the deterministic terms. Only its hash ever goes out.
        </p>
      </div>

      <div className="card stage-card">
        <div className="button-row" style={{ marginTop: 0 }}>
          <button
            className="button primary"
            onClick={submitClaim}
            disabled={!policy || policy.trigger === null || busy !== null}
            aria-busy={busy === 'submit_claim' || undefined}
          >
            {busy === 'submit_claim' ? 'Proving…' : 'Generate proof (client-side)'}
          </button>
          <button
            className="button"
            onClick={settle}
            disabled={!proof || busy !== null}
            aria-busy={busy === 'settle' || undefined}
          >
            {busy === 'settle' ? 'Settling…' : 'Settle privately'}
          </button>
        </div>

        {!proof && policy?.trigger && (
          <p className="mono-row" style={{ marginTop: 14 }}>
            Ready — the event fired, so a claim can be proven against it.
          </p>
        )}
        {!policy?.trigger && (
          <p className="mono-row" style={{ marginTop: 14 }}>
            Waiting on stage 03: no verified event to claim against yet.
          </p>
        )}

        {error && (
          <div className="notice error" role="alert">
            <span className="stamp">[ error ]</span> {error}
          </div>
        )}

        {proof && (
          <div className="notice success">
            <strong>Proof generated in your browser.</strong>
            <dl className="evidence" style={{ marginTop: 10 }}>
              <div className="evidence-row"><dt>statement</dt><dd title={proof.statement}>{shortHash(proof.statement)}</dd></div>
              <div className="evidence-row"><dt>proof hash</dt><dd title={proof.proofHash}>{shortHash(proof.proofHash)}</dd></div>
              <div className="evidence-row"><dt>nullifier</dt><dd title={proof.publicInputs.nullifier}>{shortHash(proof.publicInputs.nullifier)}</dd></div>
              <div className="evidence-row"><dt>claimant</dt><dd className="redacted">[ redacted ]</dd></div>
            </dl>
          </div>
        )}
      </div>

      {/* ── Stage 05: private settlement ────────────────────────────── */}
      {receipt && (
        <>
          <div className="page-head" style={{ marginTop: 40 }}>
            <span className="stamp">[ stage 05 · private settlement ]</span>
            <h2 className="section-title">Settled privately. Auditable publicly.</h2>
            <p className="section-sub">
              The payout moved on the private ledger and the nullifier is spent
              — a second claim with the same secret can never settle again.
            </p>
          </div>

          <div className="card settle-card">
            <div className="settle-head">
              <span className={`status ${receipt.status}`}>{receipt.status}</span>
              <span className="mono-row">{released}</span>
            </div>
            <dl className="evidence">
              <div className="evidence-row"><dt>receipt id</dt><dd title={receipt.receiptId}>{shortHash(receipt.receiptId)}</dd></div>
              <div className="evidence-row"><dt>proof hash</dt><dd title={receipt.proofHash}>{shortHash(receipt.proofHash)}</dd></div>
              <div className="evidence-row"><dt>trigger</dt><dd>{receipt.triggerOutcome ? 'FIRED' : '—'}</dd></div>
              <div className="evidence-row"><dt>timestamp</dt><dd>{new Date(receipt.timestamp * 1000).toISOString().slice(0, 19)}Z</dd></div>
            </dl>
            <div className="button-row">
              <a className="button primary" href="/receipt">Publish &amp; verify the receipt →</a>
            </div>
          </div>
        </>
      )}

      {txHistory.length > 0 && (
        <div className="card" style={{ marginTop: 24, padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Action</th><th>Policy</th><th>Tx / reference</th><th>Status</th></tr>
            </thead>
            <tbody>
              {txHistory.slice(-6).reverse().map((t, i) => (
                <tr key={`${t.action}-${i}`}>
                  <td><span className={`status ${t.status}`}>{t.action}</span></td>
                  <td><code title={t.policyId}>{shortHash(t.policyId)}</code></td>
                  <td>{t.txHash ? <code title={t.txHash}>{shortHash(t.txHash)}</code> : <span className="mono-row">—</span>}</td>
                  <td><span className="mono-row">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="privacy-note">
        <span className="lock">●</span>
        <span>
          The holder secret lives in this tab&apos;s memory only. Reloading
          starts a fresh session — on the deployed path it lives in your
          wallet instead. Nothing on this page ever POSTs the secret anywhere;
          there are no API routes in this app at all.
        </span>
      </div>

      <StageNav
        back={{ href: '/policy', label: 'Policy & fund' }}
        next={receipt ? { href: '/receipt', label: 'Proof & receipt' } : undefined}
      />
    </ConnectionGate>
  );
}

function operatorGlyph(op: string): string {
  switch (op) {
    case 'GT': return '>';
    case 'GTE': return '≥';
    case 'LT': return '<';
    case 'LTE': return '≤';
    case 'EQ': return '=';
    default: return op;
  }
}

function shortHash(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
