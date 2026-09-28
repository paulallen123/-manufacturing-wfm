import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {evaluateEvidenceProvenance} from './evidence-provenance.mjs';

test('Acadia stays discovery-queued until an authoritative technical integration contract exists',()=>{
  const c=connectorById('acadia-performance-platform');
  assert.ok(c);
  assert.equal(c.evidenceLevel,'discovery-queued');
  assert.deepEqual(c.protocols,[]);
  assert.deepEqual(c.adapters,[]);
  assert.equal(c.discoveryStrategy,'vendor-specific-discovery');
  assert.equal(c.nextEvidenceGate,'spec-verification');
  assert.equal(c.security.readOnlyDefault,true);
  assert.equal(c.security.writeEnabled,false);
  assert.equal(c.security.managementPlaneEnabled,false);
  assert.equal(c.security.agentActionEnabled,false);
});

test('third-party generated API material cannot promote Acadia to spec-verified',()=>{
  const result=evaluateEvidenceProvenance({
    claimedLevel:'spec-verified',
    sources:[
      {
        kind:'vendor-docs',
        url:'https://www.acadia-software.com/industries/manufacturing/',
        providerOwned:true,
        confirmsIntegrationSurface:false
      },
      {
        kind:'third-party-generated-openapi',
        url:'https://apis.io/providers/acadia/',
        providerOwned:false,
        confirmsIntegrationSurface:true
      }
    ]
  });
  assert.equal(result.canClaimLevel,false);
  assert.equal(result.maxSafeLevel,'discovery-queued');
  assert.equal(result.authoritativeSources,0);
});

test('provider-owned or authorised technical evidence can satisfy the reusable provenance gate',()=>{
  const result=evaluateEvidenceProvenance({
    claimedLevel:'spec-verified',
    sources:[{
      kind:'vendor-api-docs',
      url:'https://vendor.example/api-docs',
      providerOwned:true,
      confirmsIntegrationSurface:true
    }]
  });
  assert.equal(result.canClaimLevel,true);
  assert.equal(result.authoritativeSources,1);
});

test('Acadia contributes skills, training, compliance and production-readiness WFM mappings without inventing an adapter',()=>{
  const c=connectorById('acadia-performance-platform');
  for(const target of [
    'worker',
    'team',
    'skill',
    'qualification',
    'qualification-requirement',
    'training-assignment',
    'training-completion',
    'production-demand',
    'compliance-event'
  ]) assert.ok(c.canonicalTargets.includes(target),target);
});
