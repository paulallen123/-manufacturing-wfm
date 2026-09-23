'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {projectAssetIntelligence}=require('./asset-intelligence-projection.cjs');

const revision={tenant:'alpha',revision:'rev1',nodes:[
  {id:'p1',type:'person',state:'AVAILABLE',source:'hcm',observedAt:'2026-09-23T10:00:00Z',verified:true},
  {id:'m1',type:'machine',state:'RUNNING',source:'mes',observedAt:'2026-09-23T10:00:00Z',verified:true},
  {id:'e1',type:'energy',state:'PEAK',source:'meter',observedAt:'2026-09-20T10:00:00Z',verified:true},
  {id:'sys',type:'system',state:'ACTIVE',source:'discovery',observedAt:'2026-09-23T10:00:00Z',verified:true}
],edges:[{from:'m1',to:'p1',relation:'requires-skill-from',source:'mes',observedAt:'2026-09-23T10:00:00Z',verified:true}]};

test('projects manufacturing asset classes without creating a second authority graph',()=>{
  const out=projectAssetIntelligence(revision,{at:'2026-09-23T12:00:00Z',maxAgeMs:24*60*60*1000});
  assert.equal(out.assets.people.length,1);
  assert.equal(out.assets.machines.length,1);
  assert.equal(out.assets.energy[0].stale,true);
  assert.deepEqual(out.excludedNodeIds,['sys']);
  assert.equal(out.grantsExecutionAuthority,false);
});
