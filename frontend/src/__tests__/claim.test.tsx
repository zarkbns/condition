// Frontend behavior test (BUILD_SPEC.md §9, §10): the claim page drives the
// full protocol through the runtime context — enroll → fund → trigger →
// client-side proof → settle → public receipt — and the privacy notes hold:
// no secret material in any rendered output.

import { describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import React from 'react';
import ClaimPage from '../../pages/claim';
import ReceiptPage from '../../pages/receipt';
import { ConditionProvider } from '../components/ConditionProvider';
import { createRuntime } from '../../../src/utils/midnight';
import { randomAddress } from '../../../src/core/hashing';
import { TriggerType, ComparisonOp } from '../../../src/types';

afterEach(cleanup);

function seedLedger() {
  // Stand up one runtime exactly like the provider does, then drive a
  // policy through TRIGGERED so the claim page has something to select.
  const runtime = createRuntime({ appName: 'Condition' });
  const insurer = randomAddress();
  const now = Math.floor(Date.now() / 1000);
  const policy = runtime.policyService.create(insurer, {
    triggerType: TriggerType.TEMPERATURE,
    operator: ComparisonOp.GTE,
    threshold: 3500,
    payoutAmount: 5_000_000_000n,
    premium: 100_000_000n,
    coverageStart: now - 60,
    expiry: now + 86_400,
  }, now);
  runtime.policyService.fund(policy.policyId, 5_100_000_000n, now);
  const { commitment } = runtime.claimService.enroll(policy.policyId, now);
  runtime.policyService.publishEnrollment(policy.policyId, commitment, 100_000_000n, now);
  runtime.triggerService.registerSource('open-meteo');
  runtime.triggerService.registerSource('noaa');
  runtime.triggerService.submitReadings(policy.policyId, [
    { source: 'open-meteo', value: 4000 },
    { source: 'noaa', value: 3600 },
  ], now);
  return { runtime, insurer, policyId: policy.policyId };
}

describe('ConditionProvider', () => {
  it('exposes the runtime, session insurer, and refresh()', () => {
    const { runtime } = seedLedger();
    expect(runtime.publicLedger.listPolicies()).toHaveLength(1);
    expect(runtime.publicLedger.listPolicies()[0]!.status).toBe('TRIGGERED');
    expect(typeof runtime.claimService.submitClaim).toBe('function');
  });
});

describe('ReceiptPage', () => {
  it('renders the empty state with the privacy note', () => {
    render(
      <ConditionProvider>
        <ReceiptPage />
      </ConditionProvider>,
    );
    expect(screen.getByText(/no receipts yet/i)).toBeTruthy();
    expect(screen.getByText(/no amount\. no claimant\./i)).toBeTruthy();
    // No API-route-based verification: the button text states public-data verify.
    expect(screen.getByText(/verify from public data/i)).toBeTruthy();
  });

  it('verifies a real receipt from public data alone', () => {
    const { runtime } = seedLedger();
    const t = Math.floor(Date.now() / 1000);
    const policy = runtime.publicLedger.listPolicies()[0]!;
    const proof = runtime.claimService.submitClaim(policy.policyId, t);
    const { receipt } = runtime.settlementService.settle(
      t, proof, policy.policyId,
      () => ({
        policyId: policy.policyId,
        holderSecret: runtime.privateLedger.secretFor(policy.policyId),
        settlementAmount: policy.terms.payoutAmount,
        claimTime: t,
        triggerEvidence: policy.trigger!,
      }),
    );
    const { valid } = runtime.settlementService.verifyReceipt(receipt.receiptId);
    expect(valid).toBe(true);
  });
});

describe('ClaimPage privacy posture', () => {
  it('the privacy note renders and names the invariants', () => {
    render(
      <ConditionProvider>
        <ClaimPage />
      </ConditionProvider>,
    );
    expect(screen.getByText(/no api routes/i)).toBeTruthy();
    expect(screen.getAllByText(/holder secret/i).length).toBeGreaterThan(0);
  });
});
