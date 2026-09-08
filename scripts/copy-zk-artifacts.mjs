// Copy the browser-needed ZK artifacts (keys + zkIR) from contracts/managed/
// into frontend/public/contracts so a visitor's wallet can fetch them via
// @midnight-ntwrk/midnight-js-fetch-zk-config-provider (layout-identical:
// keys/<circuit>.prover|.verifier, zkir/<circuit>.bzkir).
//
// These artifacts are compiler OUTPUTS of the public circuits (Invariants 4/5
// — policy transparency; no witness data, no secrets) and are COMMITTED:
// Vercel clones have no contracts/managed (gitignored build output), so the
// committed copies under frontend/public/contracts are the deploy source of
// truth. Locally, a successful compile refreshes them; if neither source
// exists the build fails loudly — a silent artifact-less deploy would break
// browser proving at connect time.
//
// Deterministic and idempotent; run by build:frontend (and manually when
// contracts are recompiled). Vercel serves frontend/public verbatim.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managed = (name) => join(root, 'contracts', 'managed', name);
const out = join(root, 'frontend', 'public', 'contracts');

const CONTRACTS = ['policy', 'settlement'];

if (!existsSync(managed('policy'))) {
  if (existsSync(join(out, 'policy'))) {
    console.warn(
      'contracts/managed not found (fresh clone / Vercel) — keeping the committed ' +
        'zk artifacts in frontend/public/contracts.',
    );
    process.exit(0);
  }
  console.error(
    'no zk artifacts anywhere: contracts/managed is missing AND frontend/public/contracts ' +
      'is empty. Compile the contracts (npm run build:contracts) or restore the committed ' +
      'artifacts — the browser proving path cannot serve without them.',
  );
  process.exit(1);
}

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
