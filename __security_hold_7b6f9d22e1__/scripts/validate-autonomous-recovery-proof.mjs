import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'DEPLOYMENT_MANIFEST.json'), 'utf8'));
const artifact = path.join(ROOT, manifest.runtime_artifact);
const outPath = path.join(ROOT, 'autonomous-recovery-proof.json');
const tenant = 'proof-tenant-a';
const evidenceDigestSeed = 'a'.repeat(64);
const verificationDigestSeed = 'b'.repeat(64);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return createHash('sha256').update(data).digest('hex');
}
function digestFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function probe(port, timeoutMs = 300) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
        resolve({ ok: res.statusCode === 200 && body?.ok === true, status: res.statusCode, body });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, timeout: true }); });
    req.on('error', () => resolve({ ok: false }));
  });
}
async function waitFor(port, wanted, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await probe(port);
    if (Boolean(result.ok) === wanted) return { ...result, elapsedMs: Date.now() - started };
    await sleep(25);
  }
  throw new Error(`Timed out waiting for port ${port} healthy=${wanted}`);
}
const workerSource = String.raw`
  const http = require('node:http');
  const port = Number(process.env.PROOF_PORT);
  const generation = process.env.PROOF_GENERATION;
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {'content-type':'application/json'});
      res.end(JSON.stringify({ok:true,pid:process.pid,generation}));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  server.listen(port, '127.0.0.1');
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
`;
function startWorker(port, generation) {
  return spawn(process.execPath, ['-e', workerSource], {
    env: { ...process.env, PROOF_PORT: String(port), PROOF_GENERATION: generation },
    stdio: 'ignore'
  });
}
async function stopWorker(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(1000)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
}

let active = null;
let dry = null;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-autonomous-proof-'));
const runtimeDir = path.join(tempRoot, 'runtime');
fs.mkdirSync(runtimeDir);

