const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');const dir=__dirname,archive=path.join(dir,'archive-pre-review-repair');fs.mkdirSync(archive,{recursive:true});const hash=b=>crypto.createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
for(const [p,expected]of [['operations/runtime/decision-outcome-evidence-projection.cjs','9b0ccf4b7a6f9a074b711d0add1713686f3e8729'],['operations/runtime/decision-outcome-evidence-projection.test.cjs','4aec0277204a33f5ca06609a85e684730719125a'],['changes-manifest.json',null]]){const b=fs.readFileSync(path.join(dir,p));if(expected)assert.equal(hash(b),expected);const target=path.join(archive,path.basename(p)+'.snapshot');assert(!fs.existsSync(target),'archive exists');fs.writeFileSync(target,b);}
const p=path.join(dir,'operations/runtime/decision-outcome-evidence-projection.test.cjs');let source=fs.readFileSync(p,'utf8');
source=source.replace("finance='finance:a',baseline=520}={})", "finance='finance:a',baseline=520,actual=320,observedAt='2026-09-22T16:00:00Z'}={})").replace("recordDecisionOutcome(selected,{observedAt:'2026-09-22T16:00:00Z',evidenceRefs:['result:'+id],actual:{labourCost:320}})","recordDecisionOutcome(selected,{observedAt,evidenceRefs:['result:'+id],actual:{labourCost:actual}})");
assert(source.includes('actual:{labourCost:actual}'),'fixture expansion exact');
source+=`
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
`;
fs.writeFileSync(p,source);console.log('Exact reviewed source/test archived and semantic regressions added');
