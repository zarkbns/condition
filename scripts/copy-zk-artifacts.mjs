// Sync the compiled-contract sources the app actually loads.
//
// Two jobs, both deterministic and idempotent:
//
// 1. contracts/managed-compact/<name>/contract (COMMITTED compiled modules —
//    the build-time-resolvable decoder/API source, see that README). When a
//    fresh local compile exists (contracts/managed/<name>/contract), refresh
//    the committed copies so every consumer loads the newest compiler output.
//    On a fresh clone / Vercel (no contracts/managed) the committed copies
//    are kept as-is — this is the normal path, never a warning condition.
//
// 2. frontend/public/contracts/<name>/{keys,zkir} (browser-served zk
//    artifacts for the wallet's ZK config provider — layout-identical to
//    the managed tree: keys/<circuit>.prover|.verifier, zkir/<circuit>.bzkir).
//    Refreshed from a local compile when present; the committed copies are
//    the deploy source of truth otherwise. These artifacts are compiler
//    outputs of the public circuits (Invariants 4/5 — no witness data, no
//    secrets). If NEITHER source exists the build fails loudly — a silent
//    artifact-less deploy would break browser proving at connect time.
//
// Run by build:frontend and dev (and manually after recompiling contracts).
// Vercel serves frontend/public verbatim.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managed = (name) => join(root, 'contracts', 'managed', name);
const committed = (name) => join(root, 'contracts', 'managed-compact', name);
const out = join(root, 'frontend', 'public', 'contracts');

const CONTRACTS = ['policy', 'settlement'];
const MODULE_CONTRACTS = [...CONTRACTS, 'proofs'];

const hasLocalModules = MODULE_CONTRACTS.every(
  (name) => existsSync(join(managed(name), 'contract', 'index.js')),
);
const hasCommittedModules = MODULE_CONTRACTS.every(
  (name) => existsSync(join(committed(name), 'contract', 'index.js')),
);

if (hasLocalModules && hasCommittedModules) {
  for (const name of MODULE_CONTRACTS) {
    const target = join(committed(name), 'contract');
    rmSync(target, { recursive: true, force: true });
    cpSync(join(managed(name), 'contract'), target, { recursive: true });
    // Sourcemaps are a local-dev nicety, not committed artifacts.
    rmSync(join(target, 'index.js.map'), { force: true });
  }
  console.log('refreshed committed modules in contracts/managed-compact from contracts/managed');
} else if (!hasCommittedModules) {
  console.error(
    'contracts/managed-compact is missing compiled contract modules — restore them from ' +
      'version control or run npm run build:contracts (then re-run this script).',
  );
  process.exit(1);
} else {
  console.log('no local compile found (fresh clone / Vercel) — keeping the committed ' +
    'contracts/managed-compact modules');
}

if (existsSync(managed('policy'))) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of CONTRACTS) {
    const base = managed(name);
    // Keys: both markers (prover keys for proving, verifier keys for reads).
    cpSync(join(base, 'keys'), join(out, name, 'keys'), { recursive: true });
    // zkIR: binary form only (.bzkir) — what ZKConfigProvider.getZKIR returns.
    mkdirSync(join(out, name, 'zkir'), { recursive: true });
    for (const f of readdirSync(join(base, 'zkir'))) {
      if (f.endsWith('.bzkir')) {
        cpSync(join(base, 'zkir', f), join(out, name, 'zkir', f));
      }
    }
    console.log(`copied zk artifacts: ${name}`);
  }
  console.log(`done -> ${out}`);
  process.exit(0);
}

if (existsSync(join(out, 'policy'))) {
  console.log('no local compile found (fresh clone / Vercel) — keeping the committed ' +
    'zk artifacts in frontend/public/contracts.');
  process.exit(0);
}

console.error(
  'no zk artifacts anywhere: contracts/managed is missing AND frontend/public/contracts ' +
    'is empty. Compile the contracts (npm run build:contracts) or restore the committed ' +
    'artifacts — the browser proving path cannot serve without them.',
);
process.exit(1);
