// /verify and /explorer page behavior (offline): these surfaces must render
// WITHOUT any wallet, session or network — that is their entire point — and
// every claim they make about the verification model must stay honest.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import VerifyPage from '../../pages/verify';
import ExplorerPage from '../../pages/explorer';
import { ConditionProvider } from '../components/ConditionProvider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('VerifyPage (public verifier)', () => {
  it('renders with no wallet and no runtime: verification is session-free', () => {
    render(
      <ConditionProvider>
        <VerifyPage />
      </ConditionProvider>,
    );
    // The honesty strip: this page never touches the app session.
    expect(screen.getByText(/does not use the app's session, wallet or runtime/i)).toBeTruthy();
    expect(screen.getByText(/anyone can check\. nobody has to trust\./i)).toBeTruthy();
    expect(screen.getByLabelText(/receipt id/i)).toBeTruthy();
    // The two honest boundaries of verification, stated up front.
    expect(screen.getByText(/what a verified receipt proves/i)).toBeTruthy();
    expect(screen.getByText(/what stays private — by design/i)).toBeTruthy();
  });

  it('does not verify anything on render — only on explicit action', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <ConditionProvider>
        <VerifyPage />
      </ConditionProvider>,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tells the visitor the incognito-tab property and the honest limits', () => {
    render(
      <ConditionProvider>
        <VerifyPage />
      </ConditionProvider>,
    );
    expect(screen.getAllByText(/fresh incognito tab/i).length).toBeGreaterThan(0);
  });
});

describe('ExplorerPage (chain surface)', () => {
  it('renders the explorer IA: search, network status, registry, privacy footer', () => {
    const fetchSpy = vi.fn(async () => {
      // jsdom has no network — every live panel must fail into an honest
      // "unreachable" state rather than fake rows.
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <ConditionProvider>
        <ExplorerPage />
      </ConditionProvider>,
    );
    expect(screen.getByText(/the public side of private settlements\./i)).toBeTruthy();
    expect(screen.getByLabelText(/search blocks, transactions, contracts or receipt ids/i)).toBeTruthy();
    expect(screen.getByText(/condition contract registry/i)).toBeTruthy();
    // the explorer's own privacy footer (the honesty layer)
    expect(screen.getAllByText(/private data is absent because the protocol never/i).length).toBeGreaterThan(0);
  });

  it('labels committed registry metadata as documentation, not live data', () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchSpy);
    render(
      <ConditionProvider>
        <ExplorerPage />
      </ConditionProvider>,
    );
    expect(screen.getByText(/labels are committed docs, state is live/i)).toBeTruthy();
  });
});
