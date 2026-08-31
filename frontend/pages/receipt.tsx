import Head from 'next/head';
import { useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';

export default function ReceiptPage() {
  const { receipts, runtime } = useCondition();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const verify = () => {
    setResult(null);
    const q = query.trim();
    if (!q) return;
    const { valid, receipt } = runtime.settlementService.verifyReceipt(q);
    if (valid && receipt) {
      setResult(
        `✅ VALID — ${receipt.status} · policy ${receipt.policyId.slice(0, 18)}… · ${new Date(
          receipt.timestamp * 1000,
        ).toISOString()}`,
      );
    } else {
      setResult('❌ NOT FOUND or receipt id does not recompute from its public fields.');
    }
  };

  return (
    <>
      <Head>
        <title>Receipts — Condition</title>
      </Head>
      <div className="page-head">
        <h1 className="section-title">Public proof receipts</h1>
        <p className="section-sub">
          Anyone can verify any receipt using only public data — no identity,
          no amounts, no private state (Invariant 3).
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <label htmlFor="receipt-id">Verify a receipt id</label>
        <input
          id="receipt-id"
          placeholder="0x…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="button-row">
          <button className="button primary" onClick={verify}>
            Verify from public data
          </button>
        </div>
        {result && <div className="notice">{result}</div>}
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {receipts.length === 0 ? (
          <div className="empty">
            No receipts yet. Settle a claim to publish one.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Policy</th>
                <th>Proof hash</th>
                <th>Trigger</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.receiptId}>
                  <td><code>{r.receiptId.slice(0, 16)}…</code></td>
                  <td><code>{r.policyId.slice(0, 16)}…</code></td>
                  <td><code>{r.proofHash.slice(0, 16)}…</code></td>
                  <td>{r.triggerOutcome ? '🔥 fired' : '—'}</td>
                  <td><span className={`status ${r.status}`}>{r.status}</span></td>
                  <td className="mono-row">
                    {new Date(r.timestamp * 1000).toISOString().slice(0, 16)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="privacy-note">
        <span className="lock">⚖️</span>
        <span>
          A receipt carries exactly: receiptId, policyId, proofHash,
          triggerOutcome, status, timestamp. No amount. No claimant. The
          privacy test suite mechanically enforces this shape.
        </span>
      </div>
    </>
  );
}
