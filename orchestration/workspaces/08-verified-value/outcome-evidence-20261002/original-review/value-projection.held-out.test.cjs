'use strict';const fs=require('node:fs'),path=require('node:path'),test=require('node:test'),assert=require('node:assert/strict');
const lane=path.resolve(__dirname,'../lane08-value'),{projectDecisionOutcomeEvidence:project}=require(path.join(lane,'operations/runtime/decision-outcome-evidence-projection.cjs')),{createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require(path.join(lane,'operations/runtime/decision-episode.cjs')),{createDecisionOutcomeProof,digest}=require(path.join(lane,'operations/runtime/decision-outcome-proof.cjs'));
const observations=[];const copy=x=>structuredClone(x),rehash=p=>{const{proofDigest,...core}=p;p.proofDigest=digest(core);return p;};
function proof({episode='e1',classification='REALISED_FINANCIAL',finance='finance:1',currency='GBP',baseline=520}={}){
 const e=createDecisionEpisode({tenant:'t1',site:'s1',decisionType:'absence',triggerId:episode,triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'c1',mode:'HUMAN_APPROVAL',sourceEvidence:['source:'+episode],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:500}},{id:'reassign',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:300}}]});
 const selected=selectDecisionOption(e,{optionId:'reassign',selectedAt:'2026-09-22T08:05:00Z',actorRef:'manager',authorityDecision:'HUMAN_APPROVED'}),completed=recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['result:'+episode],actual:{labourCost:320}});
 return createDecisionOutcomeProof({episode:completed,metric:'labourCost',direction:'MINIMIZE',classification,baselineActual:baseline,baselineEvidenceRefs:['baseline:'+episode],financeEvidenceRefs:[finance],currency,measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}});
}
const call=proofs=>project({tenant:'t1',proofs});
test.after(()=>fs.writeFileSync(path.join(__dirname,'value-projection.observations.json'),JSON.stringify({sourceBlob:'9b0ccf4b7a6f9a074b711d0add1713686f3e8729',observations},null,2)));
test('canonical classifications remain declarations without any value/authentication/execution/learning promotion',()=>{
 const result=call([proof(),proof({episode:'e2',classification:'VERIFIED_OPERATIONAL'}),proof({episode:'e3',classification:'SIMULATED'})]);assert.equal(result.groups.length,3);assert.equal(result.aggregateFinancialValue,null);assert.equal(result.executionAuthority,'NONE');assert.equal(result.learningAuthority,false);assert.equal(result.financialAttributionAuthority,false);assert.equal(result.sourceAuthentication,'NOT_ESTABLISHED_BY_THIS_PROJECTION');assert.ok(Object.isFrozen(result.groups[0].declarations[0].predicted));assert.match(result.claimBoundary,/does not prove causality/);
});
test('exact repeated canonical digest dedupe ignores object identity/key order and preserves copy count',()=>{
 const a=proof(),b=copy(a);b.measurementWindow={end:b.measurementWindow.end,start:b.measurementWindow.start};assert.equal(digest((({proofDigest,...core})=>core)(b)),b.proofDigest);const r=call([a,b,copy(a)]);assert.equal(r.uniqueDeclarationCount,1);assert.equal(r.repeatedDeclarations[0].copies,3);
});
test('divergent same semantic financial window conflicts despite property insertion order',()=>{
 const a=proof(),b=copy(proof({baseline:530}));b.measurementWindow={end:b.measurementWindow.end,start:b.measurementWindow.start};const r=call([a,b]);observations.push({name:'window-order-conflict',inputProofs:[a,b],result:r});assert.equal(r.uniqueDeclarationCount,2);assert.equal(r.conflictingDeclarations.length,1);assert.deepEqual(new Set(r.conflictingDeclarations[0].proofDigests),new Set([a.proofDigest,b.proofDigest]));
});
test('same declared tuple divergent baseline/selected option/result warns and never aggregates',()=>{
 const a=proof(),b=proof({baseline:530}),r=call([a,b]);assert.equal(r.conflictingDeclarations.length,1);assert.equal(r.aggregateFinancialValue,null);
});
test('shared finance reference across distinct realised declarations warns exactly once per proof',()=>{
 const a=proof(),b=copy(proof({episode:'e2'}));b.evidence.finance.push('finance:1');rehash(b);const r=call([a,b,copy(a)]);assert.equal(r.potentialFinanceEvidenceOverlap.length,1);assert.equal(r.potentialFinanceEvidenceOverlap[0].proofDigests.length,2);assert.equal(r.uniqueDeclarationCount,2);
});
test('cross classification finance-reference scope is observed without claiming financial allocation',()=>{
 const a=proof(),b=proof({episode:'e2',classification:'VERIFIED_OPERATIONAL'}),r=call([a,b]);observations.push({name:'finance-cross-classification-scope',inputProofs:[a,b],result:r});assert.equal(r.aggregateFinancialValue,null);assert.equal(r.financialAttributionAuthority,false);
});
test('same episode different currencies stays separated and visibly conflicting rather than summed',()=>{
 const r=call([proof(),proof({currency:'USD'})]);assert.equal(r.groups.length,2);assert.equal(r.conflictingDeclarations.length,1);assert.equal(r.aggregateFinancialValue,null);
});
test('malformed scope, unsupported class/direction, stale digest and rehashed arithmetic reject',()=>{
 for(const mutate of [p=>p.tenant='t2',p=>p.classification='PAID',p=>p.direction='DOWN',p=>p.predicted.selected=301,p=>{p.observed.improvement=999;rehash(p);},p=>{p.realisedFinancialOutcome=false;rehash(p);}]){const p=copy(proof());mutate(p);assert.throws(()=>call([p]));}
});
for(const[name,mutate]of [
 ['incorrect numeric predictionError',p=>p.observed.predictionError=999],
 ['nonnumeric predictionError',p=>p.observed.predictionError='paid'],
 ['missing predictionError',p=>delete p.observed.predictionError],
 ['missing observedAt',p=>delete p.observed.observedAt],
 ['invalid calendar observedAt',p=>p.observed.observedAt='2026-02-30T16:00:00.000Z'],
 ['malformed observedAt',p=>p.observed.observedAt='not-a-time'],
 ['invalid calendar measurement window',p=>p.measurementWindow={start:'2026-02-30T08:00:00.000Z',end:'2026-03-03T16:00:00.000Z'}],
 ['numeric measurement timestamps',p=>p.measurementWindow={start:123,end:124}],
 ['simulated financial currency/window',p=>{p.currency='GBP';p.measurementWindow={start:'2026-09-22T08:00:00.000Z',end:'2026-09-22T16:00:00.000Z'};}]
])test('rehashed noncanonical declaration rejects '+name,()=>{
 const p=copy(proof({classification:name.startsWith('simulated')?'SIMULATED':'REALISED_FINANCIAL'}));mutate(p);rehash(p);let result,error;try{result=call([p]);}catch(e){error=e;}observations.push({name,inputProof:p,result:result||null,error:error?.message||null});assert.ok(error,'Noncanonical content was accepted');
});
const unsafe=[
 ['top-level accessor',(x,inc)=>Object.defineProperty(x,'proofs',{get(){inc();return[];},enumerable:true})],
 ['nested accessor',(x,inc)=>Object.defineProperty(x.proofs[0].observed,'result',{get(){inc();return320;},enumerable:true})],
 ['indexed accessor',(x,inc)=>Object.defineProperty(x.proofs,'0',{get(){inc();return{};},enumerable:true})],
 ['top-level proxy',(x,inc)=>new Proxy(x,{get(t,k){inc();return t[k];},ownKeys(t){inc();return Reflect.ownKeys(t);}})],
 ['nested proxy',(x,inc)=>{x.proofs[0].evidence=new Proxy(x.proofs[0].evidence,{get(t,k){inc();return t[k];},ownKeys(t){inc();return Reflect.ownKeys(t);}});}],
 ['array override',(x,inc)=>{x.proofs.map=()=>{inc();return[];};}],
 ['serializer',(x,inc)=>{x.proofs[0].toJSON=()=>{inc();return{};};}],
 ['coercion hook',(x,inc)=>{x.proofs[0].metric={toString(){inc();return'labourCost';}};}],
 ['sparse proof array',x=>{delete x.proofs[0];}],
 ['record symbol',x=>{x.proofs[0][Symbol('hint')]=1;}],
 ['cycle',x=>{x.proofs[0].hint=x;}],
 ...[NaN,Infinity,-Infinity].map((v,i)=>['nonfinite'+i,x=>{x.proofs[0].hint=v;}])
];
for(const[name,mutate]of unsafe)test('rejects hostile '+name+' before caller code',()=>{
 let calls=0,x={tenant:'t1',proofs:[copy(proof())]},replacement=mutate(x,()=>calls++);if(replacement)x=replacement;assert.throws(()=>project(x));assert.equal(calls,0);
});
test('source inputs and outputs stay detached; unknown hints cannot create verified status',()=>{
 const p=copy(proof()),before=JSON.stringify(p),r=call([p]);assert.equal(JSON.stringify(p),before);p.observed.result=999;assert.equal(r.groups[0].declarations[0].observed.result,320);assert.throws(()=>r.groups[0].declarations[0].observed.result=900,TypeError);const empty=project({tenant:'t1',proofs:[],verified:true,aggregateFinancialValue:100000});assert.equal(empty.uniqueDeclarationCount,0);assert.equal(empty.aggregateFinancialValue,null);assert.equal(empty.learningAuthority,false);
});
