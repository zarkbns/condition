// JourneyRail — the six lifecycle stages as one continuous product journey.
//
// The rail is the connective tissue between /policy, /claim and /receipt:
// the same six stages render on all three, so a first-time user always knows
// where they are, what is done, and what comes next. Stage completion is
// derived from REAL protocol state (policy status, escrow, commitment,
// trigger, receipt) — never faked.

import type { Policy, Receipt } from '../../../src/types';

export type StageId = 'policy' | 'fund' | 'event' | 'claim' | 'settle' | 'receipt';

export const STAGES: { id: StageId; n: string; label: string; href: string; blurb: string }[] = [
  { id: 'policy', n: '01', label: 'Policy', href: '/policy', blurb: 'Terms fixed, public, immutable' },
  { id: 'fund', n: '02', label: 'Fund', href: '/policy', blurb: 'Escrow covers payout + premium' },
  { id: 'event', n: '03', label: 'Verified Event', href: '/claim', blurb: 'Two independent sources agree' },
  { id: 'claim', n: '04', label: 'Claim', href: '/claim', blurb: 'Proof generated in your browser' },
  { id: 'settle', n: '05', label: 'Private Settlement', href: '/claim', blurb: 'Settles privately, spends the nullifier' },
  { id: 'receipt', n: '06', label: 'Proof / Receipt', href: '/receipt', blurb: 'Public receipt, nothing about you' },
];

/**
 * Which stages a given policy has genuinely passed. Claim/settle need
 * session state the ledger does not carry (the proof lives in memory), so
 * they are supplied by the page.
 */
export function completedStages(
  policy: Policy | null,
  opts: { claimed?: boolean; settled?: boolean; receipts?: Receipt[] } = {},
): StageId[] {
  const done: StageId[] = [];
  if (!policy) return done;
  done.push('policy');
  const target = policy.terms.payoutAmount + policy.terms.premium;
  if (policy.fundedAmount >= target && policy.enrollmentCommitment !== null) done.push('fund');
  if (policy.trigger !== null) done.push('event');
  if (opts.claimed) done.push('claim');
  if (opts.settled) done.push('settle');
  if (opts.settled || (opts.receipts ?? []).some((r) => r.policyId === policy.policyId)) done.push('receipt');
  return done;
}

export function JourneyRail({ current, done }: { current: StageId; done: StageId[] }) {
  const ids = STAGES.map((s) => s.id);
  const currentIdx = ids.indexOf(current);
  const doneSet = new Set(done);
  const reached = Math.max(currentIdx, ...done.map((d) => ids.indexOf(d)));

  return (
    <>
      {/* Wide viewports: the full rail. */}
      <nav className="rail" aria-label="Protocol journey">
        <ol className="rail-track">
          {STAGES.map((s, i) => {
            const isDone = doneSet.has(s.id);
            const isCurrent = s.id === current;
            const cls = isCurrent ? 'current' : isDone ? 'done' : 'todo';
            return (
              <li key={s.id} className={`rail-step ${cls}`}>
                <a href={s.href} aria-current={isCurrent ? 'step' : undefined}>
                  <span className="rail-n">{isDone && !isCurrent ? '✓' : s.n}</span>
                  <span className="rail-label">{s.label}</span>
                </a>
                {i < STAGES.length - 1 && (
                  <span className={`rail-link ${i < reached ? 'traversed' : ''}`} aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Narrow viewports: a counter, so the rail never eats vertical space. */}
      <div className="rail-compact" aria-label="Protocol journey progress">
        <span className="rail-compact-n">{STAGES[currentIdx]?.n ?? '—'} / 06</span>
        <span className="rail-compact-label">{STAGES[currentIdx]?.label}</span>
        <span className="rail-compact-done">{done.length} done</span>
      </div>
    </>
  );
}

/** Prev / next between journey pages, with the stage that awaits named. */
export function StageNav({ back, next }: {
  back?: { href: string; label: string };
  next?: { href: string; label: string };
}) {
  if (!back && !next) return null;
  return (
    <div className="stage-nav">
      {back ? (
        <a className="stage-nav-link" href={back.href}>
          <span className="stage-nav-dir">← previous</span>
          <span className="stage-nav-to">{back.label}</span>
        </a>
      ) : <span />}
      {next ? (
        <a className="stage-nav-link next" href={next.href}>
          <span className="stage-nav-dir">next →</span>
          <span className="stage-nav-to">{next.label}</span>
        </a>
      ) : <span />}
    </div>
  );
}
