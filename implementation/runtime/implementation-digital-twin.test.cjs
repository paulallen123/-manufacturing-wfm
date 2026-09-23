'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTwinRevision, changeImpact } = require('./implementation-digital-twin.cjs');

const at='2026-09-21T15:30:00Z';
function base(tenant='alpha') {
  return createTwinRevision({
    tenant,
    nodes: [
      {id:'tenant',type:'tenant',source:'contract',observedAt:at,verified:true,data:{name:'Alpha'}},
      {id:'site:tamworth',type:'site',source:'scope',observedAt:at,verified:true,data:{name:'Tamworth'}},
      {id:'system:hcm',type:'system',source:'discovery',observedAt:at,verified:true,data:{name:'HCM'}},
      {id:'integration:hcm',type:'integration',source:'integration-hub',observedAt:at,verified:true,state:'ACTIVE',data:{risk:'LOW'}},
      {id:'role:manager',type:'role',source:'identity',observedAt:at,verified:true,data:{}},
      {id:'training:integration-health',type:'training',source:'learning-engine',observedAt:at,verified:true,data:{}},
      {id:'test:people-sync',type:'test',source:'proof',observedAt:at,verified:true,state:'PASS',data:{}},
      {id:'gate:source-systems',type:'readiness-gate',source:'implementation',observedAt:at,verified:true,state:'PASS',data:{}}
    ],
    edges: [
      {from:'tenant',to:'site:tamworth',relation:'contains',source:'scope',observedAt:at,verified:true},
      {from:'site:tamworth',to:'system:hcm',relation:'uses',source:'scope',observedAt:at,verified:true},
      {from:'system:hcm',to:'integration:hcm',relation:'connected-by',source:'integration-hub',observedAt:at,verified:true},
      {from:'integration:hcm',to:'test:people-sync',relation:'proven-by',source:'proof',observedAt:at,verified:true},
      {from:'test:people-sync',to:'gate:source-systems',relation:'satisfies',source:'implementation',observedAt:at,verified:true},
      {from:'integration:hcm',to:'role:manager',relation:'operated-by',source:'learning-engine',observedAt:at,verified:true},
      {from:'role:manager',to:'training:integration-health',relation:'requires',source:'learning-engine',observedAt:at,verified:true}
    ]
  });
}

test('revision is deterministic regardless of input ordering',()=>{
  const a=base();
  const b=createTwinRevision({tenant:a.tenant,nodes:[...a.nodes].reverse(),edges:[...a.edges].reverse()});
  assert.equal(a.revision,b.revision);
});

test('integration degradation propagates impact to proof, readiness and role learning',()=>{
  const before=base();
  const nodes=before.nodes.map(n=>n.id==='integration:hcm'
    ? {...n,state:'DEGRADED',verified:false,data:{risk:'HIGH',failureClass:'SCHEMA_DRIFT'}}
    : n);
  const after=createTwinRevision({tenant:'alpha',nodes,edges:before.edges});
  const impact=changeImpact(before,after);
  assert.deepEqual(impact.changed,['integration:hcm']);
  assert.ok(impact.affected.integrations.includes('integration:hcm'));
  assert.ok(impact.affected.tests.includes('test:people-sync'));
  assert.ok(impact.affected.readiness.includes('gate:source-systems'));
  assert.ok(impact.affected.roles.includes('role:manager'));
  assert.ok(impact.affected.training.includes('training:integration-health'));
  assert.equal(impact.authority,'APPROVAL_REQUIRED');
});

test('cross-tenant comparison is denied',()=>{
  assert.throws(()=>changeImpact(base('alpha'),base('beta')),/Cross-tenant/);
});

test('unknown edge target fails closed',()=>{
  assert.throws(()=>createTwinRevision({
    tenant:'alpha',
    nodes:[{id:'tenant',type:'tenant',source:'contract',observedAt:at,verified:true}],
    edges:[{from:'tenant',to:'missing',relation:'contains',source:'scope',observedAt:at,verified:true}]
  }),/unknown node/);
});


test('research-aligned manufacturing asset types are additive and provenance-bound',()=>{
  const revision=createTwinRevision({
    tenant:'alpha',
    nodes:[
      {id:'machine:line4',type:'machine',source:'mes',observedAt:at,verified:true,data:{}},
      {id:'material:batch7',type:'material',source:'erp',observedAt:at,verified:true,data:{}},
      {id:'energy:meter1',type:'energy',source:'meter',observedAt:at,verified:true,data:{}},
      {id:'cash:order9',type:'cash-commitment',source:'erp',observedAt:at,verified:true,data:{}},
      {id:'knowledge:sop4',type:'knowledge',source:'qms',observedAt:at,verified:true,data:{}}
    ],
    edges:[
      {from:'machine:line4',to:'material:batch7',relation:'consumes',source:'mes',observedAt:at,verified:true},
      {from:'machine:line4',to:'energy:meter1',relation:'uses',source:'meter',observedAt:at,verified:true},
      {from:'cash:order9',to:'machine:line4',relation:'depends-on',source:'erp',observedAt:at,verified:true},
      {from:'machine:line4',to:'knowledge:sop4',relation:'governed-by',source:'qms',observedAt:at,verified:true}
    ]
  });
  assert.equal(revision.nodes.length,5);
  assert.equal(revision.edges.length,4);
  assert.throws(()=>createTwinRevision({tenant:'alpha',nodes:[{id:'m',type:'machine'}],edges:[]}),/source and observedAt/);
});
