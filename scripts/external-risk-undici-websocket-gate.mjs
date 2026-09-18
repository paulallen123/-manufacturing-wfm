import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const manifestPath = path.join(root, 'DEPLOYMENT_MANIFEST.json');
const policyPath = path.join(root, 'security/external-risk/advisories/CVE-2026-85024.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

function fail(message) {
  console.error(`EXTERNAL_RISK_GATE_FAIL: ${message}`);
  process.exitCode = 1;
}

const expectedAffectedImage = policy.wfm_assessment.node_image;
if (manifest.node_image !== expectedAffectedImage) {
  fail(`Node image changed from the assessed image. Refresh CVE-2026-85024 assessment before release. Current=${manifest.node_image}`);
  process.exit();
}

if (policy.wfm_assessment.bundled_undici !== '6.28.0') {
  fail('Policy no longer records the assessed bundled undici 6.28.0 version. Refresh this gate.');
  process.exit();
}

const artifact = path.join(root, manifest.runtime_artifact);
if (!fs.existsSync(artifact)) {
  fail(`Runtime artifact is missing: ${manifest.runtime_artifact}`);
  process.exit();
}

const tarList = spawnSync('tar', ['-tzf', artifact], { encoding: 'utf8' });
if (tarList.status !== 0) {
  fail(`Unable to enumerate runtime artifact: ${tarList.stderr || tarList.stdout}`);
  process.exit();
}

const runtimeFiles = tarList.stdout
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((entry) => /\.(?:js|mjs|cjs)$/i.test(entry))
  .filter((entry) => !/(^|\/)(?:public|static|assets)(\/|$)/i.test(entry))
  .filter((entry) => !/(^|\/)node_modules(\/|$)/i.test(entry));

const patterns = [
  /\bnew\s+WebSocket\s*\(/,
  /\bglobalThis\s*\.\s*WebSocket\b/,
  /\bWebSocket\s*\(/,
  /\bWebSocket\b[^\n]{0,160}\b(?:undici|from|require|import)\b/i,
  /\b(?:undici|from|require|import)\b[^\n]{0,160}\bWebSocket\b/i
];

const findings = [];
for (const entry of runtimeFiles) {
  const extracted = spawnSync('tar', ['-xOzf', artifact, entry], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  });
  if (extracted.status !== 0) {
    fail(`Unable to inspect ${entry}: ${extracted.stderr || extracted.stdout}`);
    continue;
  }
  if (patterns.some((pattern) => pattern.test(extracted.stdout))) {
    findings.push(entry);
  }
}

if (findings.length > 0) {
  fail(
    `CVE-2026-85024: assessed Node 22.23.2 bundles vulnerable undici 6.28.0 and server-side WebSocket usage was detected in: ${findings.join(', ')}. ` +
    'Do not release or enable this path until the runtime bundles patched undici and full staging regression passes.'
  );
  process.exit();
}

console.log(
  'EXTERNAL_RISK_GATE_PASS: CVE-2026-85024 affected bundled component remains present, but no server-side WebSocket client callsite was detected in the sealed runtime artifact. ' +
  'This is temporary containment, not remediation; any Node image change or introduction of server-side WebSocket usage must re-run and refresh this assessment.'
);
