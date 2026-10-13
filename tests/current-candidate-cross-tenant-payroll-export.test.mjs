import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { proveCrossTenantPayrollExport } from '../scripts/current-candidate-cross-tenant-payroll-export.mjs';

const sha = 'a'.repeat(40);
const csv = 'person,hours\np1,8\n';
const checksum = createHash('sha256').update(csv).digest('hex');
async function fixture({ leak = false, wrongChecksum = false, embeddedLeak = false,
  compactErrorLeak = false, ownerJson = false } = {}, run) {
  const server = createServer((req, res) => {
    const owner = req.headers.cookie === 'wfm_session=owner_token';
    const other = req.headers.cookie === 'wfm_session=other_token';
    const path = new URL(req.url, 'http://localhost').pathname;
    const headers = { 'x-wfm-source-sha': sha };
    if (path === '/api/bootstrap') {
      res.writeHead(owner || other ? 200 : 401, { ...headers, 'content-type': 'application/json' });
      res.end(JSON.stringify({ actor: { tenant: owner ? 'alpha' : 'bravo', role: 'payroll_admin' } })); return;
    }
    if (path === '/api/payroll-export/batch-1' && (owner || (other && leak))) {
      res.writeHead(200, { ...headers, 'x-export-sha256': wrongChecksum ? '0'.repeat(64) : checksum,
        'content-type': ownerJson && owner ? 'application/json' : 'text/csv' }); res.end(csv); return;
    }
    res.writeHead(404, { ...headers, 'content-type': 'application/json' });
    res.end(JSON.stringify(embeddedLeak ? { error: 'Not found', csv } :
      { error: compactErrorLeak ? 'p1,8' : 'Not found' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.close(); await once(server, 'close'); }
}
const input = origin => ({ origin, ownerCookie: 'wfm_session=owner_token', otherCookie: 'wfm_session=other_token',
  ownerTenant: 'alpha', otherTenant: 'bravo', batchId: 'batch-1', expectedSha: sha });
test('owner checksum is readable and other payroll tenant is denied', async () => {
  await fixture({}, async origin => {
    const proof = await proveCrossTenantPayrollExport(input(origin));
    assert.equal(proof.status, 'PASS');
    assert.equal(proof.checksum, checksum);
    assert.equal(JSON.stringify(proof).includes('owner_token'), false);
  });
});
test('fails when other payroll tenant receives the CSV', async () => {
  await fixture({ leak: true }, async origin =>
    assert.rejects(proveCrossTenantPayrollExport(input(origin)), /Other tenant could read/));
});
test('fails when owning checksum is wrong', async () => {
  await fixture({ wrongChecksum: true }, async origin =>
    assert.rejects(proveCrossTenantPayrollExport(input(origin)), /checksum mismatch/));
});
test('fails when owner route returns a non-CSV response', async () => {
  await fixture({ ownerJson: true }, async origin =>
    assert.rejects(proveCrossTenantPayrollExport(input(origin)), /not CSV/));
});
test('fails when denial JSON embeds the CSV', async () => {
  await fixture({ embeddedLeak: true }, async origin =>
    assert.rejects(proveCrossTenantPayrollExport(input(origin)), /export fields/));
});
test('fails when denial error embeds a compact payroll value', async () => {
  await fixture({ compactErrorLeak: true }, async origin =>
    assert.rejects(proveCrossTenantPayrollExport(input(origin)), /export details/));
});
test('identical session errors do not expose the cookie', async () => {
  const cookie = 'wfm_session=owner_token';
  await assert.rejects(proveCrossTenantPayrollExport({ ...input('https://vector.example'), otherCookie: cookie }), error => {
    assert.equal(JSON.stringify(error).includes(cookie), false);
    assert.equal(error.actual, undefined);
    return /Distinct sessions/.test(error.message);
  });
});