try {
  assert(fs.existsSync(artifact), `Runtime artifact missing: ${manifest.runtime_artifact}`);
  const artifactSha = digestFile(artifact);
  assert(artifactSha === manifest.runtime_sha256, `Runtime SHA mismatch: expected ${manifest.runtime_sha256}, got ${artifactSha}`);
  execFileSync('tar', ['-xzf', artifact, '-C', runtimeDir], { stdio: 'pipe' });

  const remediationPath = path.join(runtimeDir, 'lib', 'autonomous-remediation.cjs');
  const safetyPath = path.join(runtimeDir, 'lib', 'autonomy-safety-kernel.cjs');
  assert(fs.existsSync(remediationPath), 'Sealed runtime is missing autonomous-remediation.cjs');
  assert(fs.existsSync(safetyPath), 'Sealed runtime is missing autonomy-safety-kernel.cjs');
  const Remediation = require(remediationPath);
  const Safety = require(safetyPath);

  assert(Remediation.RUNBOOKS?.['worker-unhealthy']?.action === 'worker.restart', 'worker-unhealthy runbook is missing or changed');
  const blockedBeforeProof = Remediation.plan({
    tenant, runbook: 'worker-unhealthy', evidenceDigest: evidenceDigestSeed,
    verificationDigest: null, dryRunVerified: false, confidence: 1
  });
  assert(blockedBeforeProof.status === 'blocked', 'Worker restart must remain blocked before independent dry-run proof');

  const payrollDenied = Safety.evaluate({
    type: 'payroll.write', actorType: 'deterministic-runbook', tenant, targetTenant: tenant,
    reversible: true, dryRunVerified: true, independentChecks: [evidenceDigestSeed, verificationDigestSeed], confidence: 1
  });
  assert(payrollDenied.allowed === false && payrollDenied.reasons.includes('prohibited-high-impact-action'), 'Payroll write unexpectedly received autonomous authority');
  const llmDenied = Safety.evaluate({
    type: 'worker.restart', actorType: 'language-model', tenant, targetTenant: tenant,
    reversible: true, dryRunVerified: true, independentChecks: [evidenceDigestSeed, verificationDigestSeed], confidence: 1
  });
  assert(llmDenied.allowed === false && llmDenied.reasons.includes('language-model-is-proposal-only'), 'Language model unexpectedly received direct execution authority');
  const crossTenantDenied = Safety.evaluate({
    type: 'worker.restart', actorType: 'deterministic-runbook', tenant, targetTenant: 'proof-tenant-b',
    reversible: true, dryRunVerified: true, independentChecks: [evidenceDigestSeed, verificationDigestSeed], confidence: 1
  });
  assert(crossTenantDenied.allowed === false && crossTenantDenied.reasons.includes('tenant-boundary'), 'Cross-tenant action unexpectedly received authority');
  const unknownRunbook = Remediation.plan({ tenant, runbook: 'novel-unknown-fault', evidenceDigest: evidenceDigestSeed, verificationDigest: verificationDigestSeed, dryRunVerified: true, confidence: 1 });
  assert(unknownRunbook.status === 'unsupported', 'Unknown fault must fail closed instead of inventing a repair');

  const basePort = 43123 + Math.floor(Math.random() * 1000);
  const dryPort = basePort + 1001;
  active = startWorker(basePort, 'generation-1');
  const initial = await waitFor(basePort, true, 3000);
  const originalPid = initial.body.pid;

  const faultInjectedAt = Date.now();
  await stopWorker(active);
  active = null;
  const detection = await waitFor(basePort, false, 1000);
  const detectedAt = Date.now();

  const incidentEvidence = {
    schemaVersion: 1,
    scenario: 'worker-unhealthy',
    candidate: manifest.candidate,
    runtimeSha256: manifest.runtime_sha256,
    tenant,
    signal: 'failed health check',
    originalPid,
    containmentClass: 'reflex',
    durableOrReplayableWork: true,
    productionMutation: false
  };
  const evidenceDigest = sha256(incidentEvidence);

  dry = startWorker(dryPort, 'independent-dry-run');
  const dryHealthy = await waitFor(dryPort, true, 3000);
  await stopWorker(dry);
  dry = null;
  const dryStopped = await waitFor(dryPort, false, 1000);
  const verificationEvidence = {
    schemaVersion: 1,
    scenario: 'worker-unhealthy',
    evidenceDigest,
    workerClass: 'disposable-test-worker',
    startVerified: dryHealthy.ok === true,
    stopVerified: dryStopped.ok === false,
    sameTenant: true,
    reversible: true,
    noBusinessMutation: true
  };
  const verificationDigest = sha256(verificationEvidence);

  const approved = Remediation.plan({
    tenant,
    runbook: 'worker-unhealthy',
    evidenceDigest,
    verificationDigest,
    dryRunVerified: true,
    confidence: 1
  });
  assert(approved.status === 'approved-for-bounded-executor', `Expected bounded executor approval, got ${approved.status}`);
  assert(approved.action === 'worker.restart' && approved.safety?.allowed === true, 'Safety kernel did not approve the exact bounded worker.restart action');

  // Bounded executor contract for this proof: only the exact approved reversible action
  // may start a replacement disposable worker. No shell, provider, tenant, payroll or
  // application business-state capability is exposed here.
  assert(approved.action === 'worker.restart', 'Unexpected action reached bounded executor');
  active = startWorker(basePort, 'generation-2');
  const recovered = await waitFor(basePort, true, 3000);
  const recoveredAt = Date.now();
  assert(recovered.body.pid !== originalPid, 'Recovery did not replace the failed worker');
  for (let i = 0; i < 3; i++) {
    const stable = await probe(basePort);
    assert(stable.ok === true && stable.body.generation === 'generation-2', 'Replacement worker did not remain healthy');
    await sleep(25);
  }

  const recoveryMs = recoveredAt - faultInjectedAt;
  const detectionMs = detectedAt - faultInjectedAt;
  assert(recoveryMs <= 2500, `Known worker failure recovery exceeded 2500 ms reference gate: ${recoveryMs} ms`);

  const result = {
    schemaVersion: 1,
    proof: 'zero-human-known-worker-recovery',
    status: 'PASS',
    candidate: manifest.candidate,
    runtimeSha256: manifest.runtime_sha256,
    scenario: 'worker-unhealthy',
    runbook: 'worker-unhealthy',
    action: approved.action,
    humanInteractionRequired: false,
    productionMutation: false,
    faultInjected: true,
    faultDetected: true,
    independentDryRunVerified: true,
    safetyKernelApproved: true,
    replacementVerifiedHealthy: true,
    originalPid,
    replacementPid: recovered.body.pid,
    detectionMs,
    recoveryMs,
    referenceRecoveryGateMs: 2500,
    evidenceDigest,
    verificationDigest,
    safetyDecisionDigest: approved.safety.decisionDigest,
    negativeAuthorityTests: {
      payrollWriteDenied: true,
      languageModelDirectExecutionDenied: true,
      crossTenantExecutionDenied: true,
      unknownFaultFailsClosed: true
    },
    learning: {
      knownFingerprint: 'runtime:worker-unhealthy:failed-health-check',
      prevention: 'Keep worker.restart deterministic, reversible, same-tenant where scoped, dry-run verified and evidence-bound.',
      unknownFaultPolicy: 'Protect/preserve/isolate and continue diagnosis; never invent an autonomous production repair.'
    },
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await stopWorker(active).catch(() => {});
  await stopWorker(dry).catch(() => {});
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
