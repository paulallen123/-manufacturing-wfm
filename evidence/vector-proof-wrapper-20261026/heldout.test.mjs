import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

// These tests exercise the real HTTP wrapper with supplied synthetic browser
// evidence. They do not execute browser actions or establish hosted proof.
const checksum = 'a'.repeat(64);
const payroll = () => ({
  expectedTeamIds: ['team-one'],
  teamSignOffs: [{ teamId: 'team-one', submittedRevision: 3,
    signatureRevision: 3, auditRevision: 3, refreshedStatus: 'signed' }],
  release: { responseStatus: 200, batchId: 'synthetic-batch', status: 'released',
    rowCount: 1, computedChecksum: checksum, checksumHeader: checksum,
    persistedBatchId: 'synthetic-batch', auditBatchId: 'synthetic-batch',
    freshLoginBatchId: 'synthetic-batch', reconciliationOk: true }
});

const loopbackGuard = String.raw`
const local = value => ['localhost','127.0.0.1','::1','[::1]'].includes(String(value));
const check = value => { if (!local(value)) throw Error('PROOF_TEST_EXTERNAL_NETWORK_FORBIDDEN'); };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => { check(new URL(typeof input === 'string' ? input : input.url).hostname); return nativeFetch(input, ...args); };
for (const name of ['node:http','node:https']) {
  const api = require(name);
  for (const method of ['request','get']) {
    const original = api[method];
    api[method] = function(input, ...args) {
      check(typeof input === 'string' || input instanceof URL ? new URL(input).hostname : input.hostname || input.host || 'localhost');
      return original.call(this, input, ...args);
    };
  }
}
const socket = require('node:net').Socket.prototype;
const connect = socket.connect;
socket.connect = function(...args) {
  const input = Array.isArray(args[0]) ? args[0][0] : args[0];
  check(input && typeof input === 'object' ? input.host || 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost');
  return connect.apply(this, args);
};
require('node:tls').connect = () => { throw Error('PROOF_TEST_EXTERNAL_NETWORK_FORBIDDEN'); };
`;

async function availablePort() {
  const reserve = net.createServer();
  await new Promise((resolve, reject) => {
    reserve.once('error', reject);
    reserve.listen(0, '127.0.0.1', resolve);
  });
  const port = reserve.address().port;
  await new Promise((resolve, reject) => reserve.close(error => error ? reject(error) : resolve()));
  return port;
}

async function read(port, route) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(1000, () => req.destroy(new Error('HTTP wrapper timed out')));
    req.on('error', reject);
  });
}

async function withWrapper(evidence, check) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vector-proof-wrapper-'));
  let child;
  let output = '';
  try {
    for (const file of ['current-candidate-role-browser-proof-server.mjs', 'vector-proof-result.mjs']) {
      await fs.copyFile(new URL(file, import.meta.url), path.join(dir, file));
    }
    await fs.writeFile(path.join(dir, 'current-candidate-role-browser-proof.mjs'),
      'export const browserProofEvidence = ' + JSON.stringify(evidence) + ';\n');
    await fs.writeFile(path.join(dir, 'loopback-only.cjs'), loopbackGuard);
    const port = await availablePort();
    child = spawn(process.execPath, ['--require', path.join(dir, 'loopback-only.cjs'),
      path.join(dir, 'current-candidate-role-browser-proof-server.mjs')], {
      cwd: dir, windowsHide: true,
      env: { ...process.env, PORT: String(port), NODE_OPTIONS: '',
        WFM_REQUIRE_VECTOR_ASSET_DIGESTS: 'false', VECTOR_CANONICAL_JS_SHA256: '',
        VECTOR_CANONICAL_CSS_SHA256: '', VECTOR_WORKFLOW_JS_SHA256: '',
        WFM_EXPECTED_CANDIDATE_SHA: 'd387d5300f2de0906d8ea459e1bac610128236d9' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    const deadline = Date.now() + 15000;
    let result;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Wrapper exited: ' + output);
      try {
        const candidate = await read(port, '/');
        if (candidate.body.status !== 'RUNNING') { result = candidate; break; }
      } catch (error) {
        if (error.code !== 'ECONNREFUSED' && error.code !== 'ECONNRESET') throw error;
      }
      await delay(25);
    }
    assert.ok(result, 'Wrapper did not complete: ' + output);
    assert.equal(result.body.status, 'PARTIAL');
    assert.equal(result.body.productReady, false);
    assert.equal(result.body.endToEndVerified, false);
    assert.equal(result.body.exactAssetsVerified, false);
    assert.ok(result.body.missingEvidence.includes('exact-backend-binding'));
    assert.ok(result.body.missingEvidence.includes('server-audit-readback'));
    assert.ok(result.body.missingEvidence.includes('major-workflow-coverage'));
    const readiness = await read(port, '/ready');
    assert.equal(readiness.status, 503);
    assert.equal(readiness.body.productReady, false);
    await check(result.body, port);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('close', resolve));
      child.kill();
      await exited;
    }
    const cleanupTarget = path.resolve(dir);
    assert.equal(path.dirname(cleanupTarget), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cleanupTarget).startsWith('vector-proof-wrapper-'));
    await fs.rm(cleanupTarget, { recursive: true, force: true });
  }
}

test('independent raw target variants remain contained and cannot promote readiness', async () => {
 await withWrapper({}, async (_result, port) => {
  for (const target of ['//[','http://[::1','http://user:SECRET@[','http://%25']) {
   const rejected=await read(port,target);
   assert.equal(rejected.status,400,target);
   assert.deepEqual(rejected.body,{error:'Invalid request target'});
   assert.equal(JSON.stringify(rejected.body).includes('SECRET'),false);
   const after=await read(port,'/');
   assert.equal(after.status,200);assert.equal(after.body.status,'PARTIAL');
   assert.equal(after.body.productReady,false);assert.equal(after.body.endToEndVerified,false);
   for(const route of ['/ready','/ready?probe=1','http://other.invalid/ready']) {
    const ready=await read(port,route);assert.equal(ready.status,503);
    assert.equal(ready.body.status,'PARTIAL');assert.equal(ready.body.productReady,false);assert.equal(ready.body.endToEndVerified,false);
   }
  }
 });
});
