// ConnectionGate — gates a page body behind the Preprod connection state.
//
// NO silent fallback: when Preprod is unreachable or the wallet is missing,
// this renders a clear warning with the correct action (Connect Wallet /
// Retry / dev-mode opt-in) instead of the page form. The page body only
// renders when the runtime is usable (preprod, or explicit local dev).

import type { ReactNode } from 'react';
import { useCondition } from './ConditionProvider';

export function ConnectionGate({ children }: { children: ReactNode }) {
  const { status, connectWallet, retry, switchToLocal } = useCondition();

  switch (status.mode) {
    case 'connecting':
      return (
        <div className="card">
          <h2>Connecting to Preprod…</h2>
          <p className="section-sub">
            Probing Midnight testnet endpoints and looking for a wallet.
          </p>
        </div>
      );

    case 'wallet-needed':
      return (
        <div className="card">
          <div className="notice error">
            <strong>Preprod is reachable, but no wallet is connected.</strong>
            <p style={{ marginTop: 8 }}>
              Condition talks to the real Midnight testnet contracts. You need a
              Lace wallet extension in this browser, or{' '}
              <code>MIDNIGHT_WALLET_SEED</code> set for the CLI path, to submit
              transactions. Nothing here runs a local simulation silently.
            </p>
          </div>
          <div className="button-row">
            <button className="button primary" onClick={connectWallet}>
              Connect Wallet
            </button>
            <button className="button" onClick={retry}>
              Retry connection
            </button>
            <button className="button" onClick={switchToLocal} title="Run the local reference runtime for development only">
              Use local dev mode
            </button>
          </div>
          <div className="privacy-note">
            <span className="lock">●</span>
            <span>
              Your holder secret is generated in this browser and never leaves
              it — even the on-chain path only publishes commitments,
              nullifiers, and proof hashes.
            </span>
          </div>
        </div>
      );

    case 'network-down':
      return (
        <div className="card">
          <div className="notice error">
            <strong>Preprod network is unreachable from this device.</strong>
            <p style={{ marginTop: 8 }}>
              The indexer, prover, or node could not be reached (
              {status.endpoints.indexer ? 'indexer ok' : 'indexer down'} ·{' '}
              {status.endpoints.prover ? 'prover ok' : 'prover down'} ·{' '}
              {status.endpoints.node ? 'node ok' : 'node down'}). On-chain
              interactions are impossible right now — we are not silently
              falling back to a simulation.
            </p>
          </div>
          <div className="button-row">
            <button className="button primary" onClick={retry}>
              Retry connection
            </button>
            <button className="button" onClick={switchToLocal} title="Run the local reference runtime for development only">
              Use local dev mode
            </button>
          </div>
        </div>
      );

    case 'local':
      // Explicit dev-mode opt-in. Render the page body but make the mode
      // unmistakable.
      return (
        <>
          <div className="notice" style={{ borderColor: '#f0f0f0', color: '#f0f0f0' }}>
            <strong>LOCAL DEV MODE</strong> — you explicitly switched to the
            local reference runtime. Transactions here are simulated in-browser
            and do <em>not</em> touch the Preprod chain. Switch back with{' '}
            <button
              className="badge-btn-inline"
              onClick={retry}
            >
              Retry Preprod
            </button>
            .
          </div>
          {children}
        </>
      );

    case 'preprod':
      return <>{children}</>;
  }
}