import Head from 'next/head';

/**
 * Landing page — zkPass structural language (editorial serif display,
 * bracketed metadata stamps, dual-surface cards, hairline rhythm) in the
 * project's strict monochrome: black canvas, white type, graded grays,
 * zero chromatic accents. Tailwind is prefixed + preflight-free and scoped
 * to this page; app pages keep globals.css.
 */

const PILLARS = [
  {
    index: '01',
    tag: 'PUBLIC',
    title: 'Public',
    body:
      'Policy terms, funding, cross-verified triggers, proof-hash receipts. Anyone can audit.',
    note: 'ledger: public',
  },
  {
    index: '02',
    tag: 'PRIVATE',
    title: 'Private',
    body:
      'Claimant identity and holder secret never leave the browser. Client-side proofs.',
    note: 'ledger: shielded',
  },
  {
    index: '03',
    tag: 'PROVEN',
    title: 'Proven',
    body:
      'ZK proof binds eligibility, nullifier, and deterministic payout. Public receipts only.',
    note: 'verify: anyone',
  },
];

const FLOW = [
  {
    index: '01',
    title: 'Policy',
    body: 'Terms are fixed and public the instant the policy exists.',
  },
  {
    index: '02',
    title: 'Fund',
    body: 'Escrow must cover payout plus premium. The holder enrolls with a commitment only.',
  },
  {
    index: '03',
    title: 'Verified Event',
    body: 'Two independent sources must agree before a payout can fire.',
  },
  {
    index: '04',
    title: 'Claim',
    body: 'The proof is generated in the claimant’s browser, in-process.',
  },
  {
    index: '05',
    title: 'Private Settlement',
    body: 'Settles on the private ledger and spends the nullifier. No double claim.',
  },
  {
    index: '06',
    title: 'Proof / Receipt',
    body: 'The proof hash goes public. Nothing about you does.',
  },
];

function DotField() {
  // zkPass hero visual, translated: a pointillist dot field on the black
  // canvas — density via opacity steps, no fills, no gradients.
  const cols = 22;
  const rows = 14;
  const dots: { x: number; y: number; o: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dx = c - cols * 0.62;
      const dy = r - rows * 0.5;
      const d = Math.sqrt(dx * dx + dy * dy);
      const o = Math.max(0.08, 0.7 - d * 0.045);
      if (o < 0.12) continue;
      dots.push({ x: c * 14 + 8, y: r * 14 + 8, o });
    }
  }
  return (
    <svg
      viewBox={`0 0 ${cols * 14 + 8} ${rows * 14 + 8}`}
      className="tw-h-full tw-w-full"
      aria-hidden="true"
    >
      {dots.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.5} fill="#ffffff" opacity={p.o} />
      ))}
    </svg>
  );
}

function Stamp({ children }: { children: string }) {
  return (
    <p className="tw-font-mono tw-text-micro tw-uppercase tw-tracking-micro tw-text-dim">
      {children}
    </p>
  );
}

