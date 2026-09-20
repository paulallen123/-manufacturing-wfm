import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {buildSourceScope,assertCheckpointScope} from './scope-partition.mjs';

test('Business Central is spec-verified and reuses standard REST/OData/webhook fabric',()=>{
  const connector=connectorById('microsoft-dynamics-365-business-central');
  assert.ok(connector);
  assert.equal(connector.evidenceLevel,'spec-verified');
  assert.equal(connector.security.writeEnabled,false);
  assert.equal(connector.security.arbitraryEndpointAllowed,false);
  assert.ok(connector.adapters.some(x=>x.id==='rest-openapi'));
  assert.ok(connector.adapters.some(x=>x.id==='odata'));
  assert.ok(connector.adapters.some(x=>x.id==='webhooks-events'));
});

test('Business Central cloud and on-prem source scopes are variant-aware',()=>{
  const connector=connectorById('microsoft-dynamics-365-business-central');
  assert.deepEqual(connector.sourceScope.requiredDimensionsByVariant.cloud,['tenant','environment','company']);
  assert.deepEqual(connector.sourceScope.requiredDimensionsByVariant.onPrem,['serverInstance','company']);
  assert.equal(connector.deploymentVariants.cloud.customerEdgeRequired,false);
  assert.equal(connector.deploymentVariants.onPrem.customerEdgeRequired,true);
  assert.equal(connector.deploymentVariants.onPrem.directCloudToPrivateNetworkAllowed,false);
});

test('Business Central source scope isolates companies and environments before checkpoint reuse',()=>{
  const required=['tenant','environment','company'];
  const a=buildSourceScope({providerId:'microsoft-dynamics-365-business-central',connectionId:'conn',resource:'itemLedgerEntries',tenant:'tenant-1',environment:'prod',company:'company-a',apiVersion:'v2.0',dataset:'items'},{requiredDimensions:required});
  const b=buildSourceScope({providerId:'microsoft-dynamics-365-business-central',connectionId:'conn',resource:'itemLedgerEntries',tenant:'tenant-1',environment:'prod',company:'company-b',apiVersion:'v2.0',dataset:'items'},{requiredDimensions:required});
  assert.notEqual(a.checkpointNamespace,b.checkpointNamespace);
  assert.throws(()=>assertCheckpointScope({scopeNamespace:a.checkpointNamespace},b),/scope mismatch/);
});

test('Business Central security/evidence blockers prevent auth promotion on documentation alone',()=>{
  const connector=connectorById('microsoft-dynamics-365-business-central');
  assert.equal(connector.nextEvidenceGate,'resolve-security-evidence-blockers-before-authentication');
  assert.ok(connector.evidenceBlockers.some(x=>/API\.ReadWrite\.All/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/exact read-route/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/on-premises/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/manufacturing data/i.test(x)));
  assert.ok(connector.evidenceBlockers.some(x=>/Webhook subscription/i.test(x)));
});
