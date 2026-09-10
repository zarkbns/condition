# FINAL WAVE 1 AUDIT REPORT — Condition

**Scope:** trustworthy privacy-preserving parametric insurance foundation — prove a valid
private claim without revealing claimant identity; produce a public receipt anyone can
independently verify. Wave 2+ features explicitly out of scope.
**Date:** 2026-09-09 · **Auditor/fixer:** agent pass over the full repository · **Baseline:**
deployed 2026-09-05 Preprod lifecycle (v1) → hardened v2 (this report).

---

## 1. Toolchain reality (probed empirically, 2026-09-08/09)

compactc 0.30.0 (language 0.22) — every claim below verified by compiling minimal contracts:

| Capability | Status |
|---|---|
| Caller identity (`caller_address` or similar) | **Does not exist** |
| In-circuit signature verification | **Does not exist** |
| Cross-contract calls | **Syntax parses; codegen rejects** ("not yet supported") |
| `Set<Bytes<32>>` member/insert on in-circuit-computed (disclosed) values | Works (keygen verified) |
| `persistentHash` composition, witness secrets, `disclose()` discipline | Works |
| JubJub (`ecMulGenerator`, `constructJubjubPoint`) | Works (unused — hash commitments suffice) |

Consequence: the strongest **real** authorization primitive available is capability-based
(ZK proof of knowledge of a 32-byte secret against an on-chain commitment) — the same
primitive the protocol already trusted for holder eligibility.

## 2. Issues found → severity → fix

