// Deployment artifact manifest generator (BUILD_SPEC §11).
//
// Extracts REAL circuit identities from the compiled contracts
// (contracts/managed/) — sha256 of each circuit's verifier key and zkir —
// and writes deploy/artifacts.json, which IS committed: the repo carries
// verifiable evidence of exactly which circuits were compiled, with which
// compiler, even though the bulky managed/ dir stays gitignored.
//
// Run after `npm run build:contracts`:  npx tsx scripts/gen-artifacts.ts

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const managedDir = join(root, 'contracts', 'managed');
const CONTRACTS = ['proofs', 'policy', 'settlement'] as const;

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

interface CircuitArtifact {
  /** sha256 of the compiled .verifier key — the circuit's verifying identity. */
  verifierKeyHash: string;
  /** sha256 of the .zkir circuit IR. */
  zkirHash: string;
}

function contractArtifacts(name: string): {
  compiler: Record<string, string>;
  circuits: Record<string, CircuitArtifact>;
} {
  const dir = join(managedDir, name);
  const info = JSON.parse(readFileSync(join(dir, 'compiler', 'contract-info.json'), 'utf8')) as {
    'compiler-version': string;
    'language-version': string;
    'runtime-version': string;
    circuits: Array<{ name: string; pure: boolean; proof: boolean }>;
  };

  const circuits: Record<string, CircuitArtifact> = {};
  for (const circuit of info.circuits) {
    // Only impure contract entry-point circuits have keys+zkir; pure circuits
    // are compiled inline and carry no standalone artifacts.
    const verifier = join(dir, 'keys', `${circuit.name}.verifier`);
    const zkir = join(dir, 'zkir', `${circuit.name}.zkir`);
    if (!existsSync(verifier)) continue;
    circuits[circuit.name] = { verifierKeyHash: sha256(verifier), zkirHash: sha256(zkir) };
  }

  return {
    compiler: {
      compilerVersion: info['compiler-version'],
      languageVersion: info['language-version'],
      runtimeVersion: info['runtime-version'],
    },
    circuits,
  };
}

function main(): void {
  if (!existsSync(managedDir)) {
    console.error(
      'contracts/managed/ not found — run `npm run build:contracts` first ' +
        '(requires the Compact toolchain; on Android/Termux it runs via proot).',
    );
    process.exit(1);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    toolchain: 'compactc 0.30.0 (aarch64-unknown-linux-musl, via proot on Android/Termux)',
    contracts: {} as Record<string, ReturnType<typeof contractArtifacts>>,
    note:
      'Circuit identities extracted from real compactc 0.30.0 output: ' +
      'verifierKeyHash = sha256(<circuit>.verifier), zkirHash = sha256(<circuit>.zkir). ' +
      'The managed/ dir itself is gitignored (size); these hashes pin exactly what was compiled. ' +
      'Reproduce: npm run build:contracts && npx tsx scripts/gen-artifacts.ts',
  };

  let circuitCount = 0;
  for (const name of CONTRACTS) {
    if (!existsSync(join(managedDir, name))) {
      console.error(`missing compiled contract: ${name}`);
      process.exit(1);
    }
    manifest.contracts[name] = contractArtifacts(name);
    circuitCount += Object.keys(manifest.contracts[name]!.circuits).length;
  }

  const deployDir = join(root, 'deploy');
  mkdirSync(deployDir, { recursive: true });
  const out = join(deployDir, 'artifacts.json');
  writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`deploy/artifacts.json written: ${CONTRACTS.length} contracts, ${circuitCount} keyed circuits`);
  for (const name of CONTRACTS) {
    const circuits = Object.keys(manifest.contracts[name]!.circuits);
    console.log(`  ${name}: ${circuits.join(', ')}`);
  }
}

main();
