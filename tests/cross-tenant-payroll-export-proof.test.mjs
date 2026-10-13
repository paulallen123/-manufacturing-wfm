import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCrossTenantPayrollExport } from '../scripts/cross-tenant-payroll-export-proof.mjs';

const SHA = 'f62f1e9f6d993d3f90ff19f8178275803e5b7d3f';
function fixture(status = 403) {
  const calls = [];
  const headers = [
    { name: 'X-WFM-Source-SHA', value: SHA },
    { name: 'X-WFM-Source-Binding', value: 'build-file-matched' },
    { name: 'X-WFM-Fixture-Only', value: 'true' },
    { name: 'Content-Type', value: 'application/json' },
  ];
  return {
    calls,
    headers,
    args: {
      baseURL: 'https://synthetic.example.test',
      actorTenantId: 'tenant-b',
      batchTenantId: 'tenant-a',
      batchId: 'batch/a',
      candidateSha: SHA,
      request: {
        async get(url, options) {
          calls.push({ url, options });
          return { status: () => status, headersArray: async () => headers };
        },
      },
    },
  };
}

test('uses one read-only GET from the supplied tenant-B context and accepts scoped denial', async () => {
  const f = fixture();
  const result = await probeCrossTenantPayrollExport(f.args);
  assert.deepEqual(result, { status: 'PASS', failures: [], responseStatus: 403, hostedProof: false });
  assert.deepEqual(f.calls, [{
    url: 'https://synthetic.example.test/api/payroll-export/batch%2Fa',
    options: { failOnStatusCode: false, maxRedirects: 0 },
  }]);
});

test('a same-tenant or malformed scope cannot issue a request', async () => {
  for (const change of [{ actorTenantId: 'tenant-a' }, { batchId: '' }, { candidateSha: 'bad' }, { baseURL: 'http://synthetic.example.test' }]) {
    const f = fixture();
    const result = await probeCrossTenantPayrollExport({ ...f.args, ...change });
    assert.equal(result.status, 'FAIL');
    assert.equal(f.calls.length, 0);
  }
});

test('success, redirect, and server errors never count as cross-tenant denial', async () => {
  for (const status of [200, 302, 500]) {
    const f = fixture(status);
    const result = await probeCrossTenantPayrollExport(f.args);
    assert.ok(result.failures.includes('cross_tenant_export_not_denied'));
  }
});

test('export headers or CSV content type invalidate a nominal 403', async () => {
  for (const leaked of [
    { name: 'Content-Disposition', value: 'attachment; filename=payroll.csv' },
    { name: 'X-Export-SHA256', value: 'a'.repeat(64) },
    { name: 'Content-Type', value: 'text/csv' },
  ]) {
    const f = fixture();
    f.headers.push(leaked);
    assert.equal((await probeCrossTenantPayrollExport(f.args)).status, 'FAIL');
  }
});

test('wrong or duplicate source identity headers invalidate denial evidence', async () => {
  for (const change of [
    { name: 'X-WFM-Source-SHA', value: '0'.repeat(40) },
    { name: 'X-WFM-Source-Binding', value: 'configured-only' },
    { name: 'X-WFM-Fixture-Only', value: 'false' },
  ]) {
    const f = fixture();
    f.headers.find(h => h.name === change.name).value = change.value;
    assert.equal((await probeCrossTenantPayrollExport(f.args)).status, 'FAIL');
  }
  const f = fixture();
  f.headers.push({ name: 'x-wfm-source-sha', value: SHA });
  assert.ok((await probeCrossTenantPayrollExport(f.args)).failures.includes('source_identity_mismatch:x-wfm-source-sha'));
});

test('404 with exact source headers and no export artifact is an allowed denial', async () => {
  const f = fixture(404);
  assert.equal((await probeCrossTenantPayrollExport(f.args)).status, 'PASS');
});

test('transport failure cannot become denial evidence', async () => {
  const f = fixture();
  f.args.request.get = async () => { throw new Error('synthetic transport failure'); };
  assert.ok((await probeCrossTenantPayrollExport(f.args)).failures.includes('response_capture_failed'));
});
