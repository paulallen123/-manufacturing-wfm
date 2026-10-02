'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'../lane02-country'),{createTwinRevision}=require(path.join(root,'implementation/runtime/implementation-digital-twin.cjs')),{projectSiteOperatingContext:project}=require(path.join(root,'policy/runtime/site-operating-context-projection.cjs'));
const past='2026-01-01T00:00:00.000Z',now='2026-10-02T00:00:00.000Z',future='2026-10-03T00:00:00.000Z',node=(id,type,context={},extra={})=>({id,type,source:'independent://'+id,observedAt:past,effectiveAt:past,verified:true,data:{globalContext:context,metadata:null},...extra}),edge=(from,to,extra={})=>({from,to,relation:'PARENT_OF',source:'independent://parent',observedAt:past,effectiveAt:past,verified:true,data:{},...extra}),base=()=>createTwinRevision({tenant:'independent',nodes:[node('root','tenant',{countryCode:'GB',timeZone:'Europe/London',locale:'en-GB',currency:'GBP'}),node('site','site',{currency:'EUR'})],edges:[edge('root','site')]}),input=r=>({revision:r||base(),tenant:'independent',siteId:'site',knownAt:now,effectiveAt:now}),query=(r,extra={})=>project({...input(r),...extra}),edit=fn=>{const r=base();fn(r);return createTwinRevision(r);},observations=[];
test.after(()=>fs.writeFileSync(path.join(__dirname,'country-projection-repair.observations.json'),JSON.stringify({node:process.version,observations},null,2)));
function probe(name,value,calls=()=>0){let result,error;try{result=project(value);}catch(e){error=e.message;}const row={name,accepted:!!result,error:error||null,userCodeCalls:calls(),revision:result?.revision||null,context:result?.context||null};observations.push(row);return row;}
test('known/effective edge boundaries exclude future and validTo endpoint with provenance retained',()=>{
 for(const extra of [{observedAt:future},{effectiveAt:future},{data:{validTo:now}},{data:{validFrom:future}}]){const p=query(edit(r=>Object.assign(r.edges[0],extra)));assert.deepEqual(p.lineage,['site']);assert.equal(p.context.timeZone,undefined);assert.deepEqual(p.missingFields,['countryCode','timeZone']);}
 const p=query(edit(r=>r.edges[0].data={validFrom:now,validTo:future}));assert.equal(p.context.timeZone,'Europe/London');assert.equal(p.hierarchyProvenance[0].validFrom,now);assert.equal(p.fieldProvenance.countryCode.source,'independent://root');
});
test('future parent node and future target node cannot leak current display fields',()=>{
 const p=query(edit(r=>r.nodes.find(n=>n.id==='root').observedAt=future));assert.equal(p.context.countryCode,undefined);assert.throws(()=>query(edit(r=>r.nodes.find(n=>n.id==='site').effectiveAt=future)),/time/);
});
test('ambiguity, cyclic hierarchy and unverified/blank provenance fail closed',()=>{
 assert.throws(()=>query(edit(r=>{r.nodes.push(node('other','tenant',{timeZone:'Asia/Tokyo'}));r.edges.push(edge('other','site'));})),/ambiguous/);
 assert.throws(()=>query(edit(r=>r.edges.push(edge('site','root')))),/cycle/);
 for(const group of ['nodes','edges'])for(const extra of [{verified:false},{source:' '}])assert.throws(()=>query(edit(r=>Object.assign(r[group][0],extra))),/verified|source/);
});
test('cross-tenant items, forged digests and malformed canonical records fail closed',()=>{
 for(const collection of ['nodes','edges']){const r=base();r[collection][0].tenant='foreign';assert.throws(()=>query(r),/tenant/);}
 const r=base();r.nodes[0].data.globalContext.currency='JPY';assert.throws(()=>query(r),/digest/);assert.throws(()=>query(base(),{tenant:'foreign'}),/tenant/);
 for(const revision of [{tenant:'independent',nodes:[],edges:[],revision:'x'},null,[],{}])assert.throws(()=>project({...input(),revision}));
});
test('UTC instants reject impossible or local times and DST fall preserves distinct offsets',()=>{
 for(const knownAt of ['2026-02-29T00:00:00Z','2026-10-02T24:00:00Z','2026-10-02T00:00:00+00:00','2026-10-02T00:00:00.0000Z',true])assert.throws(()=>query(base(),{knownAt}),/knownAt/);
 const p=query();const a=p.localParts('2026-10-25T00:30:00Z'),b=p.localParts('2026-10-25T01:30:00Z');assert.equal(a.hour,'01');assert.equal(b.hour,'01');assert.notEqual(a.timeZoneName,b.timeZoneName);assert.equal(Object.isFrozen(a),true);
});
test('no guessed timeZone, invalid locale errors, and display fields confer no legal authority',()=>{
 const r=edit(r=>{delete r.nodes.find(n=>n.id==='root').data.globalContext.timeZone;});assert.throws(()=>query(r).localParts(now),/timeZone/);
 assert.throws(()=>query(edit(r=>r.nodes[0].data.globalContext.locale='en_GB')),/locale/);
 const p=query(edit(r=>Object.assign(r.nodes[0].data.globalContext,{countryCode:'ZZ',currency:'ZZZ',mandatoryOvertime:0,executionAuthority:true})));assert.equal(p.policyContext,null);assert.equal(p.executionAuthority,false);assert.equal(p.customerMutation,false);assert.equal(p.context.mandatoryOvertime,undefined);assert.equal(p.context.countryCode,'ZZ');
});
test('output is detached/deep frozen and projection has no implicit clock or dispatch',()=>{
 const r=base(),p=query(r),before=p.context.currency;r.nodes.find(n=>n.id==='site').data.globalContext.currency='USD';assert.equal(p.context.currency,before);assert.throws(()=>p.context.currency='JPY',TypeError);assert.equal(Object.isFrozen(p.hierarchyProvenance[0]),true);
 const saved=Date.now;Date.now=()=>assert.fail('implicit clock');try{assert.equal(query().context.countryCode,'GB');}finally{Date.now=saved;}
});
test('projection input getter cannot execute caller code',()=>{let calls=0;const x=input();Object.defineProperty(x,'revision',{get(){calls++;return base();}});const row=probe('input getter',x,()=>calls);assert.equal(row.userCodeCalls,0);assert.equal(row.accepted,false);});
test('canonical revision field getter cannot execute caller code',()=>{let calls=0;const r=base(),nodes=r.nodes;Object.defineProperty(r,'nodes',{get(){calls++;return nodes;}});const row=probe('revision nodes getter',input(r),()=>calls);assert.equal(row.userCodeCalls,0);assert.equal(row.accepted,false);});
test('payload toJSON cannot execute before canonical validation',()=>{let calls=0;const r=base(),data=r.nodes[0].data;Object.defineProperty(data,'toJSON',{value(){calls++;return {globalContext:data.globalContext,metadata:null};}});const row=probe('payload toJSON',input(r),()=>calls);assert.equal(row.userCodeCalls,0);assert.equal(row.accepted,false);});
test('proxy revision cannot execute traps before canonical validation',()=>{let calls=0;const r=new Proxy(base(),{get(target,key,receiver){calls++;return Reflect.get(target,key,receiver);}});const row=probe('proxy revision',input(r),()=>calls);assert.equal(row.userCodeCalls,0);assert.equal(row.accepted,false);});
test('overridden array map cannot execute before canonical validation',()=>{let calls=0;const r=base();Object.defineProperty(r.nodes,'map',{value(fn){calls++;return Array.prototype.map.call(this,fn);}});const row=probe('overridden nodes.map',input(r),()=>calls);assert.equal(row.userCodeCalls,0);assert.equal(row.accepted,false);});
for(const value of [NaN,Infinity,-Infinity])test('raw nonfinite payload '+String(value)+' cannot hide behind unchanged null digest',()=>{const r=base(),original=r.revision;r.nodes[0].data.metadata=value;const row=probe('nonfinite '+String(value),input(r));assert.equal(r.revision,original);assert.equal(row.accepted,false,'Exact canonical payload binding must reject non-JSON numeric replacement');});
