#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/agent-check.mjs [--full]\nDefault: local JavaScript syntax and three fast invariant checks.\n--full: also run the existing ten-validator local suite. No hosted calls.');
  process.exit(0);
}
if (args.length > 1 || (args.length === 1 && args[0] !== '--full')) {
  console.error('Unknown arguments. Use --help or --full.');
  process.exit(2);
}
const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 22 || minor < 23 || (minor === 23 && patch < 2)) {
  console.error('Use the approved Node 22.23.2 runtime (22.x at or above 22.23.2).');
  process.exit(1);
}

// Walk only source/tooling trees, never unpacked runtime, dependencies, or live state.
const files = [];
function visit(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') visit(name);
    else if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name)) files.push(name);
  }
}
for (const directory of ['scripts', 'security', 'resilience', 'ux-overlay', 'legacy-redirect']) visit(directory);
files.sort();
const started = performance.now();
function run(label, commandArgs) {
  const start = performance.now();
  const result = spawnSync(process.execPath, commandArgs, { cwd: root, stdio: 'inherit' });
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  if (result.error || result.status !== 0) {
    console.error(`FAIL ${label} (${elapsed}s)${result.error ? `: ${result.error.message}` : ''}`);
    process.exit(result.status && result.status > 0 ? result.status : 1);
  }
  console.log(`PASS ${label} (${elapsed}s)`);
}
console.log(`Agent checks: Node ${process.versions.node}; root ${relative(process.cwd(), root) || '.'}`);
for (const file of files) run(`syntax ${file}`, ['--check', file]);
for (const check of ['validate-deployment', 'validate-vector-only-ui', 'validate-release-policy']) {
  run(check, [`scripts/${check}.mjs`]);
}
if (args[0] === '--full') run('existing local suite', ['scripts/run-zero-cost-ci.mjs']);
console.log(`AGENT_CHECK=PASS mode=${args[0] === '--full' ? 'full' : 'fast'} syntaxFiles=${files.length} elapsedSeconds=${((performance.now() - started) / 1000).toFixed(2)}`);
