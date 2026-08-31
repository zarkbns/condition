#!/usr/bin/env node
// Compile the canonical Compact contracts.
//
// Three environments, best-first:
//   1. Direct compactc install (this works on Android/Termux): the static
//      musl compactc.bin from midnightntwrk/compact releases runs natively
//      on aarch64 Android; it needs /tmp (proot bind) and, for zkir's BLS
//      parameter download, /etc/resolv.conf.
//   2. The `compact` wrapper CLI (glibc Linux / macOS / devcontainers).
//   3. Neither present: skip with an explanation and exit 0 — the
//      TypeScript reference runtime remains the executable specification.
//
// Output: contracts/managed/<name>/{contract,zkir,keys,compiler} — TypeScript
// contract APIs, ZK circuit IR (.zkir/.bzkir) and proving/verifying keys.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const contracts = ['proofs', 'policy', 'settlement'];

function wrapperAvailable() {
  const probe = spawnSync('compact', ['--version'], { stdio: 'ignore' });
  return probe.status === 0;
}

/** Locate a directly-installed compactc.bin (compact wrapper layout). */
function directCompactc() {
  const override = process.env['COMPACTC_BIN'];
  if (override && existsSync(override)) return override;
  const versionsDir = join(homedir(), '.compact', 'versions');
  if (!existsSync(versionsDir)) return null;
  for (const version of readdirSync(versionsDir)) {
    for (const target of readdirSync(join(versionsDir, version))) {
      const bin = join(versionsDir, version, target, 'compactc.bin');
      if (existsSync(bin)) return bin;
    }
  }
  return null;
}

const isAndroid = process.platform === 'android';

function compileAll(runCompile) {
  for (const name of contracts) {
    const source = join(root, 'contracts', `${name}.compact`);
    if (!existsSync(source)) {
      console.error(`missing contract source: ${source}`);
      process.exit(1);
    }
    const outDir = join(root, 'contracts', 'managed', name);
    mkdirSync(outDir, { recursive: true });
    console.log(`compiling contracts/${name}.compact ...`);
    runCompile(source, outDir);
  }
  console.log('compact contracts compiled: contracts/managed/{proofs,policy,settlement}');
}

try {
  const direct = directCompactc();
  if (direct) {
    console.log(`using compactc: ${direct}`);
    const termuxPrefix = '/data/data/com.termux/files/usr';
    const tmp = process.env['TMPDIR'] ?? (isAndroid ? join(termuxPrefix, 'tmp') : '/tmp');
    const binds = [`-b`, `${tmp}:/tmp`];
    const resolv = join(homedir(), 'resolv.conf');
    if (isAndroid && existsSync(resolv)) binds.push(`-b`, `${resolv}:/etc/resolv.conf`);
    const toolchainDir = dirname(direct);
    const env = {
      ...process.env,
      PATH: `${toolchainDir}:${process.env['PATH'] ?? ''}`,
      TMPDIR: tmp,
      SSL_CERT_FILE:
        process.env['SSL_CERT_FILE'] ??
        (isAndroid ? join(termuxPrefix, 'etc/tls/cert.pem') : process.env['SSL_CERT_FILE']),
    };
    // proot provides /tmp (and /etc/resolv.conf) for the static musl binary
    // on Android; on a regular Linux host it is a harmless pass-through.
    compileAll((source, outDir) => {
      execFileSync('proot', [...binds, direct, source, outDir], {
        cwd: join(root, 'contracts'),
        stdio: 'inherit',
        env,
      });
    });
  } else if (wrapperAvailable()) {
    compileAll((source, outDir) => {
      execFileSync('compact', ['compile', source, outDir], {
        cwd: join(root, 'contracts'),
        stdio: 'inherit',
      });
    });
  } else {
    console.log(
      [
        'No Compact compiler found (neither a direct compactc install nor the `compact` wrapper).',
        'Skipped contract compilation.',
        '',
        'Install options:',
        '  direct:  curl -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh',
        '           compact update 0.30.0   # pin the compiler (language 0.22)',
        '  wrapper: npm i -g @midnight-ntwrk/compact   (glibc Linux / macOS)',
        '',
        'Until then, the TypeScript reference runtime (src/core + src/services) is the',
        'executable specification: same state machine, same digests, same privacy boundary.',
        'Run it with: npm test',
      ].join('\n'),
    );
    process.exit(0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
