import test from 'node:test';
import assert from 'node:assert/strict';
import { certifyProviderSandbox, providerCertificationProfiles } from './provider-certification.mjs';

const SHA = 'a'.repeat(40);
function response(body, status = 200) {
  const encoded = Buffer.from(JSON.stringify(body));
  return {
    status,
    headers: { get(name) { return String(name).toLowerCase() === 'content-type' ? 'application/json' : null; } },
    async arrayBuffer() { return encoded; }
  };
}

test('only explicitly approved provider profiles exist', () => {
  assert.deepEqual(providerCertificationProfiles().sort(), ['gusto-embedded-payroll', 'sap-s4hana', 'xero']);
});

test('SAP S/4HANA proof runs through the VECTOR connection-test contract without exposing the API key', async () => {
  let observed;
  const result = await certifyProviderSandbox({
    providerKey: 'sap-s4hana',
    candidateSha: SHA,
    resolveSecretBundle: async ref => {
      assert.equal(ref, 'secret://provider/sap-business-accelerator-hub/api-key');
      return { apiKey: 'top-secret-sap-key' };
    },
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({ value: [{ name: 'A_Bank', kind: 'EntitySet', url: 'A_Bank' }] });
    },
    nowMs: Date.parse('2026-09-28T12:00:00Z')
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.evidenceLevel, 'sandbox-authenticated');
  assert.equal(result.connectionValidation.status, 'CONNECTION_VERIFIED');
  assert.equal(result.request.headers.APIKey, '[REDACTED]');
  assert.equal(JSON.stringify(result).includes('top-secret-sap-key'), false);
  assert.equal(new URL(observed.url).hostname, 'sandbox.api.sap.com');
  assert.match(new URL(observed.url).pathname, /s4hanacloud/);
  assert.equal(observed.options.method, 'GET');
});

test('Xero proof fails closed unless the organisation independently identifies as a demo company', async () => {
  await assert.rejects(
    certifyProviderSandbox({
      providerKey: 'xero',
      candidateSha: SHA,
      resolveSecretBundle: async () => ({ accessToken: 'secret-token', tenantId: 'tenant-1' }),
      fetchImpl: async () => response({ Organisations: [{ IsDemoCompany: false, OrganisationStatus: 'ACTIVE' }] }),
      nowMs: Date.parse('2026-09-28T12:00:00Z')
    }),
    /not independently attested as a Demo Company/
  );
});

test('Xero demo proof redacts token and tenant identifiers from evidence', async () => {
  const result = await certifyProviderSandbox({
    providerKey: 'xero',
    candidateSha: SHA,
    resolveSecretBundle: async () => ({ accessToken: 'secret-token', tenantId: 'tenant-1' }),
    fetchImpl: async () => response({ Organisations: [{ IsDemoCompany: true, OrganisationStatus: 'ACTIVE', OrganisationID: 'org-1' }] }),
    nowMs: Date.parse('2026-09-28T12:00:00Z')
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, 'PASS');
  assert.equal(result.connectionValidation.status, 'CONNECTION_AND_SAMPLE_VERIFIED');
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('tenant-1'), false);
  assert.equal(result.request.headers.Authorization, '[REDACTED]');
  assert.equal(result.request.headers['xero-tenant-id'], '[REDACTED]');
});

test('Gusto demo proof uses only the dedicated demo host and redacts company identity', async () => {
  let observed;
  const result = await certifyProviderSandbox({
    providerKey: 'gusto-embedded-payroll',
    candidateSha: SHA,
    resolveSecretBundle: async ref => {
      assert.equal(ref, 'secret://provider/gusto/demo-company');
      return { accessToken: 'gusto-secret', companyId: 'company-123' };
    },
    fetchImpl: async (url, options) => {
      observed = { url, options };
      return response({ name: 'Synthetic Demo Manufacturer' });
    },
    nowMs: Date.parse('2026-09-28T12:00:00Z')
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, 'PASS');
  assert.equal(result.evidenceLevel, 'sandbox-authenticated');
  assert.equal(new URL(observed.url).hostname, 'api.gusto-demo.com');
  assert.equal(result.request.path, '/v1/companies/{company_id}');
  assert.equal(result.request.headers.Authorization, '[REDACTED]');
  assert.equal(serialized.includes('gusto-secret'), false);
  assert.equal(serialized.includes('company-123'), false);
});

test('candidate identity is mandatory and exact', async () => {
  await assert.rejects(
    certifyProviderSandbox({
      providerKey: 'sap-s4hana',
      candidateSha: 'not-a-sha',
      resolveSecretBundle: async () => ({ apiKey: 'x' }),
      fetchImpl: async () => response({ value: [] })
    }),
    /Exact 40-character VECTOR candidate SHA/
  );
});
