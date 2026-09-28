#!/usr/bin/env node
import fs from 'node:fs';
import { certifyProviderSandbox, providerCertificationProfiles } from '../runtime/provider-certification.mjs';

const providerKey = process.argv[2];
if (!providerKey || !providerCertificationProfiles().includes(providerKey)) {
  console.error('Usage: node integration-fabric/scripts/certify-provider-sandbox.mjs <' + providerCertificationProfiles().join('|') + '>');
  process.exit(2);
}

function secretResolver(ref) {
  if (ref === 'secret://provider/sap-business-accelerator-hub/api-key') {
    return { apiKey: process.env.SAP_API_KEY };
  }
  if (ref === 'secret://provider/xero/demo-company') {
    return { accessToken: process.env.XERO_ACCESS_TOKEN, tenantId: process.env.XERO_TENANT_ID };
  }
  throw new Error('Unknown managed secret reference.');
}

const result = await certifyProviderSandbox({
  providerKey,
  candidateSha: process.env.VECTOR_CANDIDATE_SHA,
  resolveSecretBundle: secretResolver
});

fs.mkdirSync('integration-fabric/evidence/provider', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = 'integration-fabric/evidence/provider/' + providerKey + '-' + stamp + '.json';
fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, evidenceLevel: result.evidenceLevel, providerKey, vectorCandidateSha: result.vectorCandidateSha, output: out }, null, 2));
