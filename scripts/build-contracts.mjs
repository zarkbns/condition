#!/usr/bin/env node
// Compile the canonical Compact contracts.
// The `compact` compiler is a native OCaml binary distributed for glibc
// Linux/macOS/Windows only; on platforms without it (e.g. Android/Termux)
// this script explains the situation and exits 0 — the TypeScript reference
// runtime (src/core + src/services) is the executable specification there.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = ['proofs', 'policy', 'settlement'];

function compilerAvailable() {
  const probe = spawnSync('compact', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

if (!compilerAvailable()) {
  console.log(
    [
      'compact compiler not found on this platform (expected on Android/Termux — bionic libc).',
      'Skipped contract compilation.',
      '',
      'The canonical sources in contracts/*.compact compile on glibc Linux/macOS/Windows:',
      '  npm install -g @midnight-ntwrk/compact',
      '  npm run build:contracts',
      '',
      'Until then, the TypeScript reference runtime (src/core + src/services) is the',
      'executable specification: same state machine, same digests, same privacy boundary.',
      'Run it with: npm test',
    ].join('\n'),
  );
  process.exit(0);
}

for (const name of contracts) {
  const source = join(root, 'contracts', `${name}.compact`);
  if (!existsSync(source)) {
    console.error(`missing contract source: ${source}`);
    process.exit(1);
  }
  console.log(`compiling contracts/${name}.compact ...`);
  execFileSync('compact', ['compile', source], {
    cwd: join(root, 'contracts'),
    stdio: 'inherit',
  });
}

mkdirSync(join(root, 'contracts', 'managed'), { recursive: true });
console.log('compact contracts compiled.');
