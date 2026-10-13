import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { proveSessionRevocation } from '../scripts/current-candidate-session-revocation.mjs';

const sha = 'a'.repeat(40);
async function fixture({ revoke = true, sourceDrift = false } = {}, run) {
  let valid = true;
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const authenticated = valid && req.headers.cookie === 'wfm_session=synthetic_token';
    if (path === '/api/logout' && req.method === 'POST') {
      if (revoke) valid = false;
      res.writeHead(200, { 'x-wfm-source-sha': sha }); res.end('{}'); return;
    }
    const status = authenticated ? 200 : 401;
    res.writeHead(status, { 'content-type': 'application/json',
      'x-wfm-source-sha': sourceDrift && !valid ? 'b'.repeat(40) : sha });
    res.end(JSON.stringify(authenticated && path === '/api/bootstrap'
      ? { actor: { tenant: 'synthetic', role: 'manager', personId: 'p1' } } : {}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}
const options = origin => ({ origin, cookie: 'wfm_session=synthetic_token', expectedSha: sha,
  expectedActor: { tenant: 'synthetic', role: 'manager', personId: 'p1' } });

test('replays the old cookie after logout against two protected routes', async () => {
  await fixture({}, async origin => {
    const result = await proveSessionRevocation(options(origin));
    assert.equal(result.status, 'PASS');
    assert.equal(JSON.stringify(result).includes('synthetic_token'), false);
  });
});
test('refuses a logout that only clears the browser cookie', async () => {
  await fixture({ revoke: false }, async origin =>
    assert.rejects(proveSessionRevocation(options(origin)), /Logged-out cookie still opens bootstrap/));
});
test('refuses source drift on the denial response', async () => {
  await fixture({ sourceDrift: true }, async origin =>
    assert.rejects(proveSessionRevocation(options(origin)), /Source drift/));
});
test('rejects plaintext remote origins and aliases of the bootstrap route before forwarding a cookie', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('Must not send session'); };
  await assert.rejects(proveSessionRevocation({ ...options('http://vector.example'), fetchImpl }), /HTTPS or local loopback/);
  await assert.rejects(proveSessionRevocation({ ...options('https://vector.example'),
    protectedPath: '/api/bootstrap?again=1', fetchImpl }), /Protected API path/);
  assert.equal(calls, 0);
});
