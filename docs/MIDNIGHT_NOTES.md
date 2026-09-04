# MIDNIGHT_NOTES.md — Integration Notes

Practical notes for building and running Condition on Midnight. Everything here was verified against the Midnight Compact language `0.16–0.22` toolchain and the official sample apps (RPS sample, Midnight.js SDK).

---

## 1. Toolchain reality check

| Tool | What it is | Runs on |
|---|---|---|
| `compact compile` | Native OCaml compiler (`@midnight-ntwrk/compact` CLI) | glibc Linux, macOS, Windows. **Not** Android/Termux (bionic libc, no OCaml native binaries published). |
| `@midnight-ntwrk/compact-runtime` | TS runtime for compiled contracts | Anywhere Node runs. |
| Midnight.js SDK (`@midnight-ntwrk/*`) | Wallet, network, devnet (`midnight-devnet` docker) | Node + Docker (devnet is a docker-compose stack). |
| Lace Wallet | Browser extension | Chrome/Firefox desktop. |

**Consequence for this repo:** the canonical Compact sources live in `contracts/` and compile on a standard machine (`npm run build:contracts`). On platforms where the compiler can't run (this project is developed on Android/Termux), the TypeScript reference runtime (`src/core` + `src/services`) is the executable specification — same state machine, same digests, same privacy rules — and it is what the test suite and dev frontend drive.

### Installing the compiler on a supported machine

```bash
npm install -g @midnight-ntwrk/compact
cd condition
npm run build:contracts
# → contracts/managed/policy, contracts/managed/settlement, contracts/managed/proofs
```

Output includes generated TS contract API + ZK proving/verification keys (`keys/*.prover|verifier`) and zkir files.

---

## 2. Compact language notes (0.16–0.22)

Verified syntax used in our contracts:

```compact
pragma language_version >= 0.16 && <= 0.22;
import CompactStandardLibrary;

export ledger my_state: Boolean;
witness local_secret(): Bytes<32>;

export pure circuit derive_pk(sk: Bytes<32>): Bytes<32> {
  return persistentHash<Vector<2, Bytes<32>>>([pad(32, "domain:tag"), sk]);
}
```

- `export ledger` — public contract state (the public ledger side).
- `witness` — private function whose value comes from the *caller's* local witness provider (never from the chain).
- `pure circuit` — deterministic ZK function; compiles to a proving/verification key pair. `export`ed pure circuits can be proven standalone.
- `circuit` (contract circuit) — a contract entry point that can read/write ledgers, take private (unannotated) args, and `disclose(...)` values to the public ledger.
- `persistentHash<Vector<N, Bytes<32>>>([...])` — the domain-separated hash primitive; `pad(32, "str")` makes a Bytes<32> domain tag from a string. This is how commitments/nullifiers/terms digests are built on-chain.
- `assert(cond, "message")` — fails the circuit; message is public.
- Unannotated circuit arguments are **private by default**; `disclose()` is required to publish anything.
- Contract state is per-instance: one `policy` + `settlement` instance per policy avoids unbounded ledger growth (Compact ledgers are primitive-valued).

### Witness providers (TypeScript side)

When driving a compiled contract you supply witnesses via a `WitnessProvider`:

```ts
const witnesses = {
  holder_secret: () => secretBytes,        // () => Bytes<32>
  trigger_evidence: () => reading,
};
```

In our reference runtime the same role is played by `claimService`'s in-memory holder secret. Witness values must never be logged or serialized (see `tests/zk.test.ts`).

---

## 3. Network & deployment

- **Devnet:** `midnight-devnet` via Docker (`docker compose up`), points at `http://localhost:8080/api/v1` etc. Not usable on Termux; use the reference runtime instead.
- **Preprod (current persistent testnet):** indexer `https://indexer.preprod.midnight.network/api/v3/graphql` (WS `…/api/v3/graphql/ws`) — v3 is the surface this repo's SDK generation is verified against (see `docs/DEPLOYMENTS.md`); node `https://rpc.preprod.midnight.network`, faucet `https://faucet.preprod.midnight.network`. No hosted prover — run a local Docker proof server (`localhost:6300`). Set `MIDNIGHT_NODE_URL` in `.env`. The old testnet-02 network is retired and its endpoints no longer resolve.
- **Deployment:** `npm run deploy` runs `deploy/deploy.ts`, compiles contracts (if toolchain present), deploys instances, and records addresses in `deploy/deployments.json`. On unsupported platforms it performs a dry-run against the reference runtime and says so.
- **Wallets:** Lace wallet via `midnight-js` `walletClient` in the browser build. The MVP frontend uses a local in-memory identity (no wallet) — the services API is wallet-agnostic on purpose.

## 4. Privacy decisions worth remembering

1. **Amount hiding via commitment:** the settlement contract verifies `H(amount)` binding, not the amount — so receipts can stay public without leaking payout sizes.
2. **Two domain separators for holder secret** (`condition:elig:v1` vs `condition:null:v1`): commitment and nullifier must not be linkable; different tags break equality-based linkage.
3. **Proof generation is always local.** No API route, no server function, ever constructs a proof. The Next.js app has zero API routes for exactly this reason — everything protocol-related runs in the browser.

## 5. Gotchas

- `Bytes<32>` literals: use `pad(32, "tag")`, not raw strings.
- Integer conversion to bytes for hashing: `(n as Field) as Bytes<32>`; our TS side mirrors this with a canonical little-endian 8-byte encoding inside the hash preimage.
- `disclose()` on a `Boolean` expression makes the *value* public, not the operands — safe for `p1_key == pk`-style checks.
- Never store `witness` results in a `ledger` without `disclose()` intentionality — the compiler keeps it private, which is what you want for secrets.
- Jest was considered; Vitest is used instead (ESM-native, matches the official Midnight sample toolchain, lighter on constrained platforms). Decision recorded in BUILD_SPEC §9.
