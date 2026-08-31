import Head from 'next/head';

export default function Home() {
  return (
    <>
      <Head>
        <title>Condition — private parametric insurance</title>
        <meta name="description" content="Policies are transparent. Claims settle privately. Fairness is proven publicly." />
      </Head>
      <section className="hero">
        <h1>
          Prove fairness<span className="accent">.</span>
          <br />
          Reveal nothing<span className="accent">.</span>
        </h1>
        <p>
          Condition is parametric insurance on Midnight. Policy terms and
          trigger events live on the public ledger. Who claimed — and the
          proof that their settlement was fair — never does.
        </p>
        <div className="hero-actions">
          <a className="button primary" href="/policy">Create a policy</a>
          <a className="button" href="/claim">Submit a private claim</a>
        </div>
      </section>

      <section className="grid three">
        <div className="card">
          <h2>🔓 Public</h2>
          <p>
            Policy terms, funding, cross-verified trigger readings,
            proof-hash receipts. Anyone can audit every settlement.
          </p>
        </div>
        <div className="card">
          <h2>🔒 Private</h2>
          <p>
            Claimant identity and the holder secret never leave your browser.
            Proofs are generated client-side, in-process.
          </p>
        </div>
        <div className="card">
          <h2>⚖️ Proven</h2>
          <p>
            A ZK proof binds eligibility, nullifier, and the deterministic
            payout — receipts verify from public data alone.
          </p>
        </div>
      </section>

      <section className="card flow">
        <h2>The flow</h2>
        <ol className="flow-steps">
          <li><strong>Create + fund</strong> a policy (public terms, public escrow)</li>
          <li><strong>Enroll</strong> — only a commitment <code>H(policy, secret)</code> is published</li>
          <li><strong>Trigger</strong> — two independent sources must agree (fail-closed)</li>
          <li><strong>Claim</strong> — a proof is generated in your browser</li>
          <li><strong>Receipt</strong> — proof hash + status go public; nothing about you does</li>
        </ol>
      </section>
    </>
  );
}
