// Synthetic, isolated engine proof. Does not access a deployment or payroll provider.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.version !== 'v22.23.2') throw Error('Use Node v22.23.2, matching the pinned product runtime.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.argv[2] || join(root, 'verification', 'vector-local-proof-' + Date.now()));
if (existsSync(output)) throw Error('OUTPUT_EXISTS: choose a fresh evidence directory.');
mkdirSync(output, {recursive: true});
const temporary = mkdtempSync(join(tmpdir(), 'vector-composed-proof-'));
const runtime = join(temporary, 'runtime');
const env = {...process.env, WFM_PROOF_REPO: root, WFM_PROOF_OUTPUT: output, WFM_LOCAL_RUNTIME: runtime};
const run = (args, log) => {
  try {
    const result = execFileSync(process.execPath, args, {cwd: root, env, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024});
    writeFileSync(join(output, log), result);
  } catch (error) {
    writeFileSync(join(output, log), String(error.stdout || '') + '\n' + String(error.stderr || '') + '\n' + error.message);
    throw error;
  }
};
try {
  run(['scripts/compose-vector-local-runtime.mjs', runtime], 'composition.log');
  copyFileSync(join(runtime, 'LOCAL_PROOF_PROVENANCE.json'), join(output, 'runtime-provenance.json'));
  const securityTests = readdirSync(join(root, 'security/runtime')).filter(file => file.endsWith('.test.cjs')).sort().map(file => 'security/runtime/' + file);
  run(['--test', ...securityTests, 'ux-overlay/vector-workflows.test.cjs', 'scripts/vector-repair-regressions.test.mjs', 'verification/vector-repair-20260920/runtime-provenance.test.mjs'], 'focused-tests.tap');
  run(['verification/vector-repair-20260920/api-journey-proof.mjs'], 'api-journey.log');
  run(['verification/vector-repair-20260920/payroll-journey-proof.mjs'], 'payroll-journey.log');
  const results = ['api-journey-results.json', 'payroll-journey-results.json'].map(file => JSON.parse(readFileSync(join(output, file), 'utf8')));
  writeFileSync(join(output, 'summary.json'), JSON.stringify({
    status: 'BUILT', completedAt: new Date().toISOString(), node: process.version,
    scope: 'Local synthetic authenticated API/SQLite and focused controller/security tests only.',
    focusedTests: 'PASS; exact counts in focused-tests.tap',
    engineChecks: results.reduce((sum, result) => sum + result.checks.length, 0),
    runtime: results[0].runtime,
    dockerAdmission: false, deployedJourney: false, externalProviderSubmission: false,
    railwayDatabasePreserved: false
  }, null, 2) + '\n');
  console.log('Local engine proof passed. Evidence: ' + output);
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
