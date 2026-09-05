// NetworkBadge — shows Preprod connection state, wallet status, and actions.
//
// Placed in the nav bar by _app.tsx. Always visible. States:
//   connecting    — probing endpoints, searching for wallet
//   preprod       — green, wallet address, balance
//   wallet-needed — amber, Connect Wallet button
//   network-down  — red, endpoint health dots, Retry button
//   local         — green, "LOCAL DEV — reference runtime" label

import { type PreprodStatus } from '../../../src/utils/preprodRuntime';

export interface NetworkBadgeProps {
  status: PreprodStatus;
  onConnectWallet?: () => void;
  onRetry?: () => void;
  onSwitchToLocal?: () => void;
}

export function NetworkBadge(props: NetworkBadgeProps) {
  const { status, onConnectWallet, onRetry, onSwitchToLocal } = props;
  const { mode, label, walletConnected, walletAddress, endpoints } = status;

  const badgeClass =
    mode === 'preprod' ? 'net-badge-preprod' :
    mode === 'wallet-needed' ? 'net-badge-wallet-needed' :
    mode === 'network-down' || mode === 'connecting' ? 'net-badge-offline' :
    'net-badge-local';

  // Monochrome semantics: white = connected/live, dim = waiting, red = down.
  const dotColor =
    mode === 'preprod' ? '#f0f0f0' :
    mode === 'wallet-needed' ? '#8a8a8a' :
    mode === 'network-down' || mode === 'connecting' ? '#ff4d4d' :
    '#f0f0f0';

  const labelText =
    mode === 'preprod' ? 'PREPROD' :
    mode === 'wallet-needed' ? 'WALLET' :
    mode === 'network-down' ? 'DOWN' :
    mode === 'connecting' ? '…' :
    'DEV';

  return (
    <div className={`net-badge ${badgeClass}`} title={label}>
      <div className="net-badge-row">
        <span className="net-badge-dot" style={{ background: dotColor }} />
        <span className="net-badge-label" style={{ color: dotColor }}>{labelText}</span>
      </div>

      <div className="net-badge-row">
        {mode === 'preprod' && walletConnected && (
          <span className="net-badge-detail">
            {walletAddress.slice(0, 8)}…{walletAddress.slice(-4)}
          </span>
        )}
        {mode === 'wallet-needed' && (
          <button className="net-badge-btn" onClick={onConnectWallet}>
            Connect Wallet
          </button>
        )}
        {mode === 'network-down' && (
          <>
            <span className="net-badge-detail" style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
              <span className="net-badge-dot static" style={{ background: endpoints.indexer ? '#f0f0f0' : '#ff4d4d' }} />
              <span className="net-badge-dot static" style={{ background: endpoints.prover ? '#f0f0f0' : '#ff4d4d' }} />
              <span className="net-badge-dot static" style={{ background: endpoints.node ? '#f0f0f0' : '#ff4d4d' }} />
            </span>
            <button className="net-badge-btn" onClick={onRetry}>
              Retry
            </button>
          </>
        )}
        {mode === 'local' && (
          <span className="net-badge-detail">reference runtime</span>
        )}
        {mode === 'connecting' && (
          <span className="net-badge-detail">probing…</span>
        )}
      </div>

      {mode !== 'local' && mode !== 'connecting' && (
        <button className="net-badge-link" onClick={onSwitchToLocal} title="Switch to local dev runtime">
          dev mode
        </button>
      )}
    </div>
  );
}