'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'vector-demand-intelligence.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(actor={tenant:'alpha',email:'manager@alpha',id:'m1',role:'manager'},auth){
 const requests=[],cards=[],timers=[];let observer,currentActor=actor;
 const host={querySelector:()=>null,appendChild:card=>cards.push(card)};
 const sandbox={me:()=>currentActor,data:{},isEmployee:()=>currentActor?.role==='employee',Date,queueMicrotask,console,
  ...(auth===undefined?{}:{F:auth}),
  document:{documentElement:{},querySelector:selector=>selector==='.vector-concept-dashboard'?host:cards[0]||null,createElement:()=>({dataset:{},html:'',writes:0,set innerHTML(value){this.html=value;this.writes++;},remove(){const i=cards.indexOf(this);if(i>=0)cards.splice(i,1);}})},
  MutationObserver:class{constructor(callback){observer=callback;}observe(){}},
  window:{addEventListener(){}},setTimeout:callback=>timers.push(callback),
  fetch:async url=>new Promise((resolve,reject)=>requests.push({url,resolve,reject,tenant:currentActor?.tenant}))
 };
 vm.runInNewContext(source,sandbox,{filename:'vector-demand-intelligence.js'});
 return {api:sandbox.window.VectorDemandDecisionIntelligence,requests,cards,actor:value=>{currentActor=value;},mutate:()=>observer(),answer:(index,key,overrides={})=>requests[index].resolve({ok:true,json:async()=>({contractVersion:'VECTOR_DEMAND_DECISION_SUMMARY_V1',tenant:requests[index].tenant,topDemand:{decisionKey:key,signalCount:1,silentDemandSignals:0},...overrides})})};
}
test('employee or unverified identity never requests manager intelligence',async()=>{
 for(const actor of [{tenant:'alpha',email:'worker@alpha',role:'employee'},null,{}]){const h=harness(actor);void h.api.refresh();await flush();assert.equal(h.requests.length,0);}
});
test('authorised intelligence renders and ordinary mutations do not refetch within freshness window',async()=>{
 const h=harness();const request=h.api.refresh();h.answer(0,'alpha-demand');await request;await flush();assert.match(h.cards[0].html,/Alpha Demand/);for(let i=0;i<4;i++){h.mutate();await flush();}assert.equal(h.requests.length,1);assert.equal(h.cards[0].writes,1,'unchanged observer passes do not rewrite the card');
});
test('account switch clears the old card before waiting for the replacement response',async()=>{
 const h=harness();const first=h.api.refresh();h.answer(0,'alpha-demand');await first;await flush();
 h.actor({tenant:'beta',email:'manager@beta',id:'m2',role:'manager'});h.mutate();await flush();
 assert.equal(h.cards.length,0,'previous account data must disappear immediately');assert.equal(h.requests.length,2,'new account must not inherit old freshness timer');
 h.answer(1,'beta-demand');await flush();assert.match(h.cards[0].html,/Beta Demand/);assert.doesNotMatch(h.cards[0].html,/Alpha Demand/);
});
test('late previous-account success cannot replace a newer account result',async()=>{
 const h=harness();const first=h.api.refresh();h.actor({tenant:'beta',email:'manager@beta',id:'m2',role:'manager'});const second=h.api.refresh();assert.equal(h.requests.length,2);
 h.answer(1,'beta-demand');await second;await flush();h.answer(0,'alpha-demand');await first;await flush();assert.match(h.cards[0].html,/Beta Demand/);assert.doesNotMatch(h.cards[0].html,/Alpha Demand/);
});
test('role loss clears cached intelligence and rejects pending results',async()=>{
 const h=harness();const first=h.api.refresh();h.answer(0,'alpha-demand');await first;await flush();const pending=h.api.refresh();h.actor({tenant:'alpha',email:'manager@alpha',id:'m1',role:'employee'});h.mutate();await flush();assert.equal(h.cards.length,0);h.answer(1,'forbidden-demand');await pending;await flush();assert.equal(h.cards.length,0);assert.equal(h.requests.length,2);
});
test('late previous-account failure cannot clear a newer successful result',async()=>{
 const h=harness();const first=h.api.refresh();h.actor({tenant:'beta',email:'manager@beta',id:'m2',role:'manager'});const second=h.api.refresh();assert.equal(h.requests.length,2);h.answer(1,'beta-demand');await second;await flush();h.requests[0].reject(Error('old network failure'));await first;await flush();assert.match(h.cards[0].html,/Beta Demand/);
});
test('wrong tenant or response contract cannot populate the dashboard',async()=>{
 for(const overrides of [{tenant:'beta'},{contractVersion:'unknown'}]){const h=harness();const request=h.api.refresh();h.answer(0,'wrong-source',overrides);await request;await flush();assert.equal(h.cards.length,0);}
});
test('payroll and administrators retain authenticated intelligence access',async()=>{
 for(const role of ['payroll_admin','admin','superuser']){const h=harness({tenant:'alpha',email:role+'@alpha',id:role,role});const request=h.api.refresh();assert.equal(h.requests.length,1);h.answer(0,'current-demand');await request;await flush();assert.match(h.cards[0].html,/Current Demand/);}
});
test('real display-only me shape uses authenticated F.actor and fails closed after sign-out',async()=>{
 const auth={ready:true,actor:{tenant:'alpha',email:'payroll@alpha',personId:'pay1',role:'payroll_admin'}},h=harness({id:'pay1',name:'Payroll',costs:true},auth);
 const request=h.api.refresh();assert.equal(h.requests.length,1);h.answer(0,'payroll-demand',{tenant:'alpha'});await request;await flush();assert.match(h.cards[0].html,/Payroll Demand/);
 auth.ready=false;h.mutate();await flush();assert.equal(h.cards.length,0);assert.equal(h.requests.length,1);
});
