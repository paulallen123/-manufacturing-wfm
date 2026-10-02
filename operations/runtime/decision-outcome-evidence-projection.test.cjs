'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDecisionEpisode,selectDecisionOption,recordDecisionOutcome}=require('./decision-episode.cjs');
const {createDecisionOutcomeProof,digest}=require('./decision-outcome-proof.cjs');
let project;try{({projectDecisionOutcomeEvidence:project}=require('./decision-outcome-evidence-projection.cjs'));}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e;}
function call(input){assert.equal(typeof project,'function','Missing pure outcome evidence audit');return project(input);}
function proof({id='episode-a',classification='REALISED_FINANCIAL',currency='GBP',finance='finance:a',baseline=520,actual=320,observedAt='2026-09-22T16:00:00Z'}={}){
 const episode=createDecisionEpisode({tenant:'alpha',site:'site',decisionType:'absence-recovery',triggerId:id,triggeredAt:'2026-09-22T08:00:00Z',contextRevision:'twin:fixture',mode:'HUMAN_APPROVAL',sourceEvidence:['input:'+id],objective:{labourCost:1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:500}},{id:'redeploy',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0,prediction:{labourCost:300}}]});
 const selected=selectDecisionOption(episode,{optionId:'redeploy',selectedAt:'2026-09-22T08:05:00Z',actorRef:'fixture:manager',authorityDecision:'HUMAN_APPROVED'}),completed=recordDecisionOutcome(selected,{observedAt,evidenceRefs:['result:'+id],actual:{labourCost:actual}});
 return createDecisionOutcomeProof({episode:completed,metric:'labourCost',direction:'MINIMIZE',classification,baselineActual:baseline,baselineEvidenceRefs:['baseline:'+id],financeEvidenceRefs:[finance],currency,measurementWindow:{start:'2026-09-22T08:00:00Z',end:'2026-09-22T16:00:00Z'}});
}
test('identical supplied proof content collapses independently of object identity',()=>{
 const p=proof(),result=call({tenant:'alpha',proofs:[p,JSON.parse(JSON.stringify(p))]});
 assert.equal(result.suppliedRecordCount,2);assert.equal(result.uniqueDeclarationCount,1);assert.equal(result.repeatedDeclarations[0].proofDigest,p.proofDigest);assert.equal(result.repeatedDeclarations[0].copies,2);
 assert.equal(result.aggregateFinancialValue,null);assert.equal(result.executionAuthority,'NONE');assert.equal(result.financialAttributionAuthority,false);
});
test('different currencies and declared classes remain distinct without summing',()=>{
 const result=call({tenant:'alpha',proofs:[proof(),proof({id:'episode-b',currency:'USD',finance:'finance:b'}),proof({id:'episode-c',classification:'SIMULATED'}),proof({id:'episode-d',classification:'VERIFIED_OPERATIONAL'})]});
 assert.equal(result.groups.length,4);assert.equal(result.uniqueDeclarationCount,4);assert.equal(result.groups.find(x=>x.declaredClassification==='SIMULATED').declarations[0].observed,null);
 assert.equal(result.aggregateFinancialValue,null);assert.equal(result.learningAuthority,false);
});
test('divergent content for one episode metric class and window is visibly ambiguous',()=>{
 const a=proof(),b=proof({baseline:530}),result=call({tenant:'alpha',proofs:[a,b]});
 assert.equal(result.uniqueDeclarationCount,2);assert.equal(result.conflictingDeclarations.length,1);assert.deepEqual(new Set(result.conflictingDeclarations[0].proofDigests),new Set([a.proofDigest,b.proofDigest]));
});
test('finance reference reuse is a warning rather than an allocation or realised total',()=>{
 const result=call({tenant:'alpha',proofs:[proof(),proof({id:'episode-b'})]});
 assert.equal(result.potentialFinanceEvidenceOverlap.length,1);assert.equal(result.potentialFinanceEvidenceOverlap[0].evidenceRef,'finance:a');assert.equal(result.aggregateFinancialValue,null);assert.match(result.claimBoundary,/does not prove causality/i);
});
test('tenant and digest tampering reject without altering the source declarations',()=>{
 const p=proof(),before=JSON.stringify(p);assert.throws(()=>call({tenant:'other',proofs:[p]}),/tenant/i);const bad=JSON.parse(before);bad.observed.improvement=999;assert.throws(()=>call({tenant:'alpha',proofs:[bad]}),/digest/i);assert.equal(JSON.stringify(p),before);
});
test('internally inconsistent rehashed declarations cannot promote simulation or alter arithmetic',()=>{
 for(const mutate of [p=>p.realisedFinancialOutcome=false,p=>p.observed.improvement=999]){const p=JSON.parse(JSON.stringify(proof()));mutate(p);const {proofDigest,...core}=p;p.proofDigest=digest(core);assert.throws(()=>call({tenant:'alpha',proofs:[p]}),/classification|improvement/i);}
});
test('getters proxies serializers and nonfinite declaration data reject before caller execution',()=>{
 for(const shape of ['getter','proxy','toJSON','nonfinite']){let calls=0,input={tenant:'alpha',proofs:[proof()]};if(shape==='getter')Object.defineProperty(input,'proofs',{get(){calls++;return [];}});if(shape==='proxy')input=new Proxy(input,{get(t,k,r){calls++;return Reflect.get(t,k,r);},ownKeys(t){calls++;return Reflect.ownKeys(t);}});if(shape==='toJSON')Object.defineProperty(input.proofs[0].evidence,'toJSON',{value(){calls++;return {};}});if(shape==='nonfinite')input.proofs[0]=JSON.parse(JSON.stringify(input.proofs[0])),input.proofs[0].observed.baseline=Infinity;assert.throws(()=>call(input));assert.equal(calls,0);}
});
test('output is detached and immutable and empty data does not invent outcomes',()=>{
 const p=proof(),result=call({tenant:'alpha',proofs:[p]});p.evidence.finance.push('late');assert.equal(result.groups[0].declarations[0].evidence.finance.length,1);assert.throws(()=>result.groups[0].declarations.push({}),TypeError);const empty=call({tenant:'alpha',proofs:[]});assert.equal(empty.uniqueDeclarationCount,0);assert.equal(empty.aggregateFinancialValue,null);
});

