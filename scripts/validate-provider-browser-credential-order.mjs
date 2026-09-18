import fs from 'node:fs';

const workflowPath = '.github/workflows/ux-cycle10-r5-proof.yml';
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
const firstProviderIndex = workflow.indexOf(providerRead);
const proofIndex = workflow.indexOf(proofCall);

if (floorIndex < 0) fail('PROVIDER_BROWSER_FLOOR_MISSING', 'credential-bearing hosted browser proof has no approved-browser security preflight.');
if (firstProviderIndex < 0) fail('PROVIDER_CREDENTIAL_READ_MISSING', 'expected Railway provider-variable retrieval is absent; policy needs review.');
if (proofIndex < 0) fail('PROVIDER_BROWSER_PROOF_MISSING', 'expected hosted browser proof invocation is absent; policy needs review.');
if (!(floorIndex < firstProviderIndex && firstProviderIndex < proofIndex)) {
  fail('PROVIDER_BROWSER_FLOOR_ORDER', 'security floor must run before the first provider variable retrieval, and provider retrieval must precede browser proof.');
}

if (!proof.includes('vars.WFM_STAGING_PASSWORD')) fail('PROVIDER_CREDENTIAL_CONSUMER_DRIFT', 'proof no longer reads WFM_STAGING_PASSWORD from the provider variable payload; refresh policy.');
if (!/spawn\(chrome/.test(proof)) fail('PROVIDER_BROWSER_CONSUMER_DRIFT', 'proof no longer launches the expected browser process; refresh policy.');
if (!proof.includes("delete process.env.RAILWAY_TOKEN")) fail('PROVIDER_TOKEN_BOUNDARY_DRIFT', 'Railway token must be removed from the proof process environment before browser launch.');
if (/['\"]chromium(?:-browser)?['\"]/.test(proof)) fail('PROVIDER_BROWSER_FALLBACK_DRIFT', 'credential-bearing proof must not fall back to unverified Chromium after approved-Chrome preflight.');
if (!workflow.includes("permissions:\n  contents: read")) fail('PROVIDER_WORKFLOW_PERMISSION_DRIFT', 'workflow must remain read-only at repository permission level.');
if (!workflow.includes('if: github.actor == github.repository_owner')) fail('PROVIDER_WORKFLOW_OWNER_BOUNDARY_DRIFT', 'workflow must remain repository-owner only.');

const firstFloorLine = workflow.slice(0, floorIndex).split('\n').length;
const firstProviderLine = workflow.slice(0, firstProviderIndex).split('\n').length;
const proofLine = workflow.slice(0, proofIndex).split('\n').length;

console.log(JSON.stringify({
  result: 'PASS',
  workflow: workflowPath,
  proof: proofPath,
  invariant: 'approved Google Chrome floor precedes every provider credential retrieval and credential-bearing browser proof',
  ordering: { floorLine: firstFloorLine, firstProviderLine, proofLine },
  checked: ['browser-floor-before-first-provider-read','provider-read-before-browser-proof','credential-consumer','browser-consumer','no-chromium-fallback','token-boundary','read-only-permissions','owner-only-execution']
}));
