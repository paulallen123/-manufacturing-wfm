import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// Independent verifier seam. This does not launch a browser or contact a service.
// All keys, actors, tenant state and responses are generated in process.
const target = path.resolve(process.env.SIGNED_JOURNEY_TARGET || 'cp001-proof/source');
const script = path.join(target, 'scripts/current-candidate-role-browser-proof.mjs');
const text = fs.readFileSync(script, 'utf8');
const end = text.indexOf('// VECTOR_PROOF_CLIENT_RUNNER_START');
assert.ok(end > 0, 'Canonical client factory marker is required');
const proofRunnerAuth = createRequire(script)('../security/runtime/proof-runner-auth.cjs');
const prefix = text.slice(0, end).replace(/^import .*?;\r?\n/gm, '').replaceAll('export function ', 'function ');
const factory = vm.runInNewContext(prefix + '\n;createProofClient;', { assert, crypto, proofRunnerAuth, URL, Buffer, process: { env: {} } });
const sha = '3'.repeat(40), digest = '4'.repeat(64), origin = 'https://heldout.invalid';
const actors = [
  { slug: 'manager', email: 'reviewer@heldout.invalid', role: 'manager', tenant: 'heldout-main' },
  { slug: 'employee', email: 'worker@heldout.invalid', role: 'employee', tenant: 'heldout-main' },
  { slug: 'payroll', email: 'wages@heldout.invalid', role: 'payroll_admin', tenant: 'heldout-main' },
  { slug: 'company-admin', email: 'admin@heldout.invalid', role: 'director', tenant: 'heldout-main' },
  { slug: 'isolation-manager', email: 'other@heldout.invalid', role: 'manager', tenant: 'heldout-other' }
];
function harness(mutate = () => {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const config = { VECTOR_PROOF_AUTH_PROFILE: 'signed', VECTOR_PROOF_URL: origin,
    WFM_EXPECTED_CANDIDATE_SHA: sha, EXPECTED_DEPLOYMENT_ID: 'heldout-deployment',
    EXPECTED_IMPLEMENTATION_TENANT: 'heldout-main', EXPECTED_IMPLEMENTATION_RUN_ID: 'heldout-run',
    EXPECTED_CONFIGURATION_DIGEST: digest, VECTOR_PROOF_ACTORS_JSON: JSON.stringify(actors),
    PROOF_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64') };
  const requests = [], assertions = [];
  const context = { tenant: 'heldout-main', runId: 'heldout-run', tenantEnvironment: {
    runId: 'heldout-run', isolation: { tenant: 'heldout-main' }, configurationDigest: digest },
    requirements: [{ evidenceBinding: { expected: { candidateSha: sha, deploymentId: 'heldout-deployment',
      tenant: 'heldout-main', runId: 'heldout-run' }, observed: { candidateSha: '0'.repeat(40), deploymentId: 'stale' } } }] };
  function page() {
    let actor = null;
    return { goto: async () => ({ status: () => 200 }), reload: async () => {}, waitForFunction: async () => {},
      evaluate: async (fn, payload) => vm.runInNewContext('(' + fn.toString() + ')(payload)', { payload,
        fetch: async (route, options) => {
          requests.push({ route, options });
          let status = 200, body;
          const headers = { 'x-wfm-source-sha': sha, 'x-wfm-source-binding': 'build-file-matched', 'x-wfm-fixture-only': 'true' };
          if (route === '/api/runtime-identity') body = { candidateSha: sha, sourceBinding: 'build-file-matched', fixtureOnly: true, productionApproved: false };
          else if (route === '/api/bootstrap') { status = actor ? 200 : 401; body = actor ? { actor: { ...actor, personId: actor.slug + '-person' } } : { error: 'Unauthenticated' }; }
          else if (route === '/api/proof-runner/session') {
            const assertion = JSON.parse(options.body); assertions.push(assertion);
            assert.equal(crypto.verify(null, Buffer.from(proofRunnerAuth.canonicalAssertion(assertion)), publicKey, Buffer.from(assertion.signature, 'base64url')), true);
            actor = actors.find(a => a.email === assertion.email); assert.ok(actor);
            body = { authMethod: 'proof-runner-signed', actor: { email: actor.email, tenant: actor.tenant, role: actor.role } };
          } else if (route === '/api/implementation/autonomous/status') body = structuredClone(context);
          else throw Error('Unexpected route: ' + route);
          const response = { route, status, body, headers, actor }; mutate(response);
          return { status: response.status, json: async () => response.body, headers: { get: name => response.headers[name] ?? null } };
        } }) };
  }
  return { config, requests, assertions, page, client: factory(config) };
}

test('heldout roles use arbitrary explicit actors and unique signed assertions on new pages', async () => {
  const h = harness();
  for (const actor of [...actors, actors[1]]) await h.client.authenticate(h.page(), actor.email);
  assert.equal(h.assertions.length, 6);
  assert.equal(new Set(h.assertions.map(a => a.nonce)).size, 6);
  assert.ok(h.requests.every(r => r.route !== '/api/login'));
  assert.ok(h.assertions.every(a => !('role' in a) && !('tenant' in a)));
});

for (const route of ['/api/runtime-identity', '/api/proof-runner/session', '/api/bootstrap', '/api/implementation/autonomous/status']) {
  for (const key of ['x-wfm-source-sha', 'x-wfm-source-binding', 'x-wfm-fixture-only']) {
    test('heldout source binding is required at ' + route + ' / ' + key, async () => {
      const h = harness(r => { if (r.route === route) delete r.headers[key]; });
      await assert.rejects(() => h.client.authenticate(h.page(), actors[0].email));
      assert.ok(h.requests.every(r => r.route !== '/api/login'));
    });
  }
}

for (const [field, value] of [['role', 'employee'], ['tenant', 'heldout-other'], ['email', actors[1].email]]) {
  test('heldout session exchange rejects persisted actor ' + field + ' substitution', async () => {
    const h = harness(r => { if (r.route === '/api/proof-runner/session') r.body.actor[field] = value; });
    await assert.rejects(() => h.client.authenticate(h.page(), actors[0].email));
  });
}
for (const field of ['candidateSha', 'deploymentId', 'tenant', 'runId']) {
  test('heldout current implementation rejects missing expected ' + field + ' even when historical evidence exists', async () => {
    const h = harness(r => { if (r.route === '/api/implementation/autonomous/status') delete r.body.requirements[0].evidenceBinding.expected[field]; });
    await assert.rejects(() => h.client.authenticate(h.page(), actors[0].email));
  });
}

test('heldout unauthenticated failure stops before minting any proof session', async () => {
  const h = harness(r => { if (r.route === '/api/bootstrap' && !r.actor) r.status = 200; });
  await assert.rejects(() => h.client.authenticate(h.page(), actors[0].email));
  assert.equal(h.assertions.length, 0);
});

test('heldout navigation receipt cannot acquire business or customer readiness by repeated login', async () => {
  const h = harness(); for (const a of actors) await h.client.authenticate(h.page(), a.email);
  const evidence = h.client.partialEvidence();
  assert.equal(evidence.authCompatibility.status, 'PARTIAL');
  assert.equal(evidence.authCompatibility.hostedProof, false);
  assert.equal(evidence.authCompatibility.chromiumVerified, false);
  assert.equal(evidence.authCompatibility.implementationContext.platformDeploymentVerified, false);
  for (const key of ['leaveJourney', 'attendanceJourney', 'payrollJourney']) assert.equal(evidence[key], null);
});

for (const unapproved of ['{"synthetic":true,"approvalReference":"client-only","requestId":"ordinary-pending"}', '{malformed']) {
  test('heldout self-asserted approval remains zero-business signed navigation: ' + (unapproved.startsWith('{"') ? 'JSON' : 'malformed'), async () => {
    const h = harness(); for (const a of actors) await h.client.authenticate(h.page(), a.email);
    const start = text.indexOf("  if (proofClient.mode === 'signed') {");
    const finish = text.indexOf('  } else {\n  const leaveJourney', start);
    assert.ok(start >= 0 && finish > start, 'Existing signed navigation-only branch is required');
    const branch = text.slice(start, finish) + '\n  }\n;return browserProofEvidence;';
    const output = [], callsBefore = h.requests.length;
    const browser = new Proxy({}, { get() { throw Error('Unauthorised business browser access'); } });
    const evidence = await vm.runInNewContext('(async()=>{' + branch + '})()', {
      assert, proofClient: h.client, receipts: Array(5).fill({}), specs: actors, navigationClicks: 3,
      browserProofEvidence: {}, browser, process: { env: { VECTOR_SIGNED_LEAVE_DECISION_JSON: unapproved } },
      console: { log: value => output.push(value) }
    });
    assert.equal(h.requests.length, callsBefore);
    assert.equal(output.length, 1);
    assert.match(output[0], /CURRENT_SIGNED_AUTH_NAVIGATION=PARTIAL\|roles=5\|businessJourneys=0\|endToEndVerified=false\|productReady=false/);
    for (const key of ['leaveJourney', 'attendanceJourney', 'payrollJourney']) assert.equal(evidence[key], null);
  });
}
