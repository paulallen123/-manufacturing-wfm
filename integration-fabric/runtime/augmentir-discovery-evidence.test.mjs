import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';

test('Augmentir is catalogued with reusable REST and OData routes but remains discovery-queued',()=>{
  const c=connectorById('augmentir-connected-worker');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.protocols,['REST','OData']);
  const adapterIds=c.adapters.map(x=>x.id);
  assert.ok(adapterIds.includes('rest-openapi'));
  assert.ok(adapterIds.includes('odata'));
  assert.equal(c.discoveryStrategy,'vendor-metadata-or-api-catalog-first');
  assert.equal(c.nextEvidenceGate,'spec-verification');
});

test('Augmentir normal connector stays read-only and does not inherit agent or management authority',()=>{
  const c=connectorById('augmentir-connected-worker');
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
  assert.equal(c.security.industrialControlEnabled,false);
  assert.equal(c.security.crossScopeReadEnabled,false);
  assert.equal(c.security.superAdminCredentialAllowed,false);
});

test('Augmentir maps skills, execution and maintenance context into WFM without treating execution as payroll truth',()=>{
  const c=connectorById('augmentir-connected-worker');
  for(const target of [
    'worker',
    'team',
    'skill',
    'qualification',
    'qualification-requirement',
    'training-assignment',
    'training-completion',
    'worker-activity-context',
    'production-demand',
    'maintenance-demand',
    'quality-event',
    'safety-event',
    'asset',
    'shift-outcome'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});
