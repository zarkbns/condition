// ModeBanner — states, on every product page, exactly which runtime is
// driving the workflow. This is the honesty layer: the interactive journey
// runs the REAL protocol logic client-side, but unless the live Preprod
// stack is wired, nothing it produces is written on-chain — and the banner
// says so in the same words every time.

import { useCondition } from './ConditionProvider';
import type { PreprodStatus } from '../../../src/utils/preprodRuntime';

/** The real Preprod deployment — public contract addresses, no secrets. */
export const PREPROD_DEPLOYMENT = {
  policyAddress: '00147690d83e6501e237774fbd934956253032010e3a7e3258e1c162f4d08a01',
  settlementAddress: '90f1d7ae19bdb9c531b003d95fd35ef4c507050390ad31e4289d172d72a8297c',
  receiptId: '0x20acedd59572ddc0b582bffcf236e43c414e005609bbef200a1ebf95998608a2',
  explorer: (address: string) => `https://preprod.midnightexplorer.com/contracts/0x${address}`,
} as const;

function short(hex: string, head = 10, tail = 6): string {
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function ModeBanner({ status }: { status: PreprodStatus }) {
  const { retry } = useCondition();
  const { mode } = status;

  if (mode === 'local') {
    return (
      <div className="mode-banner" role="status">
        <span className="mode-tag">Local reference</span>
        <span className="mode-copy">
          Real protocol logic — the same state machine, digests and client-side
          proofs the compiled circuits produce — running entirely in this
          browser. <strong>Nothing here is written on-chain.</strong> The live
          Preprod lifecycle is executed and verified through the CLI.
        </span>
        <span className="mode-actions">
          <a className="mode-link" href="https://github.com/zarkbns/condition/blob/main/docs/DEPLOYMENTS.md">
            see the real on-chain run →
          </a>
          <button className="badge-btn-inline" onClick={() => void retry()}>
            Retry Preprod
          </button>
        </span>
      </div>
    );
  }

  if (mode === 'preprod') {
    return (
      <div className="mode-banner live" role="status">
        <span className="mode-tag">Midnight Preprod</span>
        <span className="mode-copy">
          Connected to the live Preprod deployment
          {status.walletAddress ? ` as ${short(status.walletAddress)}` : ''}.
          Browser transaction submission is not wired yet — on-chain writes fail
          loud rather than simulate.
        </span>
      </div>
    );
  }

  return null;
}

/**
 * The deployed-run card: proof that this is not a mock. Public addresses,
 * explorer links and the receipt id from the verified on-chain lifecycle.
 */
export function DeployedProof() {
  return (
    <div className="card proof-card">
      <div className="proof-head">
        <span className="stamp">[ verified on midnight preprod ]</span>
        <span className="proof-ok">8/8 txs SUCCESS</span>
      </div>
      <p className="proof-note">
        The same lifecycle you are walking here ran end-to-end on the live
        Preprod network on 2026-09-05. Contracts, block heights and transaction
        hashes are public and independently re-verifiable.
      </p>
      <dl className="evidence">
        <div className="evidence-row">
          <dt>policy contract</dt>
          <dd>
            <a href={PREPROD_DEPLOYMENT.explorer(PREPROD_DEPLOYMENT.policyAddress)} target="_blank" rel="noreferrer">
              {short(PREPROD_DEPLOYMENT.policyAddress)}
            </a>
          </dd>
        </div>
        <div className="evidence-row">
          <dt>settlement contract</dt>
          <dd>
            <a href={PREPROD_DEPLOYMENT.explorer(PREPROD_DEPLOYMENT.settlementAddress)} target="_blank" rel="noreferrer">
              {short(PREPROD_DEPLOYMENT.settlementAddress)}
            </a>
          </dd>
        </div>
        <div className="evidence-row">
          <dt>public receipt</dt>
          <dd title={PREPROD_DEPLOYMENT.receiptId}>{short(PREPROD_DEPLOYMENT.receiptId)}</dd>
        </div>
      </dl>
      <a className="button ghost small" href="https://github.com/zarkbns/condition/blob/main/docs/DEPLOYMENTS.md">
        Full evidence &amp; re-verification queries
      </a>
    </div>
  );
}
