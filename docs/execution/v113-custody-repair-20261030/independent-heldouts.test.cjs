'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const target=process.env.V113_TARGET||path.join(__dirname,'v2');
const E=require(path.join(target,'decision-episode.cjs'));
const P=require(path.join(target,'decision-outcome-proof.cjs'));
const C=x=>structuredClone(x);
function initial({base=500,chosen=300,mode='HUMAN_APPROVAL'}={}) {
  return E.createDecisionEpisode({tenant:'heldout',site:'test',decisionType:'recovery',triggerId:'heldout:1',
    triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'heldout:rev',mode,
    sourceEvidence:['heldout:source'],objective:{labourCost:1},options:[
      {id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:base}},
      {id:'choice',feasible:true,policyAllowed:true,hardConstraintsPassed:true,prediction:{labourCost:chosen}}
    ]});
}
function selected(options={}) {
  return E.selectDecisionOption(initial(options),{optionId:'choice',selectedAt:'2026-09-22T09:00:00Z',
    actorRef:'heldout:approved-human',authorityDecision:options.mode==='SHADOW'?'SHADOW_OBSERVED':'HUMAN_APPROVED'});
}
function record(s=selected(),actual=320) {
  return E.recordDecisionOutcome(s,{observedAt:'2026-09-22T16:00:00Z',actual:{labourCost:actual},evidenceRefs:['heldout:actual']});
}
function proofInput(episode=record(),extra={}) {
  return {episode,metric:'labourCost',direction:'MINIMIZE',classification:'REALISED_FINANCIAL',
    baselineActual:520,baselineEvidenceRefs:['heldout:baseline'],financeEvidenceRefs:['heldout:finance'],currency:'GBP',
    measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'},...extra};
}
function proof(episode=record(),extra={}) {return P.createDecisionOutcomeProof(proofInput(episode,extra));}
function rehashProof(p){const {proofDigest,...core}=p;p.proofDigest=P.digest(core);return p;}
function sealSelection(s){s.selectionDigest=E.digest({episodeId:s.episodeId,selection:s.selection});return s;}
function sealOutcome(e){e.outcomeDigest=E.digest({episodeId:e.episodeId,selection:e.selection,outcome:e.outcome});return e;}

test('legitimate finite synthetic lifecycle survives JSON transport and maps cost delta',()=>{
  const p=proof(record(JSON.parse(JSON.stringify(selected()))));
  assert.equal(p.observed.improvement,200);
  const a=P.toAdaptiveOutcomeInput(JSON.parse(JSON.stringify(p)));
  assert.equal(a.verified,true);assert.equal(a.result-a.baseline,200);
  assert.equal(a.memoryGrantsAuthority,false);assert.equal(a.crossTenantRawMemory,false);
});
for(const raw of ['320',true,false,[],[320],null,NaN,Infinity,-Infinity]){
  test('record intake rejects explicit nonnumeric/nonfinite actual '+String(raw),()=>{
    assert.throws(()=>record(selected(),raw),/finite|numeric|actual/i);
  });
}
test('omitted actual metrics remain null while an explicit numeric zero survives',()=>{
  const e=E.recordDecisionOutcome(selected(),{observedAt:'2026-09-22T16:00:00Z',actual:{labourCost:0},evidenceRefs:['heldout:actual']});
  assert.equal(e.outcome.actual.labourCost,0);assert.equal(e.outcome.actual.energyCost,null);
  assert.equal(proof(e).observed.improvement,520);
});
for(const [field,value] of [['actorRef','forged:actor'],['optionId','do-nothing'],['authorityDecision','POLICY_GATE_PASSED'],['selectedAt','2026-09-22T09:01:00.000Z'],['executionPermitted',false]]){
  test('stale selected '+field+' cannot acquire outcome custody',()=>{
    const s=C(selected());s.selection[field]=value;
    assert.throws(()=>record(s),/integrity|eligible/i);
  });
}
test('rewriting only outcome digest does not conceal a changed selected actor',()=>{
  const e=C(record());e.selection.actorRef='forged:actor';sealOutcome(e);
  assert.throws(()=>proof(e),/selection.*integrity/i);
});
test('stale outcome actual/evidence/timestamp cannot acquire proof',()=>{
  for(const change of [e=>e.outcome.actual.labourCost=0,e=>e.outcome.evidenceRefs[0]='replacement',e=>e.outcome.observedAt='2026-09-22T15:59:00.000Z']){
    const e=C(record());change(e);assert.throws(()=>proof(e),/integrity/i);
  }
});
test('recomputed public checksums do not bypass chronology or authority shape',()=>{
  const early=sealSelection(Object.assign(C(selected()),{}));early.selection.selectedAt='2026-09-22T07:59:00.000Z';sealSelection(early);
  assert.throws(()=>record(early),/before|trigger/i);
  const out=C(record());out.outcome.observedAt='2026-09-22T08:59:00.000Z';sealOutcome(out);
  assert.throws(()=>proof(out),/before|selection/i);
  const authority=C(selected());authority.selection.authorityDecision='POLICY_GATE_PASSED';sealSelection(authority);
  assert.throws(()=>record(authority),/authority.*integrity/i);
});
test('public checksum limit: fully recomputed selected actor is accepted but grants no human authentication',()=>{
  const s=C(selected());s.selection.actorRef='unprotected:asserted-actor';sealSelection(s);
  const p=proof(record(s));assert.equal(P.toAdaptiveOutcomeInput(p).memoryGrantsAuthority,false);
});
for(const direction of ['MINIMIZE','MAXIMIZE']){
  test('finite operands cannot yield '+direction+' infinite observed delta',()=>{
    assert.throws(()=>proof(record(selected({base:0,chosen:0}),-Number.MAX_VALUE),{baselineActual:Number.MAX_VALUE,direction}),/finite|improvement/i);
  });
  test('finite predictions cannot yield '+direction+' infinite predicted delta',()=>{
    assert.throws(()=>proof(record(selected({base:Number.MAX_VALUE,chosen:-Number.MAX_VALUE}),0),{direction}),/finite|improvement/i);
  });
}
test('finite actual and prediction cannot yield infinite error at recording',()=>{
  assert.throws(()=>record(selected({base:0,chosen:-Number.MAX_VALUE}),Number.MAX_VALUE),/finite|error/i);
});
test('rehashed nonfinite and inconsistent proof arithmetic cannot enter learning',()=>{
  for(const [section,key,value] of [['observed','improvement',Infinity],['observed','predictionError',Infinity],['predicted','improvement',Infinity],['predicted','baseline',-Number.MAX_VALUE],['observed','result',0]]){
    const p=C(proof());p[section][key]=value;rehashProof(p);
    assert.throws(()=>P.toAdaptiveOutcomeInput(p),/finite|integrity/i,section+'.'+key);
  }
});
test('producer and consumer reject accessors before invoking them',()=>{
  let calls=0;const i=proofInput(C(record()));Object.defineProperty(i.episode.outcome.actual,'labourCost',{enumerable:true,get(){calls++;return 0;}});
  assert.throws(()=>P.createDecisionOutcomeProof(i),/accessor|data|finite/i);
  const p=C(proof());Object.defineProperty(p.observed,'result',{enumerable:true,get(){calls++;return 320;}});
  assert.throws(()=>P.toAdaptiveOutcomeInput(p),/accessor|data/i);
  assert.equal(calls,0);
});
test('producer and consumer reject nested proxies without invoking traps',()=>{
  let calls=0;const trap={get(){calls++;return undefined},ownKeys(){calls++;return []},getPrototypeOf(){calls++;return Object.prototype}};
  const i=proofInput(C(record()));i.episode.outcome.actual=new Proxy(i.episode.outcome.actual,trap);
  assert.throws(()=>P.createDecisionOutcomeProof(i),/prox|data/i);
  const p=C(proof());p.evidence.result=new Proxy(p.evidence.result,trap);
  assert.throws(()=>P.toAdaptiveOutcomeInput(p),/prox|data/i);
  assert.equal(calls,0);
});
test('proof nested graph and adaptive result are deeply immutable',()=>{
  function frozen(x){if(x&&typeof x==='object'){assert.ok(Object.isFrozen(x));for(const c of Object.values(x))frozen(c);}}
  const p=proof();frozen(p);frozen(P.toAdaptiveOutcomeInput(p));
  assert.throws(()=>{p.evidence.result[0]='changed';},TypeError);
  const changed=C(p);changed.evidence.finance[0]='changed';assert.throws(()=>P.toAdaptiveOutcomeInput(changed),/integrity/i);
});
test('financial observation must fall inside a nonempty measurement interval',()=>{
  for(const measurementWindow of [{start:'2026-09-22T16:01:00Z',end:'2026-09-22T17:00:00Z'},{start:'2026-09-22T15:00:00Z',end:'2026-09-22T15:59:00Z'},{start:'2026-09-22T16:00:00Z',end:'2026-09-22T16:00:00Z'}]){
    assert.throws(()=>proof(record(),{measurementWindow}),/window|end/i);
  }
});
test('simulation cannot enter adaptive learning',()=>{
  const p=proof(record(),{classification:'SIMULATED'});assert.equal(p.learningEligible,false);
  assert.throws(()=>P.toAdaptiveOutcomeInput(p),/verified/i);
});
