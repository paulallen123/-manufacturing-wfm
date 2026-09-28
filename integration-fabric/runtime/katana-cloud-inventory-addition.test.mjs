import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {missingRecordDisposition} from './dataset-coverage.mjs';

test('Katana reuses the REST/OpenAPI and webhook fabric at spec verification only',()=>{
  const connector=connectorById('katana-cloud-inventory');
  assert.ok(connector);
  assert.equal(connector.evidenceLevel,'spec-verified');
  assert.equal(connector.security.writeEnabled,false);
  assert.equal(connector.security.agentActionEnabled,false);
  assert.equal(connector.security.unauthenticatedWebhookAllowed,false);
  assert.equal(connector.security.webhookAuthenticationRequired,true);
  assert.equal(connector.security.customerEdgeRequired,false);
  assert.ok(connector.protocols.includes('REST'));
  assert.ok(connector.protocols.includes('OpenAPI'));
  assert.ok(connector.protocols.includes('webhooks'));
  assert.ok(connector.adapters.some(x=>x.id==='rest-openapi'));
});

test('Katana account-wide inventory signals are sparse evidence and cannot delete inventory',()=>{
  const connector=connectorById('katana-cloud-inventory');
  const signals=connector.dataCoverage.find(x=>x.dataset==='inventory-signals');
  assert.ok(signals);
  assert.equal(signals.kind,'sparse-projection');
  assert.match(signals.absenceMeaning,/no-demand-in-30-day-window/);
  assert.equal(missingRecordDisposition(signals),'do-not-delete');
});

test('Katana full inventory remains non-authoritative until account/location/pagination scope is proven',()=>{
  const connector=connectorById('katana-cloud-inventory');
  const inventory=connector.dataCoverage.find(x=>x.dataset==='inventory');
  assert.ok(inventory);
  assert.equal(inventory.kind,'complete-snapshot');
  assert.equal(inventory.scopeProven,false);
  assert.equal(inventory.pageComplete,false);
  assert.equal(inventory.authoritativeForExistence,false);
  assert.equal(missingRecordDisposition(inventory),'do-not-delete');
  assert.equal(connector.security.missingRecordDeletionRequiresAuthoritativeCoverage,true);
  assert.equal(connector.security.partialDatasetMayInferDeletion,false);
});

test('Katana mutation and MCP authority remain excluded and security blockers are explicit',()=>{
  const connector=connectorById('katana-cloud-inventory');
  assert.equal(connector.staticCredentialAuthority.credentialType,'bearer-api-key');
  assert.equal(connector.staticCredentialAuthority.canonicalHost,'api.katanamrp.com');
  assert.ok(connector.evidenceBlockers.some(x=>/mutation/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/invalid filter/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/webhook registration/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/MCP/i.test(x)));
});

test('global connector registry fail-closes partial datasets for every provider',()=>{
  const connector=connectorById('katana-cloud-inventory');
  assert.equal(connector.schemaNegotiation.coverageSemanticsRequiredForDeletion,true);
  assert.equal(connector.security.missingRecordDeletionRequiresAuthoritativeCoverage,true);
  assert.equal(connector.security.partialDatasetMayInferDeletion,false);
});