export default function Home() {
  return (
    <>
      <Head>
        <title>Condition — Prove fairness. Reveal nothing.</title>
        <meta
          name="description"
          content="Condition is parametric insurance on Midnight. Policies are transparent. Claims settle privately. Fairness is proven publicly."
        />
      </Head>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="tw-relative tw-overflow-hidden tw-border-b tw-border-line">
        <div className="tw-pointer-events-none tw-absolute tw-inset-y-0 tw-right-0 tw-hidden tw-w-[46%] tw-opacity-60 lg:tw-block">
          <DotField />
        </div>
        <div className="tw-mx-auto tw-grid tw-max-w-page tw-items-center tw-gap-16 tw-px-6 tw-py-24 md:tw-py-32 lg:tw-grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div>
            <Stamp>[ PARAMETRIC INSURANCE · MIDNIGHT ]</Stamp>
            <h1 className="tw-font-display tw-text-display tw-font-normal tw-text-ink tw-mt-7">
              Prove fairness.
              <br />
              <span className="tw-italic">Reveal nothing.</span>
            </h1>
            <p className="tw-mt-8 tw-max-w-[560px] tw-text-body tw-leading-relaxed tw-text-muted">
              Condition is parametric insurance on Midnight. Policy terms and
              trigger events live on the public ledger. Who claimed — and the
              proof that their settlement was fair — never does.
            </p>
            <div className="tw-mt-10 tw-flex tw-flex-wrap tw-items-center tw-gap-4">
              <a
                href="/policy"
                className="tw-rounded tw-bg-white tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-black hover:tw-bg-neutral-200"
              >
                Create a policy
              </a>
              <a
                href="/claim"
                className="tw-rounded tw-border tw-border-line-strong tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-ink hover:tw-border-white/50"
              >
                Submit a private claim
              </a>
            </div>
            <div className="tw-mt-12 tw-flex tw-flex-wrap tw-gap-3">
              {[
                '● LIVE ON PREPROD',
                'FULL LIFECYCLE · 8/8 TXS SUCCESS',
                '156 TESTS GREEN',
              ].map((s) => (
                <span
                  key={s}
                  className="tw-rounded-sm tw-border tw-border-line tw-px-3 tw-py-1.5 tw-font-mono tw-text-micro tw-uppercase tw-tracking-micro tw-text-faint"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>

          {/* Receipt panel — the thesis as an object: everything verifiable,
              the claimant redacted. */}
          <div className="tw-relative tw-hidden lg:tw-block">
            <div className="tw-border tw-border-line tw-bg-surface">
              <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-line tw-bg-raised tw-px-5 tw-py-3">
                <span className="tw-font-mono tw-text-micro tw-uppercase tw-tracking-micro tw-text-dim">
                  settlement receipt
                </span>
                <span className="tw-rounded-sm tw-border tw-border-line-strong tw-px-2 tw-py-0.5 tw-font-mono tw-text-micro tw-text-ink">
                  ✓ SETTLED
                </span>
              </div>
              <dl className="tw-space-y-3 tw-px-5 tw-py-6 tw-font-mono tw-text-xs tw-leading-relaxed">
                {[
                  ['receipt', '0x20acedd5…998608a2'],
                  ['proof', '0xf3c106f1…f508efe5'],
                  ['trigger', 'true · 3600 ≥ 3500'],
                  ['payout', 'deterministic'],
                ].map(([k, v]) => (
                  <div key={k} className="tw-flex tw-justify-between tw-gap-6">
                    <dt className="tw-text-faint">{k}</dt>
                    <dd className="tw-text-right tw-text-muted">{v}</dd>
                  </div>
                ))}
                <div className="tw-flex tw-justify-between tw-gap-6 tw-border-t tw-border-line tw-pt-3">
                  <dt className="tw-text-faint">claimant</dt>
                  <dd className="tw-text-ink">[ redacted ]</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pillars ──────────────────────────────────────────────────── */}
      <section className="tw-border-b tw-border-line">
        <div className="tw-mx-auto tw-max-w-page tw-px-6 tw-py-24 md:tw-py-32">
          <Stamp>[ THE BOUNDARY ]</Stamp>
          <h2 className="tw-font-display tw-text-heading tw-font-normal tw-mt-6 tw-max-w-[640px] tw-text-ink">
            Transparent by design.
            <br />
            <span className="tw-italic tw-text-dim">Private by construction.</span>
          </h2>
          <div className="tw-mt-16 tw-grid tw-gap-6 md:tw-grid-cols-3">
            {PILLARS.map((p) => (
              <article
                key={p.tag}
                className="tw-border tw-border-line tw-bg-canvas hover:tw-border-line-strong"
              >
                <div className="tw-flex tw-items-center tw-justify-between tw-border-b tw-border-line tw-bg-surface tw-px-6 tw-py-4">
                  <span className="tw-font-mono tw-text-micro tw-uppercase tw-tracking-micro tw-text-dim">
                    [ {p.tag} ]
                  </span>
                  <span className="tw-font-display tw-text-lg tw-text-faint">{p.index}</span>
                </div>
                <div className="tw-px-6 tw-py-8">
                  <h3 className="tw-font-display tw-text-heading-sm tw-font-normal tw-text-ink">
                    {p.title}
                  </h3>
                  <p className="tw-mt-4 tw-text-body tw-leading-relaxed tw-text-muted">
                    {p.body}
                  </p>
                  <p className="tw-mt-8 tw-font-mono tw-text-micro tw-uppercase tw-tracking-micro tw-text-faint">
                    {p.note}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Flow ─────────────────────────────────────────────────────── */}
      <section className="tw-border-b tw-border-line tw-bg-surface/40">
        <div className="tw-mx-auto tw-max-w-page tw-px-6 tw-py-24 md:tw-py-32">
          <Stamp>[ THE FLOW ]</Stamp>
          <h2 className="tw-font-display tw-text-heading tw-font-normal tw-mt-6 tw-text-ink">
            Six stages. <span className="tw-italic tw-text-dim">One proof.</span>
          </h2>
          <ol className="tw-mt-16 tw-grid tw-gap-px tw-border tw-border-line tw-bg-line md:tw-grid-cols-2 lg:tw-grid-cols-3">
            {FLOW.map((s) => (
              <li
                key={s.index}
                className="tw-bg-canvas tw-p-6 hover:tw-bg-surface md:tw-p-7"
              >
                <div className="tw-flex tw-items-baseline tw-justify-between">
                  <span className="tw-font-display tw-text-3xl tw-font-normal tw-text-ink">
                    {s.index}
                  </span>
                  <span className="tw-font-mono tw-text-micro tw-text-faint">/06</span>
                </div>
                <h3 className="tw-mt-6 tw-text-sm tw-font-medium tw-tracking-wide tw-text-ink tw-uppercase">
                  {s.title}
                </h3>
                <p className="tw-mt-3 tw-text-[13px] tw-leading-relaxed tw-text-dim">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section>
        <div className="tw-mx-auto tw-max-w-page tw-px-6 tw-py-24 tw-text-center md:tw-py-32">
          <Stamp>[ BEGIN ]</Stamp>
          <h2 className="tw-font-display tw-text-heading-lg tw-font-normal tw-mt-6 tw-text-ink">
            Fairness you can verify.
            <br />
            <span className="tw-italic tw-text-dim">Privacy you can prove.</span>
          </h2>
          <div className="tw-mt-10 tw-flex tw-flex-wrap tw-items-center tw-justify-center tw-gap-4">
            <a
              href="/policy"
              className="tw-rounded tw-bg-white tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-black hover:tw-bg-neutral-200"
            >
              Create a policy
            </a>
            <a
              href="/verify"
              className="tw-rounded tw-border tw-border-line-strong tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-ink hover:tw-border-white/50"
            >
              Verify a receipt
            </a>
            <a
              href="/explorer"
              className="tw-rounded tw-border tw-border-line-strong tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-ink hover:tw-border-white/50"
            >
              Explore the chain
            </a>
            <a
              href="/receipt"
              className="tw-rounded tw-border tw-border-line-strong tw-px-6 tw-py-3 tw-text-sm tw-font-medium tw-tracking-wide tw-text-ink hover:tw-border-white/50"
            >
              Verify a receipt
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
