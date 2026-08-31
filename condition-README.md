# Condition – Privacy-Preserving Parametric Insurance on Midnight

**Status:** Wave 1 MVP — Privacy + Fraud Prevention

## What is Condition?

Condition is a parametric insurance protocol where policies are transparent, claims settle privately, and fairness is proven publicly without revealing claimant identity.

```
Policy Created → Funded → Event Verified → Claim Submitted (Private)
  → Settlement Executed (Private) → Proof Receipt Generated (Public)
```

**Core Innovation:** Zero-knowledge proofs prove settlement fairness without revealing claimant identity, claim amount, or personal details.

---

## The Problem

Traditional parametric insurance (e.g., Etherisc):
- ✅ Fast automatic payouts when triggers activate
- ✅ Clear, transparent trigger conditions
- ❌ Everything is public — privacy violation for claimants
- ❌ Users can't verify they were treated fairly without reading code

Web2 insurance:
- ✅ Privacy (your claim is private)
- ❌ You have to trust the company
- ❌ No proof of fair settlement

**Condition solves this:** Prove settlement is fair (via ZK) without revealing who claimed.

---

## How It Works

Condition separates ledgers and proofs:

| Layer | Contents | Visibility |
|-------|----------|------------|
| **Public Ledger** | Policies, trigger events, proof receipts | Everyone |
| **Private Ledger** | Claimant ID, claim data, settlement amount | Only claimant + settlement contract |
| **ZK Proofs** | Proof that settlement is correct | Public (proof hash only; witness never revealed) |

**Claim Flow:**
1. Claimant submits claim with proof they're policy holder (private)
2. Settlement service verifies trigger, computes settlement amount (private)
3. ZK proof generated client-side proving: "settlement is correct given policy terms" (private)
4. Proof hash published to public ledger as receipt
5. Anyone can verify: settlement was fair, proof is valid, no identity leaked

---

## Tech Stack

- **Smart Contracts:** Midnight Compact (privacy-first language)
- **Backend:** TypeScript + Midnight.js SDK
- **Frontend:** Next.js + React
- **ZK Proofs:** Native Midnight ZK (client-side generation)
- **Testing:** Jest (contracts) + Playwright (frontend)
- **Deployment:** Midnight testnet / stagenet

---

## Quick Start

```bash
# Install dependencies
npm install

# Build contracts (Midnight Compact)
npm run build

# Run tests
npm run test

# Start dev frontend
npm run dev
```

Then open http://localhost:3000 and:
1. Create a policy (public)
2. Fund it (public)
3. Trigger fires (public event)
4. Submit private claim
5. Receive proof receipt (public)

---

## Project Structure

```
condition-midnight/
├── AGENT.md                      # AI agent build instructions (READ THIS IF YOU'RE AN AGENT)
├── BUILD_SPEC.md                 # Complete technical specification
├── README.md                     # This file
│
├── contracts/
│   ├── policy.compact            # Policy creation, funding, trigger verification
│   ├── settlement.compact         # Settlement execution (references proofs, not claimant data)
│   └── proofs.compact            # ZK circuit definitions
│
├── src/
│   ├── services/
│   │   ├── policyService.ts      # Create, list, fund policies
│   │   ├── claimService.ts       # Submit claims, generate ZK proofs
│   │   ├── settlementService.ts  # Execute settlement, publish receipts
│   │   └── triggerService.ts     # Monitor and verify trigger events
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces (policy, claim, proof, receipt)
│   └── utils/
│       └── midnight.ts           # Midnight SDK initialization
│
├── frontend/
│   ├── pages/
│   │   ├── policy.tsx            # Policy creation form
│   │   ├── claim.tsx             # Claim submission form
│   │   └── receipt.tsx           # View proof receipt
│   ├── components/
│   │   └── [...React components]
│   └── styles/
│
├── tests/
│   ├── policy.test.ts            # Policy flow tests
│   ├── claim.test.ts             # Claim + ZK proof tests
│   └── settlement.test.ts        # Settlement logic tests
│
├── deploy/
│   ├── deployments.json          # Deployment addresses
│   └── deploy.ts                 # Deployment script
│
├── docs/
│   ├── ARCHITECTURE.md           # System design deep-dive
│   ├── WAVES.md                  # Wave 1, 2, 3 roadmap
│   └── MIDNIGHT_NOTES.md         # Midnight-specific integration notes
│
└── package.json
```

---

## Core Concepts

### Policy

A parametric insurance contract:
- **Insurer:** Address that funds the policy
- **Claimant:** Anyone can claim if they trigger the condition
- **Trigger Condition:** Objective, verifiable event (e.g., "temperature > 35°C on date X at location Y")
- **Payout Amount:** Deterministic amount if trigger is true
- **Expiry:** Policy expires after date X; no claims accepted after

Policies are **always public**. Trigger terms are **always verifiable**.

### Claim

A claim is a request to settle against a policy:
- **Policy ID:** Which policy
- **Trigger Evidence:** Data proving trigger occurred (e.g., oracle reading, historical data)
- **Proof of Policy Holder:** Credential proving claimant is eligible (private)
- **Settlement Amount:** Computed from trigger + policy terms (private)

