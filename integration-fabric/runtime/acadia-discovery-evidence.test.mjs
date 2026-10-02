import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {evaluateEvidenceProvenance} from './evidence-provenance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

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

test('Acadia unresolved interface passes fabric conformance without gaining an adapter or evidence promotion',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/conformance.mjs',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const connector=connectorById('acadia-performance-platform');
  assert.equal(connector.evidenceLevel,'discovery-queued');
  assert.deepEqual(connector.adapters,[]);
  assert.equal(connector.security.writeEnabled,false);
});

test('fabric conformance rejects a protocol-less Acadia record that loses its unresolved interface declaration',()=>{
  const workspaceRoot=fileURLToPath(new URL('../../',import.meta.url));
  const fixture=fs.mkdtempSync(path.join(workspaceRoot,'.acadia-conformance-'));
  try {
    fs.cpSync(fileURLToPath(new URL('../',import.meta.url)),path.join(fixture,'integration-fabric'),{recursive:true});
    const cataloguePath=path.join(fixture,'integration-fabric/research-overlays/2026-09-20-1251.json');
    const catalogue=JSON.parse(fs.readFileSync(cataloguePath,'utf8'));
    const acadia=catalogue.systems.find(system=>system.id==='acadia-performance-platform');
    assert.ok(acadia);
    acadia.researchStatus='vendor-capability-verified';
    fs.writeFileSync(cataloguePath,JSON.stringify(catalogue)+'\n');
    const result=spawnSync(process.execPath,[path.join(fixture,'integration-fabric/scripts/conformance.mjs')],{cwd:fixture,encoding:'utf8'});
    assert.equal(result.status,1);
    assert.match(result.stderr,/A protocol-less system must explicitly declare the external interface unresolved: acadia-performance-platform/);
  } finally {
    const resolved=path.resolve(fixture);
    if(path.dirname(resolved)!==path.resolve(workspaceRoot)||!path.basename(resolved).startsWith('.acadia-conformance-'))throw new Error('Unsafe test fixture cleanup path.');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
});
