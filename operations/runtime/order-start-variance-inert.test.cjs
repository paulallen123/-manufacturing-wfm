'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessOrderStartVariance } = require('./order-start-variance.cjs');
const A='a'.repeat(64), B='b'.repeat(64), C='c'.repeat(64);
function fixture(){
  const scope={tenantId:'t',siteId:'s',lineId:'l',orderId:'o'};
  return {...scope,asOf:'2026-10-28T11:30:00.000Z',maxAgeMinutes:120,
    plan:{...scope,source:'ERP',recordId:'plan',revision:'r1',recordSha256:A,observedAt:'2026-10-28T09:30:00.000Z',complete:true,state:'PUBLISHED',plannedStart:'2026-10-28T10:00:00.000Z',plannedEnd:'2026-10-28T12:00:00.000Z'},
    actual:{...scope,source:'MES',recordId:'actual',revision:'r1',recordSha256:B,observedAt:'2026-10-28T10:45:00.000Z',complete:true,state:'STARTED',plannedRevision:'r1',plannedRecordSha256:A,actualStart:'2026-10-28T10:30:00.000Z'}};
}
test('active revision getter cannot change validated revision in advisory output',()=>{
  const x=fixture();let reads=0;
  Object.defineProperty(x.plan,'revision',{enumerable:true,get(){return ++reads===1?'r1':'r2';}});
  assert.throws(()=>assessOrderStartVariance(x),/INERT_RECORD/);
  assert.equal(reads,0);
});
test('active hash getter cannot turn linked hash into a different output hash',()=>{
  const x=fixture();let reads=0;
  Object.defineProperty(x.plan,'recordSha256',{enumerable:true,get(){return ++reads===1?A:C;}});
  assert.throws(()=>assessOrderStartVariance(x),/INERT_RECORD/);
  assert.equal(reads,0);
});
test('inert ordinary, frozen, and null-prototype records retain identical advisory',()=>{
  const a=fixture(), expected=assessOrderStartVariance(a);
  const frozen=fixture();Object.freeze(frozen.plan);Object.freeze(frozen.actual);Object.freeze(frozen);
  assert.deepEqual(assessOrderStartVariance(frozen),expected);
  const nullproto=fixture();nullproto.plan=Object.assign(Object.create(null),nullproto.plan);nullproto.actual=Object.assign(Object.create(null),nullproto.actual);
  assert.deepEqual(assessOrderStartVariance(nullproto),expected);
});
test('proxy input/record and hidden accessor extras cannot perform an active read',()=>{
  const a=fixture();let reads=0;
  const proxied=new Proxy(a.plan,{get(target,key,receiver){reads++;return Reflect.get(target,key,receiver);}});a.plan=proxied;
  assert.throws(()=>assessOrderStartVariance(a),/INERT_RECORD/);assert.equal(reads,0);
  const b=fixture();Object.defineProperty(b.actual,'unused',{enumerable:true,get(){reads++;return 'active';}});
  assert.throws(()=>assessOrderStartVariance(b),/INERT_RECORD/);assert.equal(reads,0);
});
