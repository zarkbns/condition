import Head from 'next/head';
import { useState } from 'react';
import { useCondition } from '../src/components/ConditionProvider';
import { ConnectionGate } from '../src/components/ConnectionGate';

export default function ReceiptPage() {
  const { runtime, status, receipts, txHistory } = useCondition();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const verify = async () => {
    if (!runtime) return;
    setResult(null);
    const q = query.trim();
    if (!q) return;
    setVerifying(true);
    try {
      const { valid, receipt } = await runtime.settlementService.verifyReceipt(q);
      if (valid && receipt) {
        setResult(
          `✅ VALID — ${receipt.status} · policy ${receipt.policyId.slice(0, 18)}… · ${new Date(
            receipt.timestamp * 1000,
          ).toISOString()}`,
        );
      } else {
        setResult(
          '❌ NOT FOUND or receipt id does not recompute from its public fields.',
        );
      }
    } catch (err) {
      setResult(`❌ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setVerifying(false);
    }
  };

  // Settlement tx hashes from the session
  const settleTx = txHistory.filter((t) => t.action === 'settle').slice(-5).reverse();

  return (
    <ConnectionGate>
      <Head>
        <title>Receipts — Condition</title>
      </Head>
      <div className="page-head">
        <h1 className="section-title">Public proof receipts</h1>
        <p className="section-sub">
          Anyone can verify any receipt using only public data — no identity,
          no amounts, no private state (Invariant 3).
          {status.mode === 'preprod' && (
            <span style={{ color: 'var(--accent)', marginLeft: 8 }}>
              · Preprod wallet: {status.walletAddress.slice(0, 8)}…
            </span>
          )}
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
          <button className="button primary" onClick={verify} disabled={verifying}>
            {verifying ? 'Verifying…' : 'Verify from public data'}
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

      {/* Settlement tx history */}
      {settleTx.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 0, overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Settle Tx</th>
                <th>Policy</th>
                <th>Tx Hash</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {settleTx.map((t, i) => (
                <tr key={`${t.txHash}-${i}`}>
                  <td><span className={`status ${t.status}`}>settle</span></td>
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

      <div className="privacy-note">
        <span className="lock">⚖️</span>
        <span>
          A receipt carries exactly: receiptId, policyId, proofHash,
          triggerOutcome, status, timestamp. No amount. No claimant. The
          privacy test suite mechanically enforces this shape.
        </span>
      </div>
    </ConnectionGate>
  );
}