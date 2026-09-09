# contracts/managed-compact/legacy-* — v1 (pre-hardening) decoders

Compiler outputs of the PRE-hardening contract sources (git history,
2026-09-05 generation), committed verbatim:

    legacy-{policy,settlement,proofs}/contract/index.js
    legacy-{policy,settlement,proofs}/contract/index.d.ts

## Why they exist

The Wave-1 hardening (capability authorization, oracle registry, canonical
trigger digest) changed the ledger layout of both contracts. The v2 decoders
in the sibling directories therefore cannot read the on-chain state of the
2026-09-05 Preprod deployments (see docs/DEPLOYMENTS.md and
PREPROD_DEPLOYMENTS in src/utils/publicChain.ts, generation: 'v1').

These legacy modules keep /verify and /explorer able to decode and
independently verify the EXISTING deployments — the published receipt stays
verifiable from public data with zero sessions. publicChain picks the
decoder by deployment generation.

## Constraints

- legacy-* modules are frozen: never regenerate them from the current
  sources, never edit by hand. They are the compiler's own output of the
  historical sources and must remain byte-identical to what the v1
  contracts were deployed with (module version checks still apply).
- New deployments always use the v2 modules and register with
  generation: 'v2'.