// Review regressions against the exact canonical producer contract.
const rehash=p=>{const{proofDigest,...core}=p;p.proofDigest=digest(core);return p;};
test('same semantic window detects divergent declarations independent of object property order',()=>{
 const a=proof(),b=structuredClone(proof({baseline:530}));b.measurementWindow={end:b.measurementWindow.end,start:b.measurementWindow.start};
 const result=call({tenant:'alpha',proofs:[a,b]});assert.equal(result.uniqueDeclarationCount,2);assert.equal(result.conflictingDeclarations.length,1);assert.deepEqual(new Set(result.conflictingDeclarations[0].proofDigests),new Set([a.proofDigest,b.proofDigest]));
});
for(const [name,mutate]of [
 ['wrong prediction error',p=>p.observed.predictionError=999],
 ['string prediction error',p=>p.observed.predictionError='20'],
 ['missing prediction error',p=>delete p.observed.predictionError],
 ['missing observed time',p=>delete p.observed.observedAt],
 ['impossible observed date',p=>p.observed.observedAt='2026-02-30T16:00:00.000Z'],
 ['malformed observed time',p=>p.observed.observedAt='not-a-time'],
 ['impossible financial window',p=>p.measurementWindow={start:'2026-02-30T08:00:00.000Z',end:'2026-03-03T16:00:00.000Z'}],
 ['numeric financial window',p=>p.measurementWindow={start:123,end:124}],
 ['simulation financial metadata',p=>{p.currency='GBP';p.measurementWindow={start:'2026-09-22T08:00:00.000Z',end:'2026-09-22T16:00:00.000Z'};}]
])test('reject rehashed '+name+' that canonical producer never emits',()=>{
 const p=structuredClone(proof({classification:name.startsWith('simulation')?'SIMULATED':'REALISED_FINANCIAL'}));mutate(p);rehash(p);assert.throws(()=>call({tenant:'alpha',proofs:[p]}));
});
test('canonical finite rounded prediction error and ISO-normalized producer output stay valid',()=>{
 const p=proof({actual:320.123456789,observedAt:'2026-09-22T18:00:00+02:00'});assert.equal(p.observed.predictionError,20.12345679);assert.equal(p.observed.observedAt,'2026-09-22T16:00:00.000Z');const result=call({tenant:'alpha',proofs:[p]});assert.equal(result.uniqueDeclarationCount,1);assert.equal(result.groups[0].declarations[0].observed.predictionError,20.12345679);
});
test('canonical simulation omits currency and window and remains a simulation declaration',()=>{
 const p=proof({classification:'SIMULATED'});assert.equal(Object.hasOwn(p,'currency'),false);assert.equal(Object.hasOwn(p,'measurementWindow'),false);const result=call({tenant:'alpha',proofs:[p]});assert.equal(result.groups[0].declaredClassification,'SIMULATED');assert.equal(result.aggregateFinancialValue,null);
});
