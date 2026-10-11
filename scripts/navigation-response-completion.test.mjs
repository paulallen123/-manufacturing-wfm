import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationEvidence, proveRoleView } from './rendered-role-assertions.mjs';

const origin = 'https://fixture.invalid';
function headers(e, id = 'request') {
  e.onEvent({ method: 'Network.requestWillBeSent', params: { requestId: id, request: { url: origin + '/api/bootstrap', method: 'GET' } } });
  e.onEvent({ method: 'Network.responseReceived', params: { requestId: id, response: { url: origin + '/api/bootstrap', status: 200, mimeType: 'application/json' } } });
}
const finish = (e, id = 'request') => e.onEvent({ method: 'Network.loadingFinished', params: { requestId: id } });
const fail = (e, id = 'request') => e.onEvent({ method: 'Network.loadingFailed', params: { requestId: id, errorText: 'net::ERR_CONTENT_LENGTH_MISMATCH' } });

test('response headers alone do not establish a completed fresh read', () => {
  const e = createNavigationEvidence(origin), mark = e.checkpoint();
  headers(e);
  assert.deepEqual(e.since(mark), []);
  finish(e);
  assert.deepEqual(e.since(mark), [{ sequence: 1, path: '/api/bootstrap', status: 200 }]);
});

test('a failed body cannot become navigation evidence after 200 headers', () => {
  const e = createNavigationEvidence(origin), mark = e.checkpoint();
  headers(e); fail(e); finish(e);
  assert.deepEqual(e.since(mark), []);
  headers(e, 'fresh'); finish(e, 'fresh'); finish(e, 'fresh');
  assert.equal(e.since(mark).length, 1);
  assert.equal(e.since(mark)[0].sequence, 2);
});

test('late completion of an old request cannot satisfy a new navigation', () => {
  const e = createNavigationEvidence(origin);
  headers(e);
  const mark = e.checkpoint();
  finish(e);
  assert.deepEqual(e.since(mark), []);
});

for (const failedPhase of ['home', 'destination']) test(`visible ${failedPhase} cannot pass with a failed response body`, async () => {
  const evidence = createNavigationEvidence(origin);
  let destination = false;
  const send = async (method, params) => {
    if (method === 'Input.dispatchMouseEvent' && params.type === 'mouseReleased') {
      destination = true; headers(evidence, 'destination'); fail(evidence, 'destination');
    }
    if (method === 'Network.getResponseBody') return {body:JSON.stringify({actor:{role:'manager',tenant:'fixture',email:'fixture@example.invalid',personId:'person'},state:{version:1,staff:[],org:[],requests:[]}})};
    if (method === 'Runtime.evaluate') return { result: { value: {
      app: true, heading: destination ? 'Absence & Leave' : 'What needs your attention right now',
      route: destination ? 'leave' : 'overview', point: { x: 30, y: 30 }, control: 'Review time off', title: 'Vector',
    } } };
    return {};
  };
  const navigate = async () => { headers(evidence, 'home'); if (failedPhase === 'home') fail(evidence, 'home'); else finish(evidence, 'home'); };
  await assert.rejects(() => proveRoleView({ send, evidence, navigate, role: 'manager', expectedActor:{role:'manager',tenant:'fixture',email:'fixture@example.invalid'}, timeoutMs: 60 }), /Missing fresh .* response|response was superseded/);
});
