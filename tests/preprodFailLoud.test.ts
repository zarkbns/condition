// Doctrine guard: on-chain operations must never fabricate success.
//
// The no-silent-fallback rule (BUILD_SPEC §7, preprodRuntime header) applies
// doubly to on-chain writes: a placeholder "confirmed" tx hash or receipt id
// would surface in the UI as settlement evidence that never existed on
// chain. The live stack is wired now (CLI facade + browser DApp Connector),
// so what remains under test is the boundary: with no stack attached, every
// on-chain method must reject with PreprodUnavailableError — never resolve —
// and a refused connection must report its precise reason, not a generic one.

import { describe, expect, it, vi } from 'vitest';
import {
  PreprodOnChainClient,
  PreprodUnavailableError,
  preprodConfigFromEnv,
} from '../src/utils/preprodRuntime.js';
import { TriggerType, ComparisonOp } from '../src/types/index.js';

const NOW = 1_700_000_000;

function connectedClient(): PreprodOnChainClient {
  const client = new PreprodOnChainClient(preprodConfigFromEnv({}));
  // connectWallet() is environment-dependent (Lace/seed); the doctrine under
  // test is what happens AFTER a wallet is connected, so force the flag the
  // way connectWallet would.
  (client as unknown as { walletConnected: boolean }).walletConnected = true;
  return client;
}

async function rejectionOf(p: Promise<unknown>): Promise<PreprodUnavailableError> {
  try {
    await p;
  } catch (err) {
    return err as PreprodUnavailableError;
  }
  throw new Error('expected the on-chain operation to reject, but it resolved');
}

describe('preprod on-chain operations fail loud while unwired', () => {
  it('rejects with a wallet-kind error when no wallet is connected', async () => {
    const client = new PreprodOnChainClient(preprodConfigFromEnv({}));
    const err = await rejectionOf(
      client.createPolicyOnChain('insurer', {
        triggerType: TriggerType.TEMPERATURE,
        operator: ComparisonOp.GTE,
        threshold: 3500,
        payoutAmount: 5_000_000_000n,
        premium: 100_000_000n,
        coverageStart: NOW,
        expiry: NOW + 30 * 86_400,
      }, NOW, 0),
    );
    expect(err).toBeInstanceOf(PreprodUnavailableError);
    expect(err.kind).toBe('wallet');
    expect(client.getTxHistory()).toHaveLength(0);
  });

  it('rejects every on-chain write with a network-kind error even with a wallet', async () => {
    const client = connectedClient();
    const policyId = '0x' + 'ab'.repeat(32);
    client.policyContracts.set(policyId, '0xdeadbeef');

    const ops: Array<Promise<unknown>> = [
      client.createPolicyOnChain('insurer', {
        triggerType: TriggerType.TEMPERATURE,
        operator: ComparisonOp.GTE,
        threshold: 3500,
        payoutAmount: 5_000_000_000n,
        premium: 100_000_000n,
        coverageStart: NOW,
        expiry: NOW + 30 * 86_400,
      }, NOW, 0),
      client.fundOnChain(policyId, 5_000_000_000n, NOW),
      client.enrollOnChain(policyId, 100_000_000n, NOW),
      client.recordTriggerOnChain(policyId, 4000, 3600, '0x' + '01'.repeat(32), '0x' + '02'.repeat(32), NOW),
      client.settleOnChain(policyId, NOW, {
        policyId,
        holderSecret: '0x' + 'cd'.repeat(32),
        settlementAmount: 0n,
        claimTime: NOW,
        triggerEvidence: {
          readings: [
            { sourceId: '0x' + '01'.repeat(32), value: 4000 },
            { sourceId: '0x' + '02'.repeat(32), value: 3600 },
          ],
          outcome: true,
          observedValue: 3600,
          recordedAt: NOW,
        },
      }),
    ];

    for (const op of ops) {
      const err = await rejectionOf(op);
      expect(err).toBeInstanceOf(PreprodUnavailableError);
      expect(err.kind).toBe('network');
    }
  });

  it('leaves no fabricated records in the tx history', async () => {
    const client = connectedClient();
    const policyId = '0x' + 'ab'.repeat(32);
    client.policyContracts.set(policyId, '0xdeadbeef');

    await client.fundOnChain(policyId, 1n, NOW).catch(() => {});
    await client.settleOnChain(policyId, NOW, {
      policyId,
      holderSecret: '0x' + 'cd'.repeat(32),
      settlementAmount: 0n,
      claimTime: NOW,
      triggerEvidence: {
        readings: [
          { sourceId: '0x' + '01'.repeat(32), value: 4000 },
          { sourceId: '0x' + '02'.repeat(32), value: 3600 },
        ],
        outcome: true,
        observedValue: 3600,
        recordedAt: NOW,
      },
    }).catch(() => {});

    expect(client.getTxHistory()).toHaveLength(0);
    expect(client.settlementContracts.size).toBe(0);
  });
});

describe('browser connector connection attempts fail loud and specific', () => {
  function injectedWallet(wallet: Record<string, unknown>) {
    (globalThis as Record<string, unknown>)['window'] = { midnight: wallet };
  }

  function clearInjection() {
    delete (globalThis as Record<string, unknown>)['window'];
  }

  it('reports the missing capability instead of pretending to connect', async () => {
    injectedWallet({
      legacy: {
        rdns: 'com.legacy.wallet',
        name: 'Legacy Wallet',
        icon: '',
        apiVersion: '3.1.0',
        connect: () => Promise.reject(new Error('connect must not be attempted on a gated wallet')),
      },
    });
    try {
      const client = new PreprodOnChainClient(preprodConfigFromEnv({}));
      await expect(client.connectWallet(true)).resolves.toBe(false);
      const status = client.getStatus();
      expect(status.connected).toBe(false);
      expect(status.stackKind).toBeNull();
      // The UI shows this verbatim — "unsupported connector generation" is
      // actionable, "no wallet connected" is not.
      expect(status.lastError).toMatch(/^unsupported-version:/);
      expect(status.lastError).toContain('3.1.0');
    } finally {
      clearInjection();
    }
  });

  it('names the missing injection when nothing is connected', async () => {
    injectedWallet({});
    try {
      const client = new PreprodOnChainClient(preprodConfigFromEnv({}));
      await expect(client.connectWallet(true)).resolves.toBe(false);
      expect(client.getStatus().lastError).toMatch(/^no-wallet:/);
    } finally {
      clearInjection();
    }
  });

  it('discovery alone never attempts a connection', async () => {
    const connect = vi.fn(() => Promise.reject(new Error('must not connect on page load')));
    injectedWallet({ mnLace: { rdns: 'io.lace.midnight', name: 'Lace', icon: '', apiVersion: '4.0.1', connect } });
    try {
      const client = new PreprodOnChainClient(preprodConfigFromEnv({}));
      await expect(client.connectWallet(false)).resolves.toBe(true);
      expect(connect).not.toHaveBeenCalled();
      expect(client.walletsDiscovered.map((w) => w.id)).toEqual(['mnLace']);
      expect(client.getStatus().connected).toBe(false);
    } finally {
      clearInjection();
    }
  });
});
