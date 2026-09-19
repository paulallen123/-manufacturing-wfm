'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTenantSnapshot,stateTimezone}=require('./vector-context-engine.cjs');

test('fresh snapshot aggregates people without retaining identities',()=>{
  const state={timezone:'Europe/London',staff:[
    {id:'1',name:'A',siteId:'plant-a',status:'present'},
    {id:'2',name:'B',siteId:'plant-a',status:'sick'},
    {id:'3',name:'C',siteId:'plant-b',status:'present'}
  ],requests:[{status:'approved',employee:'2'}]};
  const result=createTenantSnapshot(state,{role:'SITE_MANAGER',scope:'SITE',siteIds:['plant-a']});
  assert.equal(result.ok,true);
  assert.equal(result.snapshot.metrics.find(x=>x.label==='People in scope').value,2);
  assert.equal(result.snapshot.metrics.find(x=>x.label==='Present').value,1);
  assert.equal(result.snapshot.metrics.find(x=>x.label==='Absent').value,1);
  assert.equal(JSON.stringify(result).includes('name'),false);
  assert.equal(JSON.stringify(result).includes('employee'),false);
  assert.equal(result.timezone,'Europe/London');
});

test('site-scoped automation fails closed when state has no site dimension',()=>{
  const result=createTenantSnapshot({staff:[{id:'1',status:'present'}]},{siteIds:['plant-a']});
  assert.equal(result.ok,false);
  assert.equal(result.reason,'SCOPE_UNRESOLVED');
});

test('timezone accepts valid IANA zones and refuses unknown values',()=>{
  assert.equal(stateTimezone({timezone:'Europe/London'}),'Europe/London');
  assert.equal(stateTimezone({timezone:'Mars/Olympus'}),null);
});
