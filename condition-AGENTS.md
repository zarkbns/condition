# AGENTS.md

This file is the operational contract for coding agents working on **Condition**.

Condition is a privacy-preserving parametric insurance protocol on Midnight. Policies are transparent. Claims settle privately. Fairness is proven publicly via zero-knowledge proofs — no claimant identity revealed, settlement correctness verified.

Primary reference: `BUILD_SPEC.md` (complete technical spec, circuit definitions, settlement flow). Design context: `README.md`, `docs/ARCHITECTURE.md`.

---

## 📦 Project Profile

* **Project:** Condition — Privacy-Preserving Parametric Insurance on Midnight
* **Track:** Privacy, Buildathon 2026 Fall
* **Stack:** Midnight (Compact contracts), TypeScript (Midnight.js SDK), Next.js frontend
* **Core ledger split:** Public ledger (policies, triggers, receipts) + Private ledger (claimant, claims, settlements) + ZK proofs
* **Build tooling:** `npm` (Node.js). Midnight Compact compiler built into Midnight.js SDK.
* **Test framework:** Jest or similar (confirm in package.json, don't re-decide it each session)

---

## Core Identity

You are operating inside a **privacy-first financial system**. Correctness and privacy are non-negotiable. Fairness proofs replace trust.

Every change must preserve:

* **Privacy boundary:** Claimant identity and claim data never leak to public ledger
* **ZK proof correctness:** Proofs are generated client-side, prove settlement logic, never reveal underlying values
* **Public receipt auditability:** Anyone can verify a receipt, no one learns who claimed or how much
* **Settlement finality:** Once settled privately and receipt published publicly, state is irreversible
* **Policy transparency:** Trigger conditions and policy terms are always public
* **No private data in contracts:** Settlement contracts reference proof hashes, not claimant data

---

## 🛠️ Verification & Build Commands

Before declaring any task complete, run and pass this sequence:

1. **Dependencies installed:** `npm install`
2. **Contracts compile:** `npm run build` (Midnight Compact compiler via SDK)
3. **Tests pass:** `npm run test`
4. **Frontend builds:** `npm run build:frontend` (or `npm run dev` if no separate build step)
5. **Privacy-correctness self-check:** after any change touching claim settlement, ZK proofs, or the public/private ledger split, re-read the affected paths against the invariants in Core Identity and `BUILD_SPEC.md`. This is a required reasoning step, not a script — do it before moving on.

Run this sequence yourself before calling anything done. Don't wait for a human to run it or ask whether you should.

---

## 🔒 Non-Negotiable Rules

**Always**

* Read `BUILD_SPEC.md` before modifying settlement logic, ZK circuits, or the public/private ledger interaction.
* Treat the privacy boundary as absolute: if claimant identity or claim details can ever leak to the public ledger, stop and fix it.
* Generate ZK proofs client-side. Never compute proof values server-side — that defeats privacy.
* Emit a clear public event for every policy state change and receipt publication.
* Keep settlement contracts lean — reference proof hashes and trigger outcomes, not claim data.
* Read secrets through `process.env` / `.env` files only.
* Write complete file structures — no truncated sections.
* Never hardcode private keys, mnemonics, or raw API keys anywhere in the repo.

**Never**

* Leak claimant identity to the public ledger.
* Compute ZK proof internals server-side or log proof witness data.
* Make settlements irreversible before a valid ZK proof is generated and verified.
* Trust trigger data from a single source — always cross-verify against policy terms.
* Introduce centralized oracle for claim verification (the whole point is ZK, not trusted third parties).
* Soften the public/private boundary to "make it simpler."
* Leave `// TODO` markers or partial implementations in place of working code.

**Ask first** (not really — these are yours to decide)

* This is where Handshake had "ask first" items. For Condition, you own: ZK circuit design, settlement thresholds, proof verification gas costs, frontend UX flow, deployment target (testnet vs. stagenet). Decide and flag them in commits if they touch privacy or settlement logic. Don't block on human approval for normal engineering calls.

---

## Privacy-Correctness Boundary

The six invariants in Core Identity (privacy boundary, ZK correctness, public auditability, settlement finality, policy transparency, no-private-data-in-contracts) are the project's thesis — prove fairness without revealing identity. You don't need sign-off to touch them, but the bar for visibility is higher:

* Make the call, implement it, and **state it plainly in the commit message** — which invariant, what you decided, and why. One or two sentences is enough.
* If you're designing a new ZK circuit or changing how proofs are verified, note the privacy assumption you're making (e.g., "assumes claimant runs proof generation locally, not via API").
* The one thing still off-limits without an explicit conversation: **removing or weakening the privacy boundary itself** (e.g., "let's send claimant email address to trigger verification"). Implementing *within* the invariant is your call; changing what the invariant *is* isn't.

---

## ZK Proof Pipeline

Previously an open decision — resolved: implement as follows:

* **Proof Generation:** Client-side (browser or Node.js backend running trusted code), using Midnight SDK
* **Proof Witness:** Never logged, never stored, never sent to servers — generated and verified in-process only
* **Proof Hash:** Published to public ledger as proof of settlement
* **Verification:** On-chain in settlement contract, referencing proof hash and trigger outcome
* **Audit Trail:** Public receipt shows proof hash + settlement outcome + timestamp; no witness data

This is the default. Document your approach in `BUILD_SPEC.md` if you choose a different strategy, but the above is reasonable and privacy-safe.

---

## Working Style

* Question your own assumptions about privacy, but resolve them yourself against `BUILD_SPEC.md` and the code rather than surfacing every question as a stop. If a path could leak claimant data, go verify it — don't leave it open.
* Research first, implement second — but implement. Don't leave a design question half-answered when you could just pick the reasonable answer.
* After implementing a change, mentally simulate: honest policy holder, malicious trigger oracle, network latency, frontend crashes mid-proof. Does privacy hold? Does fairness proof still work?
* Work is complete when the privacy invariants hold under all of the above, the build/test loop passes, and (for anything touching the Privacy-Correctness Boundary) the commit message says what you decided.

---

## Priority Order When Editing

1. Preserve privacy invariants (claimant privacy, ZK correctness, public auditability, settlement finality)
2. Keep proof generation and verification correct
3. Keep the state machine's event trail complete and auditable
4. Everything else (gas, frontend polish, performance)

---

## Developer Resources

* **MidSkills** (AI-based skills platform): https://midskills.sevryn.xyz/ — practical skills, examples, and workflows for building on Midnight. Start here for contract templates, Lace Wallet integration, and end-to-end dApp patterns.
* Midnight Buildathon: https://midnight.network/buildathon
* Midnight.js SDK: https://github.com/midnight-network/midnight-sdk
* Compact Language Docs: https://docs.midnight.network/
* ZK Circuit Patterns: https://docs.midnight.network/zk/circuits
* Privacy Best Practices: https://docs.midnight.network/privacy
* Example: Midnight RPS (Rock-Paper-Scissors with privacy): https://github.com/mashharuki/midnight-rps-sample-app — shows contract deployment, Lace Wallet connection, contract method calls

---

## Running Condition on Termux (mobile setup)

For anyone picking this repo up from Android/Termux:

```bash
pkg update -y && pkg upgrade -y
pkg install nodejs git -y
npm install -g pnpm  # or stick with npm
```

Then clone and set up:

```bash
git clone git@github.com:yourusername/condition-midnight.git
cd condition-midnight
npm install
npm run build
npm run test
```

**Using AgentRouter as the backend for code generation** (if using a code agent):

Add to `~/.bashrc`:

```bash
export OPENAI_API_KEY=your-agentrouter-key
export OPENAI_BASE_URL=https://agentrouter.org/v1
export OPENAI_MODEL=gpt-5.6-sol
```

Then reload and launch your agent:

```bash
source ~/.bashrc
opencode  # or claude, or whatever agent CLI you use
```

Git push over SSH works the same as any other Termux git setup — no extra config needed beyond your existing SSH key.