| # | Issue | Severity | Fix (commit) |
|---|---|---|---|
| 1 | `withdraw()` callable by **anyone** — escrow accounting drain + premature policy closure | **Critical** | Insurer capability gate (`H_auth(policyId, insurer_secret)` bound at create) + underflow clamp (93a5b9e, c6fd72a) |
| 2 | `begin_settling`/`mark_settled`/`mark_denied` callable by **anyone** — attacker flips the policy to SETTLED before the real settle and **bricks the claimant's claim** | **Critical** | Settlement-capability gate: `authorize_settlement` (insurer-gated, exactly-once) registers `H_settle`; `mark_settled`/`mark_denied` assert it from TRIGGERED; `begin_settling` removed; machine ACTIVE→TRIGGERED→SETTLED\|DENIED→CLOSED (93a5b9e) |
| 3 | `record_trigger` accepted **arbitrary source digests** — anyone could force/suppress a trigger by inventing two "sources" | **High** | Per-policy oracle registry: exactly two credentials `H_oracle(policyId, source, secret)` (insurer-gated registration); record_trigger consumes BOTH credential secrets as private witnesses, requires distinct sources+credentials, agreeing outcomes; instance-scoped so cross-policy credential replay fails (93a5b9e, c6fd72a) |
| 4 | **No canonical trigger commitment** — accepted evidence lived only as loose fields; the settlement never bound claimant evidence to the recorded trigger (a claimant's proof hash covered self-chosen readings) | **High** | Canonical `trigger_digest_v` written by the policy at record_trigger (value-ascending order, ties by submission order — `first/second_reading_digest`), mirrored into the settlement at link, **re-derived in-circuit at settle from the claimant's private witnesses and asserted equal**; TS `zkProver` enforces the same binding (93a5b9e, 9ae8cb3) |
| 5 | `link()` accepted arbitrary caller-copied policy facts — **mirror settlements** deployable by anyone with copied public facts | **High** | `link()` is holder-capability-gated: only the enrolled holder can bind a settlement instance to a policy's fact set; residual trust documented (§4), bogus links publicly detectable via /verify cross-checks (93a5b9e) |
| 6 | `withdraw()` underflow when `funded < payout` on SETTLED — **bricked the insurer's own remainder forever** | **Medium** | Clamp `paid = min(payout, funded)`; adversarial test proves refund without underflow (93a5b9e, 79b1949) |
| 7 | **Browser permission prompt** ("access other apps and services on this device") on every page of trycondition.vercel.app | **Medium (UX/security)** | Root cause: every page load fetched `http://127.0.0.1:6300` (the CLI's local proof server) while probing Preprod endpoints → Chrome Local Network Access gate. Browser probe now skips the prover (no packet — wallet-delegated proving makes it irrelevant), loopback URL removed from the client bundle, CLI sets its own default and fails loud without it (3cefd2a) |
| 8 | SETTLING state asymmetry between layers | **Low** | On-chain and reference machines reconciled; SETTLING retained in the enum only for serialization compatibility |

## 3. Files changed (14 commits, 3cefd2a → 40083a0)

- **Contracts:** `contracts/policy.compact`, `contracts/settlement.compact`, `contracts/proofs.compact` — capability gates, oracle registry, canonical trigger digest, holder-gated link, clamped withdraw.
- **Reference runtime:** `src/core/hashing.ts` (+`insurerAuthOf`/`oracleEntryOf`/`settleAuthOf`/`triggerDigestOf`/`canonicalReadings`), `src/core/publicLedger.ts` (gated transitions, capability store), `src/core/zkProver.ts` (evidence binding), `src/services/{triggerService,settlementService}.ts`, `src/types/index.ts`.
- **Runtimes/wiring:** `src/utils/{preprodRuntime,preprodStack,laceConnector,asyncRuntime,localAsyncRuntime,midnight,managedContracts,publicChain}.ts`, `frontend/pages/claim.tsx`, `frontend/next.config.js`.
- **Artifacts:** `contracts/managed-compact/{policy,settlement,proofs}/contract` (v2 modules), `contracts/managed-compact/legacy-*` (frozen v1 decoders for the existing deployments), `frontend/public/contracts` (v2 keys/zkIR), `scripts/gen-vectors.ts` (regenerated golden pins).
- **Scripts:** `scripts/{demo-lifecycle,e2e-preprod,copy-zk-artifacts}.mjs/ts`.
- **Docs/tests:** `BUILD_SPEC.md` §12–12.2, `tests/authorization.test.ts` (new), `tests/{trigger,settlement,privacy,compactParity,twoLayerParity,preprodFailLoud}.test.ts`, `tests/helpers.ts`, `frontend/src/__tests__/claim.test.tsx`.

## 4. Honesty ledger — what is NOT solved (and why)

1. **Authorization is capability-based, not identity-based.** The toolchain has no caller
   identity. A capability secret can be delegated/shared by its owner; nothing on-chain can
   distinguish "the insurer" from "someone the insurer told". Same trust class the protocol
   already accepts for `holder_secret`. Mitigation for oracles/insurer actions is documented;
   staking/slashing (identity anchor) is Wave 2.
2. **Policy↔Settlement binding is holder-attested + publicly cross-checked, not chain-read.**
   Cross-contract calls are unsupported by the compiler. A compromised holder client could
   link wrong facts to its own settlement — the same trust domain as witness supply itself
   (AGENTS.md ZK-pipeline assumption), and /verify cross-checks both ledgers publicly.
3. **Insurer finalization residual.** The insurer (or the settlement capability holder it
   authorized) performs mark_settled/mark_denied. An insurer who refuses to finalize locks
   **their own** escrow (withdraw requires terminal state) — no holder loss in Wave 1; real
   escrow/native payouts are Wave 2 and close this properly.
4. **`settled_total` getter keys missing.** The on-device compiler was repeatedly RAM-killed
   (2.7GB, two agent sessions) during the heavy settle-circuit keygen; everything needed by
   the protocol flows (link, settle, denied_total, all 11 policy circuits) is committed. The
   unused getter's keys regenerate at redeploy time on an unconstrained host.
5. **`recorded_at` is caller-supplied.** No on-chain clock exists in this toolchain; the
   timestamp is bound into the trigger digest but its truth is oracle-asserted. On-chain time
   quorum is Wave 2.

## 5. Verification executed (all green)

- **Full suite:** 199/199 (12 files) — includes the new adversarial authorization suite
  (wrong-secret no-ops on withdraw/authorize/register_oracle/finalize, exactly-once and
  exactly-two cardinality, capability privacy, evidence substitution, forged receipt ids,
  escrow clamp, double-claim across proof regenerations).
- **Compiled-layer parity (real compactc output on real @midnight-ntwrk/compact-runtime):**
  8/8 — byte-identical policyId/termsDigest/commitment/trigger digest (incl. canonical
  order)/receiptId/proofHash between both layers, double-claim rejected on-circuit.
- **Demo lifecycle (`npm run dev`-style end-to-end on the compiled circuits):** ALL
  CROSS-LAYER PARITY CHECKS PASSED — full v2 flow including oracle registration,
  authorize_settlement, mark_settled; receipt stays amount/identity-free.
- **Frontend:** production build green (fresh BUILD_ID), client bundle contains **no
  loopback URL** and no seed value (env-var names in guarded reads only, per the established
  bundle-audit standard); frontend suites 9/9.
- **Fresh clone (git archive → npm install → `npm run build:frontend` → parity tests):**
  build exit 0, 59/59 tests — committed modules + artifacts load with no local compile.
- **Privacy invariants re-checked** after every contract/runtime change (BUILD_SPEC §2.1):
  the only claimant-derived public values remain the enrollment commitment and nullifier;
  all Wave-1 additions (insurerAuth, oracleRegistry, settleAuthCommit, triggerDigest) are
  one-way digests; the privacy suite's allow-lists enforce this mechanically.

## 6. Deployment status

- **REDEPLOYMENT REQUIRED — deferred to Wave 2.** The hardened contracts have new ledgers/circuits ⇒ new proving
  keys. The 2026-09-05 Preprod deployments remain on v1 and keep working: the committed
  legacy decoders let /verify and /explorer decode and verify them (generation-aware
  decoding in `publicChain.ts`). New deployments (when intentionally run via
  `npm run deploy`) must register in `PREPROD_DEPLOYMENTS` with `generation: 'v2'`.
  No deployment was performed in this pass; a deploy attempt on 2026-09-10 was halted
  after three unsuccessful submissions and the redeploy is Wave-2 work.
- Vercel: pushing main triggers an auto-redeploy of the site; the permission-prompt fix and
  read-only surfaces are live immediately; wallet-connected contract operations target the
  hardened circuits and require the redeploy first (they fail loudly, not silently).

## 7. Wave 2+ explicitly NOT implemented

Native asset escrow, actual private token payouts, oracle staking/slashing, decentralized
oracle marketplace, multi-holder policies, generalized receipt history, enterprise
dashboards, browser transaction-architecture rewrite.

## 8. Scored verdict

| Category | Score | Rationale |
|---|---|---|
| Contract Authorization | **8/10** | Every privileged transition gated by a ZK-proven capability and adversarially tested (state unchanged on every rejection); not 9+ because knowledge-based auth is delegatable and the insurer-finalization residual is documented, not eliminated. |
| Oracle Security | **7.5/10** | Registered, instance-scoped, distinct credentials; impersonation/cross-policy replay/one-actor-two-readings all fail closed with tests; not 9+ because credentials are delegatable and per-reading timestamps are caller-supplied (no on-chain clock). |
| Policy↔Settlement Binding | **7/10** | Holder-gated link + canonical trigger digest re-derived from claimant witnesses in-circuit is the strongest mechanism the toolchain supports; cross-contract reads unsupported, so the holder-client trust residual stands (publicly cross-checkable, not chain-preventable). |
| Privacy Security | **8.5/10** | Allow-list-enforced public surface; all new public values are one-way digests; evidence is re-derived in-circuit; no leak path found across the adversarial simulation (honest holder, malicious oracle, network latency, mid-proof crash). |
| Build/Deployment Reliability | **8/10** | Fresh-clone build + committed-artifact parity verified; reproducible Vercel path; generation-aware decoders keep old deployments verifiable; not 9+ for the missing `settled_total` keys (device RAM) and the pending redeploy. |
| **Overall Wave 1 Production Security** | **8/10** | The three critical/high authorization holes, the evidence-binding hole, and the mirror-settlement hole are closed with adversarial tests; the honest residuals are documented toolchain limits, not silent gaps. |
