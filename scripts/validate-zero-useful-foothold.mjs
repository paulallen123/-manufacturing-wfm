#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const guardPath = 'security/zero-foothold/zero-useful-foothold-guard.mjs';
const testPath = 'security/zero-foothold/zero-useful-foothold-guard.test.mjs';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const result = spawnSync(process.execPath, ['--test', testPath], {
  stdio: 'inherit',
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

const sourceCommit = process.env.CIRCLE_SHA1 || process.env.GITHUB_SHA || null;
const receipt = {
  schemaVersion: 1,
  proofClass: 'DEVELOPMENT',
  claim: 'Zero Useful Foothold policy invariants pass the focused adversarial contract suite.',
  claimBoundary: 'This proves policy logic against the encoded attack cases only. It does not prove a deployed environment has zero vulnerabilities, does not prove live service inventory completeness, and is not a production release approval.',
  exactCandidate: {
    sourceCommit,
    node: process.version,
    guardSha256: sha256(guardPath),
    testSha256: sha256(testPath)
  },
  executed: {
    command: `${process.execPath} --test ${testPath}`,
    result: 'PASS'
  },
  scaleProfilesEncoded: ['1/1', 'small', '100', '500', '2000', '10000'],
  securityInvariants: [
    'explicit public exposure approval',
    'no long-lived runtime/build secrets',
    'no network package install during build',
    'immutable image identity',
    'non-root read-only runtime',
    'no unnecessary runtime package manager/shell',
    'default-deny egress',
    'short-lived cell-bound workload identity',
    'public tripwire',
    'independent dual telemetry for privileged services',
    'independent recovery authority',
    'protected/verified release evidence',
    'explicit least-privilege cross-cell edges',
    'agent action budget/kill switch/tool broker/no model-created authority'
  ],
  generatedAt: new Date().toISOString()
};

writeFileSync('zero-useful-foothold-proof.json', `${JSON.stringify(receipt, null, 2)}\n`);
console.log('ZERO_USEFUL_FOOTHOLD_DEVELOPMENT_PROOF=PASS');
