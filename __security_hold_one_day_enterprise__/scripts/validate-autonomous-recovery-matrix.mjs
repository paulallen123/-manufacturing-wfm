import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'DEPLOYMENT_MANIFEST.json'), 'utf8'));
const artifact = path.join(ROOT, manifest.runtime_artifact);
const outPath = path.join(ROOT, 'autonomous-recovery-matrix-proof.json');
const tenant = 'proof-tenant-a';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
function sha256(value) {
  return createHash('sha256').update(Buffer.from(typeof value === 'string' ? value : canonical(value))).digest('hex');
}
function digestFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function clone(value) { return structuredClone(value); }
function elapsedMicros(start) { return Number(process.hrtime.bigint() - start) / 1000; }

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-recovery-matrix-'));
const runtimeDir = path.join(tempRoot, 'runtime');
fs.mkdirSync(runtimeDir);

try {
  assert(fs.existsSync(artifact), `Runtime artifact missing: ${manifest.runtime_artifact}`);
  assert(digestFile(artifact) === manifest.runtime_sha256, 'Runtime SHA mismatch');
  execFileSync('tar', ['-xzf', artifact, '-C', runtimeDir], { stdio: 'pipe' });

  const Remediation = require(path.join(runtimeDir, 'lib', 'autonomous-remediation.cjs'));
  const Safety = require(path.join(runtimeDir, 'lib', 'autonomy-safety-kernel.cjs'));

  const scenarios = [
    {
      id: 'integration-transient-failure', runbook: 'integration-transient', action: 'integration.retry',
      initial: { durable: [{ id: 'evt-1', idempotencyKey: 'payroll:evt-1', state: 'retry', attempts: 1 }], downstream: [] },
      execute(state) {
        const msg = state.durable[0];
        assert(msg.state === 'retry', 'retry state required');
        if (!state.downstream.some(x => x.idempotencyKey === msg.idempotencyKey)) state.downstream.push({ idempotencyKey: msg.idempotencyKey, accepted: true });
        msg.attempts += 1; msg.state = 'delivered';
      },
      verify(state) { return state.durable[0].state === 'delivered' && state.downstream.length === 1 && state.durable[0].attempts === 2; },
      idempotent(state) { const before = JSON.stringify(state.downstream); const msg = state.durable[0]; if (!state.downstream.some(x => x.idempotencyKey === msg.idempotencyKey)) state.downstream.push({ idempotencyKey: msg.idempotencyKey, accepted: true }); return before === JSON.stringify(state.downstream); },
      fingerprint: 'integration:transient:retry-idempotent'
    },
    {
      id: 'integration-stuck-replay', runbook: 'integration-stuck-replay', action: 'integration.replay-idempotent',
      initial: { checkpoint: { cursor: 41, committed: true }, work: [{ seq: 42, idempotencyKey: 'provider:42', state: 'stuck' }], downstream: [] },
      execute(state) {
        assert(state.checkpoint.committed && state.work[0].seq === state.checkpoint.cursor + 1, 'replay must resume from committed checkpoint');
        const item = state.work[0];
        if (!state.downstream.some(x => x.idempotencyKey === item.idempotencyKey)) state.downstream.push({ idempotencyKey: item.idempotencyKey, applied: true });
        item.state = 'completed'; state.checkpoint.cursor = item.seq;
      },
      verify(state) { return state.work[0].state === 'completed' && state.checkpoint.cursor === 42 && state.downstream.length === 1; },
      idempotent(state) { const n = state.downstream.length; const item = state.work[0]; if (!state.downstream.some(x => x.idempotencyKey === item.idempotencyKey)) state.downstream.push({ idempotencyKey: item.idempotencyKey, applied: true }); return state.downstream.length === n; },
      fingerprint: 'integration:stuck:checkpoint-replay'
    },
    {
      id: 'queue-drift', runbook: 'queue-drift', action: 'queue.reconcile',
      initial: { ledger: ['a','b','c'], queue: ['a','c','orphan'] },
      execute(state) { state.queue = state.ledger.slice(); },
      verify(state) { return JSON.stringify(state.queue) === JSON.stringify(state.ledger); },
      idempotent(state) { const before = JSON.stringify(state); state.queue = state.ledger.slice(); return JSON.stringify(state) === before; },
      fingerprint: 'messaging:queue-drift:ledger-mismatch'
    },
    {
      id: 'cache-drift', runbook: 'cache-drift', action: 'cache.rebuild',
      initial: { source: { employeeCount: 120, openShifts: 8 }, cache: { employeeCount: 119, openShifts: 11 } },
      execute(state) { state.cache = clone(state.source); },
      verify(state) { return sha256(state.cache) === sha256(state.source); },
      idempotent(state) { const before = JSON.stringify(state); state.cache = clone(state.source); return JSON.stringify(state) === before; },
      fingerprint: 'runtime:cache-drift:checksum-mismatch'
    },
    {
      id: 'configuration-drift', runbook: 'configuration-drift', action: 'configuration.restore-drift',
      initial: { desired: { clockRadiusM: 150, overtimeThresholdHours: 40 }, actual: { clockRadiusM: 75, overtimeThresholdHours: 40 } },
      execute(state) { state.actual = clone(state.desired); },
      verify(state) { return sha256(state.actual) === sha256(state.desired); },
      idempotent(state) { const before = JSON.stringify(state); state.actual = clone(state.desired); return JSON.stringify(state) === before; },
      fingerprint: 'configuration:drift:last-known-good'
    },
    {
      id: 'bad-release', runbook: 'bad-release', action: 'release.rollback',
      initial: { current: 'candidate-bad', lastGood: 'candidate-good', schemaCompatible: true, quarantined: [] },
      execute(state) { assert(state.schemaCompatible === true, 'rollback requires schema compatibility'); state.quarantined.push(state.current); state.current = state.lastGood; },
      verify(state) { return state.current === state.lastGood && state.quarantined.includes('candidate-bad'); },
      idempotent(state) { const beforeCurrent = state.current; if (state.current !== state.lastGood) { state.quarantined.push(state.current); state.current = state.lastGood; } return state.current === beforeCurrent; },
      fingerprint: 'release:bad-release:last-good-rollback'
    }
  ];

  const negativeEvidence = sha256({ test: 'negative-authority', candidate: manifest.candidate });
  const negativeVerification = sha256({ test: 'negative-verification', candidate: manifest.candidate });
  const payrollDenied = Safety.evaluate({ type: 'payroll.write', actorType: 'deterministic-runbook', tenant, targetTenant: tenant, reversible: true, dryRunVerified: true, independentChecks: [negativeEvidence, negativeVerification], confidence: 1 });
  const llmDenied = Safety.evaluate({ type: 'queue.reconcile', actorType: 'language-model', tenant, targetTenant: tenant, reversible: true, dryRunVerified: true, independentChecks: [negativeEvidence, negativeVerification], confidence: 1 });
  const crossTenantDenied = Safety.evaluate({ type: 'queue.reconcile', actorType: 'deterministic-runbook', tenant, targetTenant: 'proof-tenant-b', reversible: true, dryRunVerified: true, independentChecks: [negativeEvidence, negativeVerification], confidence: 1 });
  assert(!payrollDenied.allowed && payrollDenied.reasons.includes('prohibited-high-impact-action'), 'payroll write received authority');
  assert(!llmDenied.allowed && llmDenied.reasons.includes('language-model-is-proposal-only'), 'LLM received execution authority');
  assert(!crossTenantDenied.allowed && crossTenantDenied.reasons.includes('tenant-boundary'), 'cross-tenant recovery received authority');
  assert(Remediation.plan({ tenant, runbook: 'future-unknown-runbook', evidenceDigest: negativeEvidence, verificationDigest: negativeVerification, dryRunVerified: true, confidence: 1 }).status === 'unsupported', 'unknown runbook did not fail closed');

  const results = [];
  for (const scenario of scenarios) {
    assert(Remediation.RUNBOOKS?.[scenario.runbook]?.action === scenario.action, `${scenario.runbook} action mapping changed`);
    const pre = Remediation.plan({ tenant, runbook: scenario.runbook, evidenceDigest: sha256({scenario: scenario.id, phase:'pre'}), dryRunVerified: false, confidence: 1 });
    assert(pre.status === 'blocked', `${scenario.id} must be blocked before independent dry-run evidence`);

    const evidence = { schemaVersion: 1, candidate: manifest.candidate, runtimeSha256: manifest.runtime_sha256, tenant, scenario: scenario.id, fingerprint: scenario.fingerprint, initialDigest: sha256(scenario.initial), productionMutation: false };
    const evidenceDigest = sha256(evidence);

    const dryState = clone(scenario.initial);
    scenario.execute(dryState);
    assert(scenario.verify(dryState), `${scenario.id} dry-run failed verification`);
    assert(scenario.idempotent(dryState), `${scenario.id} dry-run is not idempotent`);
    const verification = { schemaVersion: 1, scenario: scenario.id, evidenceDigest, workerClass: 'disposable-test-worker', resultingDigest: sha256(dryState), reversible: true, sameTenant: true, idempotent: true, noBusinessMutation: true };
    const verificationDigest = sha256(verification);

    const approved = Remediation.plan({ tenant, runbook: scenario.runbook, evidenceDigest, verificationDigest, dryRunVerified: true, confidence: 1 });
    assert(approved.status === 'approved-for-bounded-executor', `${scenario.id} was not approved after verified dry run`);
    assert(approved.action === scenario.action && approved.safety?.allowed === true, `${scenario.id} safety decision mismatch`);

    const isolatedState = clone(scenario.initial);
    const started = process.hrtime.bigint();
    scenario.execute(isolatedState);
    const recoveryMicros = elapsedMicros(started);
    assert(scenario.verify(isolatedState), `${scenario.id} bounded execution failed verification`);
    assert(scenario.idempotent(isolatedState), `${scenario.id} bounded execution failed idempotency verification`);

    results.push({
      scenario: scenario.id,
      fingerprint: scenario.fingerprint,
      runbook: scenario.runbook,
      action: scenario.action,
      blockedBeforeIndependentProof: true,
      independentDryRunVerified: true,
      safetyKernelApproved: true,
      isolatedRecoveryVerified: true,
      idempotencyVerified: true,
      recoveryMicros: Math.round(recoveryMicros),
      evidenceDigest,
      verificationDigest,
      safetyDecisionDigest: approved.safety.decisionDigest
    });
  }

  const receipt = {
    schemaVersion: 1,
    proof: 'zero-human-deterministic-recovery-matrix',
    status: 'PASS',
    candidate: manifest.candidate,
    runtimeSha256: manifest.runtime_sha256,
    humanInteractionRequired: false,
    productionMutation: false,
    scenariosPassed: results.length,
    scenarios: results,
    negativeAuthorityTests: {
      payrollWriteDenied: true,
      languageModelDirectExecutionDenied: true,
      crossTenantExecutionDenied: true,
      unknownFaultFailsClosed: true
    },
    learning: {
      policy: 'Known, independently verified, reversible faults become deterministic machine reflexes. Unknown or high-impact faults remain isolate/protect/preserve only.',
      nextProof: 'Connect these runbooks to real support incidents and provider/runtime executors in hosted staging without widening authority.'
    },
    claimBoundary: 'Disposable CI proof using the exact sealed runtime remediation and safety modules plus isolated deterministic state primitives. This does not claim live customer, provider or production execution.',
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(outPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
