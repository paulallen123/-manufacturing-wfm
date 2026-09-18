import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflowPath = '.github/workflows/ux-cycle10-r4-proof.yml';
const proofPath = 'scripts/ux-cycle10-r4-hosted-proof.mjs';
const workflow = fs.readFileSync(workflowPath, 'utf8');
const proof = fs.readFileSync(proofPath, 'utf8');

function fail(code, message) {
  throw new Error(`${code}: ${message}`);
}

const floorCall = 'node scripts/browser-security-floor.mjs';
const providerRead = 'variable list';
const proofCall = 'node scripts/ux-cycle10-r4-hosted-proof.mjs';
const floorIndex = workflow.indexOf(floorCall);
const providerIndex = workflow.indexOf(providerRead);
const proofIndex = workflow.indexOf(proofCall);

if (floorIndex < 0) fail('PROVIDER_BROWSER_FLOOR_MISSING', 'credential-bearing hosted browser proof has no approved-browser security preflight.');
if (providerIndex < 0) fail('PROVIDER_CREDENTIAL_READ_MISSING', 'expected Railway provider-variable retrieval is absent; policy needs review.');
if (proofIndex < 0) fail('PROVIDER_BROWSER_PROOF_MISSING', 'expected hosted browser proof invocation is absent; policy needs review.');
if (!(floorIndex < providerIndex && providerIndex < proofIndex)) {
  fail('PROVIDER_BROWSER_FLOOR_ORDER', 'security floor must run before provider credential retrieval, which must run before browser proof.');
}

if (!proof.includes('vars.WFM_STAGING_PASSWORD')) fail('PROVIDER_CREDENTIAL_CONSUMER_DRIFT', 'proof no longer reads WFM_STAGING_PASSWORD from the provider variable payload; refresh policy.');
if (!/spawn\(chrome/.test(proof)) fail('PROVIDER_BROWSER_CONSUMER_DRIFT', 'proof no longer launches the expected browser process; refresh policy.');
if (!proof.includes("delete process.env.RAILWAY_TOKEN")) fail('PROVIDER_TOKEN_BOUNDARY_DRIFT', 'Railway token must be removed from the proof process environment before browser launch.');
if (!workflow.includes("permissions:\n  contents: read")) fail('PROVIDER_WORKFLOW_PERMISSION_DRIFT', 'workflow must remain read-only at repository permission level.');
if (!workflow.includes('if: github.actor == github.repository_owner')) fail('PROVIDER_WORKFLOW_OWNER_BOUNDARY_DRIFT', 'workflow must remain repository-owner only.');

const syntheticUnsafe = `steps:\n  - run: railway variable list --json > vars.json\n  - run: node scripts/browser-security-floor.mjs\n  - run: node scripts/ux-cycle10-r4-hosted-proof.mjs vars.json`;
assert.ok(syntheticUnsafe.indexOf('variable list') < syntheticUnsafe.indexOf(floorCall), 'negative fixture must model provider credential retrieval before security preflight.');

console.log(JSON.stringify({
  result: 'PASS',
  workflow: workflowPath,
  proof: proofPath,
  invariant: 'approved browser floor precedes provider credential retrieval and browser proof',
  checked: ['browser-floor-before-provider-read','provider-read-before-browser-proof','credential-consumer','browser-consumer','token-boundary','read-only-permissions','owner-only-execution']
}));
