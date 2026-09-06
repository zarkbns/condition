// Verify — the public receipt verifier (BUILD_SPEC §5.3, §2.1 Invariant 3).
//
// A stranger's surface: NO wallet, NO session, NO connection gate. Any
// visitor pastes a receipt id and this page fetches the settlement
// contract's public state straight from the Midnight Preprod indexer
// (plain HTTPS), decodes it with the authoritative onchain-runtime
// artifacts, and recomputes the receipt digest with the same canonical
// hashing the circuits use. Nothing is read from localStorage, the session
// runtime, or any Condition server — verification is the browser vs the
// chain, alone.
//
// What a PASS proves: the claimed receipt id is exactly the digest of the
// public receipt fields the on-chain settle() circuit published (policy id,
// proof hash, trigger outcome, settled bool, timestamp) — on the contract
// checked, right now. What it does NOT prove: the payout amount (never
// disclosed — payout commitment stays private) or the claimant's identity
// (never on chain). Older-than-latest settlements cannot be recomputed from
// current state (the contract stores last_* only).

import Head from 'next/head';
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_INDEXER_HTTP,
  PREPROD_DEPLOYMENTS,
  verifyReceiptId,
  explorerUrl,
  type VerificationResult,
} from '../../src/utils/publicChain';

type Phase =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'network'; message: string }
  | { kind: 'done'; results: VerificationResult[]; matched: VerificationResult | null };

const PLACEHOLDER_RECEIPT = PREPROD_DEPLOYMENTS[0]!.receiptId;
const KNOWN_SETTLEMENT = PREPROD_DEPLOYMENTS[0]!.settlementAddress;

export default function VerifyPage() {
  const [query, setQuery] = useState('');
  const [address, setAddress] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const verify = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setPhase({ kind: 'verifying' });
    try {
      const { results, matched } = await verifyReceiptId(
        DEFAULT_INDEXER_HTTP,
        q,
        address.trim() || undefined,
      );
      setPhase({ kind: 'done', results, matched });
    } catch (err) {
      setPhase({
        kind: 'network',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [query, address]);

  // Deep link: /verify?receipt=0x…&settlement=0x… (shared by /receipt).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const receipt = params.get('receipt');
    if (receipt) {
      setQuery(receipt);
      const settlement = params.get('settlement');
      if (settlement) setAddress(settlement);
    }
  }, []);

  return (
    <>
      <Head>
        <title>Verify — Condition</title>
        <meta
          property="og:title"
          content="Condition — Verify a receipt from public chain data"
        />
      </Head>

      <div className="mode-banner live" role="status">
        <span className="mode-tag">Independent</span>
        <span className="mode-copy">
          This page does not use the app's session, wallet or runtime — it
          speaks to the Midnight Preprod indexer directly from your browser
          and reports what the chain says. Fresh incognito tab, same verdict.
        </span>
      </div>

      <div className="page-head">
        <span className="stamp">[ public verifier · no wallet · no session ]</span>
        <h1 className="section-title">Anyone can check. Nobody has to trust.</h1>
        <p className="section-sub">
          Paste a receipt id. This page fetches the settlement contract's
          public state live from the Midnight Preprod indexer and recomputes
          the receipt digest from those fields alone — the same deterministic
          scheme the on-chain circuit used to publish it. No wallet, no
          session, no API between you and the chain.
        </p>
      </div>

      <div className="card stage-card">
        <label htmlFor="verify-receipt-id">Receipt id (0x + 64 hex)</label>
        <input
          id="verify-receipt-id"
          placeholder={PLACEHOLDER_RECEIPT}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
          spellCheck={false}
        />
        <label htmlFor="verify-settlement-address">
          Settlement contract address — optional (defaults to Condition's
          documented Preprod deployments)
        </label>
        <input
          id="verify-settlement-address"
          placeholder={KNOWN_SETTLEMENT}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void verify(); }}
          spellCheck={false}
        />
        <div className="button-row">
          <button
            className="button primary"
            onClick={() => void verify()}
            disabled={phase.kind === 'verifying' || !query.trim()}
            aria-busy={phase.kind === 'verifying' || undefined}
          >
            {phase.kind === 'verifying' ? 'Fetching chain evidence…' : 'Verify against the chain'}
          </button>
          <button
            className="button"
            onClick={() => setQuery(PLACEHOLDER_RECEIPT)}
            title="Fill in the receipt id from the verified on-chain lifecycle"
          >
            Use the published receipt
          </button>
        </div>

        {phase.kind === 'network' && (
          <div className="notice error" role="alert">
            <span className="stamp">[ chain unreachable ]</span> {phase.message} —
            verification needs the Midnight indexer; nothing was verified.
          </div>
        )}

        {phase.kind === 'done' && <VerificationReport results={phase.results} matched={phase.matched} />}
      </div>

      <div className="card">
        <h2>What a verified receipt proves</h2>
        <p>
          A PASS means: the five public receipt fields (policy id, proof hash,
          trigger outcome, settled status, timestamp) currently sit in the
          settlement contract's on-chain state, and their deterministic
          digest equals the id you pasted. The settle circuit computed that
          digest on chain — it could not have been produced without a valid
          ZK settlement against the linked policy.
        </p>
        <h2>What stays private — by design</h2>
        <p>
          The settled amount is committed (not disclosed), and no claimant
          identity exists anywhere on chain. Verification shows that a fair
          settlement happened — never who claimed, never how much.
        </p>
      </div>

      <div className="privacy-note">
        <span className="lock">⚖</span>
        <span>
          This page runs entirely in your browser against
          {' '}<code>indexer.preprod.midnight.network</code>. It reads no
          session state, no wallet, no local storage — a fresh incognito tab
          gets the same verdict.
        </span>
      </div>
    </>
  );
}

