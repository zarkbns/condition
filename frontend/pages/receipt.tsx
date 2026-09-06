import Head from 'next/head';
import { useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';
import { JourneyRail, StageNav } from '../src/components/JourneyRail';
import { ModeBanner, DeployedProof } from '../src/components/ModeBanner';

export default function ReceiptPage() {
  const { runtime, status, receipts, txHistory } = useCondition();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<'valid' | 'invalid' | 'error' | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    if (!runtime) return;
    setResult(null);
    setVerdict(null);
    const q = query.trim();
    if (!q) return;
    setVerifying(true);
    try {
      const { valid, receipt } = await runtime.settlementService.verifyReceipt(q);
      if (valid && receipt) {
        setResult(
          `Recomputed from public fields alone: ${receipt.status}, policy ${shortHash(
            receipt.policyId,
          )}, ${new Date(receipt.timestamp * 1000).toISOString()}. No amount. No claimant.`,
        );
        setVerdict('valid');
      } else {
        setResult('NOT FOUND — the receipt id does not recompute from its public fields.');
        setVerdict('invalid');
      }
    } catch (err) {
      setResult(`ERROR — ${err instanceof Error ? err.message : String(err)}`);
      setVerdict('error');
    } finally {
      setVerifying(false);
    }
  };

  const settleTx = txHistory.filter((t) => t.action === 'settle').slice(-5).reverse();

  return (
    <ConnectionGate>
      <Head>
        <title>Receipt — Condition</title>
      </Head>

      <ModeBanner status={status} />
      <JourneyRail current="receipt" done={receipts.length > 0 ? ['receipt'] : []} />

      <div className="page-head">
        <span className="stamp">[ stage 06 · proof / receipt ]</span>
        <h1 className="section-title">The receipt proves fairness. Not people.</h1>
        <p className="section-sub">
          A receipt carries exactly six public fields — receiptId, policyId,
          proofHash, triggerOutcome, status, timestamp. Anyone can recompute
          it; nobody learns who claimed (Invariant 3).
        </p>
      </div>

      <div className="card stage-card">
        <label htmlFor="receipt-id">Recompute a receipt id from the session ledger</label>
        <input
          id="receipt-id"
          placeholder="0x…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
        />
        <div className="button-row">
          <button className="button primary" onClick={verify} disabled={verifying || !query.trim()}
            aria-busy={verifying || undefined}>
            {verifying ? 'Verifying…' : 'Verify from public data'}
          </button>
        </div>

        {result && (
          <div className={`notice ${verdict === 'valid' ? 'success' : 'error'}`} role="status">
            <span className="stamp">
              {verdict === 'valid' ? '[ verified ]' : verdict === 'invalid' ? '[ not found ]' : '[ error ]'}
            </span>{' '}
            {result}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {receipts.length === 0 ? (
          <div className="empty-state" style={{ border: 0 }}>
            <img src="/brand/mark-white.png" alt="" aria-hidden="true" className="empty-mark" />
            <p>No receipts yet. Settle a claim to publish one.</p>
            <a className="button ghost small" href="/claim">← Back to the claim stage</a>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt</th><th>Policy</th><th>Proof hash</th>
                <th>Trigger</th><th>Status</th><th>Time</th><th>Independent check</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.receiptId}>
                  <td><code title={r.receiptId}>{shortHash(r.receiptId)}</code></td>
                  <td><code title={r.policyId}>{shortHash(r.policyId)}</code></td>
                  <td><code title={r.proofHash}>{shortHash(r.proofHash)}</code></td>
                  <td>{r.triggerOutcome ? 'FIRED' : '—'}</td>
                  <td><span className={`status ${r.status}`}>{r.status}</span></td>
                  <td className="mono-row">{new Date(r.timestamp * 1000).toISOString().slice(0, 16)}</td>
                  <td>
                    <a className="explorer-link" href={`/verify?receipt=${r.receiptId}`} title="Re-verify this receipt in a clean browser context — no session, no wallet">
                      verify ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {receipts.length > 0 && (
        <div className="card seal-card">
          <img src="/brand/mark-white.png" alt="" aria-hidden="true" className="seal-mark" />
          <div>
            <span className="stamp">[ journey complete ]</span>
            <p>
              {receipts.length} settlement{receipts.length === 1 ? '' : 's'} issued in this
              session. Every one is verifiable by a stranger, and not one of
              them names you.
            </p>
          </div>
        </div>
      )}

      <div className="privacy-note" style={{ marginTop: 16 }}>
        <span className="lock">⚖</span>
        <span>
          The check above recomputes against this session's ledger. The{' '}
          <a className="explorer-link" href="/verify">public verifier</a>{' '}
          does the same job with zero session state — straight from the
          Midnight Preprod indexer — and the{' '}
          <a className="explorer-link" href="/explorer">explorer</a> shows
          every receipt's public surface.
        </span>
      </div>

      {settleTx.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Settle Tx</th><th>Policy</th><th>Tx Hash</th><th>Status</th></tr>
            </thead>
            <tbody>
              {settleTx.map((t, i) => (
                <tr key={`${t.txHash}-${i}`}>
                  <td><span className={`status ${t.status}`}>settle</span></td>
                  <td><code title={t.policyId}>{shortHash(t.policyId)}</code></td>
                  <td>{t.txHash ? <code title={t.txHash}>{shortHash(t.txHash)}</code> : <span className="mono-row">—</span>}</td>
                  <td><span className="mono-row">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DeployedProof />

      <div className="privacy-note">
        <span className="lock">⚖</span>
        <span>
          A receipt carries exactly: receiptId, policyId, proofHash,
          triggerOutcome, status, timestamp. No amount. No claimant. The
          privacy test suite mechanically enforces this shape.
        </span>
      </div>

      <StageNav back={{ href: '/claim', label: 'Claim & private settlement' }} />
    </ConnectionGate>
  );
}

function shortHash(hex: string): string {
  return `${hex.slice(0, 10)}…${hex.slice(-6)}`;
}