Claims are **submitted privately**. No one learns who claimed unless they choose to reveal.

### ZK Proof

A zero-knowledge proof that settlement is fair:
- **Public Input:** Policy ID, trigger outcome, proof hash
- **Private Input (Witness):** Claimant ID, settlement amount, trigger evidence
- **Proof Statement:** "Given this policy and trigger outcome, the settlement amount is X"
- **Output:** Proof hash (published), proof verification succeeds on-chain, no witness revealed

Proofs are **generated client-side** (in browser or trusted backend). Proof generation is **never logged or stored**.

### Receipt

A public receipt proving settlement happened:
- **Policy ID:** Which policy
- **Proof Hash:** ZK proof identifier
- **Trigger Outcome:** Boolean (trigger activated or not)
- **Settlement Status:** "SETTLED" or "DENIED" (no amount shown)
- **Timestamp:** When receipt was issued

Receipts are **always public**. They prove fairness without revealing identity.

---

## Wave Progression

### Wave 1 (Current): Privacy + Fraud Prevention
- Private claim submission
- ZK-verified trigger logic
- Client-side proof generation
- Public proof receipts
- Basic policy and claim UI
- Test coverage: happy path, trigger failure, malicious proof

### Wave 2: Verifiable Fairness + Audit Trail
- Basis risk calculator (public)
- Dispute resolution via ZK
- Enhanced proof receipt detail
- Batch claim analytics (privacy-preserving aggregates)

### Wave 3: User Adoption + Compliance
- Educational dashboard
- Regulatory compliance receipts
- Integration with other Midnight dApps
- Mobile app (native proof generation)

---

## Why Midnight?

Midnight's architecture is perfect for Condition:

| Feature | Benefit |
|---------|---------|
| Private + Public Ledger | Claims on private ledger, receipts on public; clean separation |
| Client-Side ZK | Proof generation happens locally; no server-side witness exposure |
| Compact Language | Clean, developer-friendly; easier to audit |
| Native Privacy Proofs | No need to import external ZK libraries |

---

## Testing

### Contract Tests
```bash
npm run test
```

Tests cover:
- Policy creation and funding
- Trigger verification
- Claim processing
- Settlement execution
- ZK proof generation and verification

### Frontend Tests (E2E)
```bash
npm run test:e2e
```

Tests cover:
- Policy creation flow
- Claim submission
- Receipt viewing
- Error handling

---

## Building & Deployment

### Build Contracts
```bash
npm run build
```

Compiles Compact contracts to WASM via Midnight.js SDK.

### Deploy to Midnight Testnet
```bash
npm run deploy
```

Writes deployment addresses to `deploy/deployments.json`.

### Start Frontend
```bash
npm run dev
```

Connects frontend to deployed contracts. Set `.env.local`:
```
NEXT_PUBLIC_POLICY_CONTRACT_ADDRESS=...
NEXT_PUBLIC_SETTLEMENT_CONTRACT_ADDRESS=...
MIDNIGHT_NODE_URL=https://testnet.midnight.network/rpc
```

---

## Key Files to Read

**If you're an AI agent:**
- Start with `AGENT.md` (this is your contract)

**If you're understanding the design:**
- `BUILD_SPEC.md` (complete technical spec)
- `docs/ARCHITECTURE.md` (system design)
- `docs/MIDNIGHT_NOTES.md` (Midnight integration)

**If you're building contracts:**
- `contracts/*.compact` (policy, settlement, proofs)
- `src/services/settlementService.ts` (settlement logic)

**If you're building frontend:**
- `frontend/pages/*.tsx` (forms and flows)
- `src/services/claimService.ts` (claim logic)

---

## Architecture Highlights

### Privacy Boundary
Claimant identity and claim details exist only on the private ledger. Settlement contracts reference proof hashes and trigger outcomes, never claimant data.

### Settlement Finality
Once a ZK proof is generated and the receipt published, settlement is irreversible. Refunds are possible only via a new policy or dispute process (Wave 2).

### Proof Correctness
ZK proofs prove settlement logic is correct without revealing inputs. Proof generation is **always client-side** so no server ever sees the witness.

### Public Auditability
Anyone can verify a receipt using only public data. If they want to verify *their own* claim, they use their private proof.

---

## Roadmap

**Wave 1 (Current):**
- ✅ Privacy-preserving claim settlement
- ✅ ZK proof generation and verification
- ✅ Public proof receipts
- ✅ Basic UI

**Wave 2 (Next):**
- Basis risk calculator
- Dispute resolution
- Batch analytics

**Wave 3 (Future):**
- Mobile app
- Regulatory compliance
- Cross-chain integration

---

## Contributing

See `AGENT.md` for build and contribution guidelines.

---

## License

TBD

---

**Built for Midnight Buildathon 2026**

For questions or deep dives:
- Architecture: see `docs/ARCHITECTURE.md`
- Midnight specifics: see `docs/MIDNIGHT_NOTES.md`
- Technical spec: see `BUILD_SPEC.md`