function VerificationReport({ results, matched }: { results: VerificationResult[]; matched: VerificationResult | null }) {
  if (matched) {
    const receipt = matched.receipt!;
    return (
      <div className="notice success" role="status">
        <span className="stamp">[ verified — recomputed from live chain state ]</span>
        <div className="evidence" style={{ marginTop: 12 }}>
          <div className="evidence-row"><dt>receipt id</dt><dd title={receipt.recomputedId}>{receipt.recomputedId}</dd></div>
          <div className="evidence-row"><dt>policy id</dt><dd title={receipt.policyId}>{receipt.policyId}</dd></div>
          <div className="evidence-row"><dt>proof hash</dt><dd title={receipt.proofHash}>{receipt.proofHash}</dd></div>
          <div className="evidence-row"><dt>trigger outcome</dt><dd>{receipt.triggerOutcome ? 'FIRED' : 'NOT FIRED'}</dd></div>
          <div className="evidence-row"><dt>status</dt><dd><span className={`status ${receipt.settled ? 'SETTLED' : 'DENIED'}`}>{receipt.settled ? 'SETTLED' : 'DENIED'}</span></dd></div>
          <div className="evidence-row"><dt>timestamp</dt><dd>{new Date(Number(receipt.timestamp) * 1000).toISOString()}</dd></div>
          <div className="evidence-row">
            <dt>settlement contract</dt>
            <dd>
              <a href={explorerUrl(matched.settlementAddress)} target="_blank" rel="noreferrer">
                {matched.settlementAddress}
              </a>
            </dd>
          </div>
        </div>
        <p style={{ marginTop: 12 }}>
          Amount: <span className="redacted">████████</span> — the payout is
          committed, never disclosed. Claimant: <span className="redacted">████████</span>{' '}
          — identity is never on chain.
        </p>
        {matched.checks.length > 4 && <ChecksTable checks={matched.checks} />}
      </div>
    );
  }

  return (
    <div>
      {results.map((r, i) => (
        <div className="notice error" role="status" key={i}>
          <span className="stamp">[ not verified ]</span>{' '}
          This id does not recompute from the public state of settlement
          contract <code>{r.settlementAddress}</code>.
          {r.checks.map((c) => (
            <div className="evidence-row" key={c.id}>
              <dt>{c.label}</dt>
              <dd>{c.passed ? 'pass' : `fail — ${c.detail}`}</dd>
            </div>
          ))}
        </div>
      ))}
      {results.length === 0 && (
        <div className="notice error" role="status">
          <span className="stamp">[ not found ]</span> No known Condition
          settlement contract could be reached to check this id. If it was
          produced by a different deployment, verify against its settlement
          address above.
        </div>
      )}
      <p className="proof-note">
        Honest limit: the contract stores the LATEST settlement's public
        fields (<code>last_receipt_hash</code>, <code>last_status</code>,{' '}
        <code>last_timestamp</code>). A receipt superseded by a later
        settlement on the same contract can no longer be recomputed from
        current state — that is a property of the deployed contract design,
        not of this page.
      </p>
    </div>
  );
}

function ChecksTable({ checks }: { checks: VerificationResult['checks'] }) {
  return (
    <div style={{ marginTop: 12, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr><th>Evidence check</th><th>Result</th><th>Source</th></tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td><span className={`status ${c.passed ? 'SUCCESS' : 'FAILED'}`}>{c.passed ? 'PASS' : 'FAIL'}</span></td>
              <td className="mono-row">{c.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
