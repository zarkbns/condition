// Doctrine guard: on-chain operations must never fabricate success.
//
// The no-silent-fallback rule (BUILD_SPEC §7, preprodRuntime header) applies
// doubly to on-chain writes: a placeholder "confirmed" tx hash or receipt id
// would surface in the UI as settlement evidence that never existed on
// chain. Until the provider stack is wired, every on-chain method must
// reject with PreprodUnavailableError — never resolve.

import { describe, expect, it } from 'vitest';
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
      }, NOW),
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
      }, NOW),
      client.fundOnChain(policyId, 5_000_000_000n, NOW),
      client.enrollOnChain(policyId, 100_000_000n, NOW),
      client.recordTriggerOnChain(policyId, 4000, 3600, '0x' + '01'.repeat(32), '0x' + '02'.repeat(32), NOW),
      client.settleOnChain(policyId, NOW),
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
    await client.settleOnChain(policyId, NOW).catch(() => {});

    expect(client.getTxHistory()).toHaveLength(0);
    expect(client.settlementContracts.size).toBe(0);
  });
});
