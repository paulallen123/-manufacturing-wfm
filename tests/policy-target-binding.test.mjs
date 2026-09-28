import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const sha = '486606c4269bc8f1a2f24056fec22a6d6ffc7aad';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('refuses a run whose recorded origin differs before any work claim', async t => {
  let claimCount = 0;
  const target = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/runtime-identity') return res.end(JSON.stringify({ candidateSha: sha }));
    if (req.url === '/api/implementation/autonomous/work/claim') {
      claimCount += 1;
      return res.end(JSON.stringify({ job: null }));
    }
    if (req.url === '/api/implementation/autonomous/evidence') {
      const kind = claimCount === 1 ? 'time-policies' : 'absence-policies';
      return res.end(JSON.stringify({
        completedRequirements: 8,
        totalRequirements: 21,
        operationalReady: false,
        requirements: [{ key: kind, satisfied: true }],
        workPlan: { runnable: [] }
      }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const targetPort = await listen(target);
  t.after(() => target.close());

  const proofPortServer = http.createServer();
  const proofPort = await listen(proofPortServer);
  await new Promise(resolve => proofPortServer.close(resolve));

  const script = fileURLToPath(new URL('../scripts/policy-discovery-proof.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: String(proofPort),
      TARGET_ORIGIN: `http://127.0.0.1:${targetPort}`,
      RUN_TARGET_ORIGIN: 'https://implementation-isolated-target.example',
      EXPECTED_DEPLOYMENT_ID: 'b845c569-0311-4bdd-9d21-bb6471536bb2',
      RUN_ID: '7de3b1c7-b9f4-4ed8-9c19-0ce37073d739',
      TENANT: 'proof-tenant',
      EXPECTED_CANDIDATE_SHA: sha,
      WFM_IMPLEMENTATION_INTERNAL_TOKEN: 'test-only-token',
      WFM_SCHEDULING_INTERNAL_TOKEN: 'test-only-scheduling-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGKILL'));

  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 5000;
  while (!output.includes('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);

  assert.match(output, /VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=FAIL/);
  assert.match(output, /target origin does not match run origin/);
  assert.equal(claimCount, 0);
});

test('records the configured target deployment instead of a stale deployment', async t => {
  const evidenceBodies = [];
  let storedPlan = null;
  const target = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : null;
    if (req.url === '/api/runtime-identity') return res.end(JSON.stringify({ candidateSha: sha }));
    if (req.url === '/api/operations/scheduling/plan/shadow') {
      assert.equal(req.headers['x-wfm-scheduling-internal'], 'test-only-scheduling-token');
      const idempotent = storedPlan !== null;
      storedPlan ||= {
        planId: 'persisted-plan-001',
        tenant: json.tenant,
        contextRevision: json.input.contextRevision,
        contractVersion: 'VECTOR_MANUFACTURING_SCHEDULER_V1',
        solverVersion: 'VECTOR_DETERMINISTIC_OPTIMISER_V1',
        mode: 'SHADOW',
        executionPermitted: false,
        sourceEvidence: json.input.sourceEvidence,
        solve: { method: 'BOUNDED_EXACT_SEARCH', optimalityProven: true },
        validation: { valid: true, violations: [] },
        quality: { coveragePct: 100, unfilledSlots: 0 },
        claimBoundary: 'SHADOW_ONLY_NO_PRODUCTION_MUTATION'
      };
      res.statusCode = idempotent ? 200 : 201;
      return res.end(JSON.stringify({
        contractVersion: 'VECTOR_MANUFACTURING_SCHEDULER_V1',
        authority: 'NO_EXECUTION',
        idempotent,
        plan: storedPlan
      }));
    }
    if (req.url === '/api/implementation/autonomous/work/claim') {
      return res.end(JSON.stringify({ job: null }));
    }
    if (req.url === '/api/implementation/autonomous/evidence') {
      evidenceBodies.push(json);
      return res.end(JSON.stringify({
        completedRequirements: json.kind === 'scheduling' ? 9 : 8,
        totalRequirements: 21,
        operationalReady: false,
        requirements: [{ key: json.kind, satisfied: true }],
        workPlan: { runnable: [] }
      }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const targetPort = await listen(target);
  t.after(() => target.close());

  const proofPortServer = http.createServer();
  const proofPort = await listen(proofPortServer);
  await new Promise(resolve => proofPortServer.close(resolve));
  const targetOrigin = `http://127.0.0.1:${targetPort}`;
  const expectedDeploymentId = 'b845c569-0311-4bdd-9d21-bb6471536bb2';
  const script = fileURLToPath(new URL('../scripts/policy-discovery-proof.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: String(proofPort),
      TARGET_ORIGIN: targetOrigin,
      RUN_TARGET_ORIGIN: targetOrigin,
      EXPECTED_DEPLOYMENT_ID: expectedDeploymentId,
      RUN_ID: '7de3b1c7-b9f4-4ed8-9c19-0ce37073d739',
      TENANT: 'proof-tenant',
      EXPECTED_CANDIDATE_SHA: sha,
      WFM_IMPLEMENTATION_INTERNAL_TOKEN: 'test-only-token',
      WFM_SCHEDULING_INTERNAL_TOKEN: 'test-only-scheduling-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGKILL'));

  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 5000;
  while (!output.includes('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);

  assert.match(output, /VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=PASS/);
  assert.equal(evidenceBodies.length, 3);
  assert.deepEqual(
    evidenceBodies.map(body => body.detail.exactTargetDeploymentId),
    [expectedDeploymentId, expectedDeploymentId, expectedDeploymentId]
  );
  assert.equal(evidenceBodies[2].kind, 'scheduling');
  assert.equal(evidenceBodies[2].detail.executionPermitted, false);
  assert.equal(evidenceBodies[2].detail.planId, 'persisted-plan-001');
});

test('refuses scheduling readiness when the shadow plan lacks the no-execution boundary', async t => {
  const claimedKinds = [];
  const target = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    let body = '';
    for await (const chunk of req) body += chunk;
    const json = body ? JSON.parse(body) : null;
    if (req.url === '/api/runtime-identity') return res.end(JSON.stringify({ candidateSha: sha }));
    if (req.url === '/api/operations/scheduling/plan/shadow') {
      return res.end(JSON.stringify({
        authority: 'NO_EXECUTION',
        plan: {
          planId: 'unsafe-plan',
          tenant: 'proof-tenant',
          mode: 'SHADOW',
          executionPermitted: true,
          validation: { valid: true },
          sourceEvidence: ['fixture']
        }
      }));
    }
    if (req.url === '/api/implementation/autonomous/work/claim') {
      claimedKinds.push(json.requirementKey);
      return res.end(JSON.stringify({ job: null }));
    }
    if (req.url === '/api/implementation/autonomous/evidence') {
      return res.end(JSON.stringify({
        completedRequirements: 8,
        totalRequirements: 21,
        operationalReady: false,
        requirements: [{ key: json.kind, satisfied: true }],
        workPlan: { runnable: json.kind === 'absence-policies' ? ['scheduling'] : [] }
      }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  const targetPort = await listen(target);
  t.after(() => target.close());

  const proofPortServer = http.createServer();
  const proofPort = await listen(proofPortServer);
  await new Promise(resolve => proofPortServer.close(resolve));
  const targetOrigin = `http://127.0.0.1:${targetPort}`;
  const script = fileURLToPath(new URL('../scripts/policy-discovery-proof.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: String(proofPort),
      TARGET_ORIGIN: targetOrigin,
      RUN_TARGET_ORIGIN: targetOrigin,
      EXPECTED_DEPLOYMENT_ID: 'b845c569-0311-4bdd-9d21-bb6471536bb2',
      RUN_ID: '7de3b1c7-b9f4-4ed8-9c19-0ce37073d739',
      TENANT: 'proof-tenant',
      EXPECTED_CANDIDATE_SHA: sha,
      WFM_IMPLEMENTATION_INTERNAL_TOKEN: 'test-only-token',
      WFM_SCHEDULING_INTERNAL_TOKEN: 'test-only-scheduling-token'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => child.kill('SIGKILL'));

  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 5000;
  while (!output.includes('VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 1000))]);

  assert.match(output, /VECTOR_IMPLEMENTATION_POLICY_EVIDENCE_PROOF=FAIL/);
  assert.deepEqual(claimedKinds, ['time-policies', 'absence-policies']);
});
