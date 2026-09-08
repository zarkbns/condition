// Browser connector adapter (offline unit tests): wallet discovery, wallet
// selection, capability gating, and the connector-serialization boundary.
// The network-adjacent paths (prove/balance/submit against a REAL wallet)
// are exercised live by scripts/probe-browser-stack.ts — these tests pin
// the LOGIC and the honest-failure doctrine, not the wallet.

import { describe, expect, it } from 'vitest';
import {
  ConnectorError,
  discoverWallets,
  pickWallet,
} from '../src/utils/laceConnector.js';
import type { InitialAPI } from '@midnight-ntwrk/dapp-connector-api';

function fakeInitial(overrides: Partial<InitialAPI> = {}): InitialAPI {
  return {
    rdns: 'com.example.wallet',
    name: 'Example Wallet',
    icon: 'data:image/png;base64,x',
    apiVersion: '4.0.1',
    connect: (() => Promise.reject(new Error('not used in discovery'))) as InitialAPI['connect'],
    ...overrides,
  };
}

describe('wallet discovery', () => {
  it('returns empty when nothing injected', () => {
    expect(discoverWallets()).toEqual([]);
  });

  it('enumerates injected wallets with their metadata', () => {
    (globalThis as Record<string, unknown>)['window'] = {
      midnight: {
        mnLace: fakeInitial({ name: 'Lace', rdns: 'io.lace.midnight' }),
        oneAM: fakeInitial({ name: '1AM', apiVersion: '4.0.0' }),
      },
    };
    try {
      const wallets = discoverWallets();
      expect(wallets.map((w) => w.id).sort()).toEqual(['mnLace', 'oneAM']);
      expect(wallets.find((w) => w.id === 'mnLace')?.apiVersion).toBe('4.0.1');
    } finally {
      delete (globalThis as Record<string, unknown>)['window'];
    }
  });

  it('skips injections that are not connector Initial APIs', () => {
    (globalThis as Record<string, unknown>)['window'] = {
      midnight: { junk: { hello: true } as unknown as InitialAPI },
    };
    try {
      expect(discoverWallets()).toEqual([]);
    } finally {
      delete (globalThis as Record<string, unknown>)['window'];
    }
  });
});

describe('wallet selection', () => {
  it('prefers an explicitly requested wallet id', () => {
    const wallets = [
      { id: 'mnLace', rdns: 'io.lace.midnight', name: 'Lace', icon: '', apiVersion: '4.0.1' },
      { id: 'oneAM', rdns: 'com.oneam', name: '1AM', icon: '', apiVersion: '4.0.0' },
    ];
    expect(pickWallet(wallets, 'oneAM').id).toBe('oneAM');
  });

  it('throws no-wallet for a requested id that is not injected', () => {
    const wallets = [
      { id: 'mnLace', rdns: 'io.lace.midnight', name: 'Lace', icon: '', apiVersion: '4.0.1' },
    ];
    expect(() => pickWallet(wallets, 'nope')).toThrow(ConnectorError);
  });

  it('prefers Lace among equal candidates and demands connector v4+', () => {
    const wallets = [
      { id: 'oneAM', rdns: 'com.oneam', name: '1AM', icon: '', apiVersion: '4.0.0' },
      { id: 'mnLace', rdns: 'io.lace.midnight', name: 'Lace', icon: '', apiVersion: '4.0.1' },
    ];
    expect(pickWallet(wallets).id).toBe('mnLace');
  });

  it('fails with unsupported-version when only a pre-v4 connector exists', () => {
    const wallets = [
      { id: 'legacy', rdns: 'com.legacy', name: 'Legacy', icon: '', apiVersion: '3.1.0' },
    ];
    try {
      pickWallet(wallets);
      throw new Error('expected ConnectorError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect((err as ConnectorError).code).toBe('unsupported-version');
    }
  });
});

describe('serialization boundary markers (wasm-verified)', () => {
  // These literal marker strings are the serialization contract with the
  // wallet (dapp-connector-api README: "In relation to Ledger API ... this
  // method expects a serialized transaction of type Transaction<
  // SignatureEnabled, Proof, PreBinding>"). They were verified against
  // ledger-v8 8.1.0 wasm: an unproven tx round-trips under
  // ('signature','pre-proof','pre-binding') and a sealed tx reads back under
  // ('signature','proof','binding') — the SDK's own combination in the
  // indexer provider. If ledger-v8 ever renames a marker, this test breaks
  // BEFORE a visitor's transaction does.
  it('ledger-v8 round-trips an unproven tx under the unproven markers', async () => {
    const ledger = await import('@midnight-ntwrk/ledger-v8');
    const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
    const tx = ledger.Transaction.fromParts('preprod', undefined, undefined, intent);
    const bytes = tx.serialize();
    const round = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
    expect(JSON.stringify(round.identifiers())).toEqual(JSON.stringify(tx.identifiers()));
  });
});
