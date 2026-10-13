'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {screenMaintenanceWorkforce}=require('./maintenance-workforce-preflight.cjs');

const at='2026-10-13T10:00:00.000Z';
const start='2026-10-13T11:00:00.000Z';
const end='2026-10-13T12:00:00.000Z';
const scope={tenant:'tenant-a',site:'site-a'};
const provenance={source:'cmms',recordHash:'a'.repeat(64)};
function fixture(){return {
  now:at,maxEvidenceAgeMs:3600000,scope,
  workOrder:{id:'wo-1',revision:'r1',...scope,assetId:'asset-1',status:'OPEN',start,end,requiredSkills:['electrical'],requiredParts:[{id:'part-1',quantity:2}],observedAt:at,provenance},
  asset:{id:'asset-1',...scope,state:'MAINTENANCE_REQUIRED',observedAt:at,provenance:{source:'eam',recordHash:'b'.repeat(64)}},
  parts:[{id:'part-1',...scope,availableQuantity:2,observedAt:at,provenance:{source:'inventory',recordHash:'c'.repeat(64)}}],
  technicians:[{id:'tech-1',...scope,availableFrom:start,availableUntil:end,skills:[{id:'electrical',technicianId:'tech-1',...scope,observedAt:at,validUntil:end,provenance:{source:'training',recordHash:'e'.repeat(64)}}],observedAt:at,provenance:{source:'hcm',recordHash:'d'.repeat(64)}}]
};}
test('scoped current evidence yields advisory candidates without action authority',()=>{
  const result=screenMaintenanceWorkforce(fixture());
  assert.equal(result.status,'ADVISORY_CANDIDATES');
  assert.deepEqual(result.candidateTechnicianIds,['tech-1']);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.executionAuthority,false);
  assert.equal(result.providerWrite,false);
  assert.match(result.evidenceDigest,/^[a-f0-9]{64}$/);
});
test('foreign, stale, or insufficient evidence cannot be counted as ready',()=>{
  for(const mutate of [
    x=>x.asset.tenant='tenant-b',
    x=>x.parts[0].site='site-b',
    x=>x.parts[0].availableQuantity=1,
    x=>x.parts[0].observedAt='2026-10-13T08:00:00.000Z',
    x=>x.technicians[0].skills[0].validUntil=start,
    x=>x.technicians[0].skills[0].technicianId='tech-2',
    x=>x.technicians[0].skills[0].tenant='tenant-b',
    x=>x.technicians[0].tenant='tenant-b'
  ]){
    const x=fixture();mutate(x);
    const result=screenMaintenanceWorkforce(x);
    assert.equal(result.status,'BLOCKED');
    assert.deepEqual(result.candidateTechnicianIds,[]);
    assert.ok(result.blockers.length>0);
  }
});
test('unknown or duplicate evidence never fabricates a candidate',()=>{
  for(const mutate of [
    x=>x.workOrder.status='CLOSED',
    x=>x.workOrder.requiredSkills=['unknown'],
    x=>x.technicians.push(structuredClone(x.technicians[0])),
    x=>x.parts.push({...x.parts[0],availableQuantity:100}),
    x=>x.workOrder.provenance.recordHash='not-a-hash'
  ]){
    const x=fixture();mutate(x);
    const result=screenMaintenanceWorkforce(x);
    assert.equal(result.status,'BLOCKED');
    assert.deepEqual(result.candidateTechnicianIds,[]);
  }
});
test('malformed root input yields the declared validation error',()=>{
  for(const value of [null,[],42,''])
    assert.throws(()=>screenMaintenanceWorkforce(value),/Exact scope, UTC evaluation time/);
});
