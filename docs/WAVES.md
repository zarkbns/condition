# WAVES.md — Product Roadmap

## Wave 1 — Privacy + Fraud Prevention (current, implemented)

**Goal:** prove the thesis — policies transparent, claims private, fairness publicly verifiable.

- [x] Public policy creation with immutable terms (`policyService`, `policy.compact`)
- [x] Escrow funding + premium collection
- [x] Private enrollment via commitment (identity never published)
- [x] 2-source trigger cross-verification, fail-closed on conflict
- [x] Client-side ZK proof generation (eligibility + nullifier + payout binding)
- [x] On-style settlement with nullifier double-claim protection
- [x] Public proof receipts (hash + status + timestamp; no amounts, no identities)
- [x] Policy expiry (lazy) + insurer withdrawal + close
- [x] Test coverage: happy path, trigger failure/conflict, malicious/forged proof, double-claim, privacy invariants
- [x] Frontend: dashboard, policy creation, private claim, receipt browser

**Exit criteria:** full test suite green; privacy invariant tests green; frontend builds.

## Wave 2 — Verifiable Fairness + Audit Trail

**Goal:** make fairness *quantifiable* and disputable.

- Basis-risk calculator (public): how well does the trigger track the actual loss?
- Dispute resolution via ZK: prove an alternative reading satisfies the same terms digest
- Enhanced receipts: include trigger source list + dispute status
- Batch claim analytics: privacy-preserving aggregates (counts, distribution digests — never per-claimant)
- Multi-holder policies: enrollment commitment → Merkle accumulator; settlement proofs become membership proofs
- On-chain time quorum (replace caller-supplied `now`)

## Wave 3 — Adoption + Compliance

**Goal:** make it usable by real insurers and regulators.

- Educational dashboard (how parametric insurance works, why ZK matters)
- Regulatory compliance receipts (proof of solvency, coverage attestations)
- Mobile app with native proof generation
- Cross-dApp integration (Midnight ecosystem)
- Reinsurance marketplaces (policy risk tokens)
