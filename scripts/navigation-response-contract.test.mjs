import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationEvidence, proveRoleView } from './rendered-role-assertions.mjs';

function fixture({ role = 'manager', alter = () => {}, base64 = false, bodyError = false, mimeType = 'application/json' } = {}) {
  const origin = 'https://fixture.invalid', evidence = createNavigationEvidence(origin);
  const expectedActor = { role, tenant: 'fixture', email: 'fixture@example.invalid' };
  const bootstrap = { actor: { ...expectedActor, personId: 'account', personnelId: 'worker' }, state: { version: 1, staff: [], org: [], requests: [] } };
  const personal = { identity: { id: 'worker', name: 'Maya' }, requests: [], shifts: [], leave: null };
  const onboarding = { people: [], batches: [], limitations: [], invites: [] };
  const destinationPath = role === 'director' ? '/api/onboarding' : role === 'manager' ? '/api/bootstrap' : '/api/personal';
  const payloads = { home: bootstrap, destination: structuredClone(role === 'director' ? onboarding : role === 'manager' ? bootstrap : personal) };
  alter(payloads);
  let destination = false, reads = 0;
  const complete = (requestId, path) => {
    evidence.onEvent({ method: 'Network.requestWillBeSent', params: { requestId, request: { url: origin + path, method: 'GET' } } });
    evidence.onEvent({ method: 'Network.responseReceived', params: { requestId, response: { url: origin + path, status: 200, mimeType } } });
    evidence.onEvent({ method: 'Network.loadingFinished', params: { requestId } });
  };
  const send = async (method, params) => {
    if (method === 'Network.getResponseBody') {
      reads++;
      if (bodyError) throw Error('Private body details must not be exposed');
      const value = payloads[params.requestId], text = typeof value === 'string' ? value : JSON.stringify(value);
      return { body: base64 ? Buffer.from(text).toString('base64') : text, base64Encoded: base64 };
    }
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') { destination = true; complete('destination', destinationPath); }
    if (method === 'Runtime.evaluate') return { result: { value: {
      app: true, heading: destination ? 'Destination heading' : 'Home heading',
      route: destination ? role === 'director' ? 'onboarding' : role === 'manager' ? 'leave' : 'personal' : 'overview',
      point: { x: 30, y: 30 }, control: 'Read destination', title: 'Vector',
    } } };
    return {};
  };
  return { send, evidence, expectedActor, role, timeoutMs: 60, navigate: async () => complete('home', '/api/bootstrap'), reads: () => reads };
}

for (const role of ['manager', 'employee', 'payroll_admin', 'director']) test(`accepts valid empty ${role} data without persisting bodies`, async () => {
  const f = fixture({ role, base64: role === 'employee' });
  const result = await proveRoleView(f);
  assert.equal(f.reads(), 2);
  assert.doesNotMatch(JSON.stringify(result), /fixture@example|worker|Maya|base64/);
});

for (const phase of ['home', 'destination']) test(`rejects empty ${phase} bootstrap despite a visible screen`, async () => {
  await assert.rejects(() => proveRoleView(fixture({ alter: p => { p[phase] = {}; } })), /bootstrap lacks actor or state/);
});
for (const field of ['tenant', 'role', 'email']) test(`rejects wrong fresh bootstrap ${field}`, async () => {
  await assert.rejects(() => proveRoleView(fixture({ alter: p => { p.home.actor[field] = 'other'; } })), new RegExp(`${field} binding mismatch`));
});
test('rejects bootstrap with missing state collections', async () => {
  await assert.rejects(() => proveRoleView(fixture({ alter: p => { delete p.home.state.staff; } })), /state contract is incomplete/);
});
test('rejects wrong personal identity after valid bootstrap', async () => {
  await assert.rejects(() => proveRoleView(fixture({ role: 'employee', alter: p => { p.destination.identity.id = 'other'; } })), /personal identity binding mismatch/);
});
test('rejects personal response without shifts', async () => {
  await assert.rejects(() => proveRoleView(fixture({ role: 'employee', alter: p => { delete p.destination.shifts; } })), /personal record is incomplete/);
});
test('rejects incomplete onboarding result', async () => {
  await assert.rejects(() => proveRoleView(fixture({ role: 'director', alter: p => { delete p.destination.invites; } })), /onboarding contract is incomplete/);
});
test('rejects an API error carried in a 200 response', async () => {
  await assert.rejects(() => proveRoleView(fixture({ alter: p => { p.home.error = 'failed'; } })), /no valid result/);
});
test('rejects non-JSON content type', async () => {
  await assert.rejects(() => proveRoleView(fixture({ mimeType: 'text/html' })), /not JSON/);
});
test('rejects malformed JSON', async () => {
  await assert.rejects(() => proveRoleView(fixture({ alter: p => { p.home = '{'; } })), /could not be decoded/);
});
test('unavailable completed body fails closed without disclosing original error', async () => {
  const f = fixture({ bodyError: true });
  await assert.rejects(() => proveRoleView(f), { message: 'Fresh API response body could not be decoded.' });
  assert.equal(f.reads(), 1);
});
