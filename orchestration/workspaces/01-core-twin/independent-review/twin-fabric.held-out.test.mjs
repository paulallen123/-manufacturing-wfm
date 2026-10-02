import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
const directory=path.dirname(fileURLToPath(import.meta.url)),work=path.resolve(directory,'..');
const require=createRequire(import.meta.url);
const Twin=require(path.join(work,'lane01-twin/implementation/runtime/implementation-digital-twin.cjs'));
const Projections=require(path.join(work,'lane01-twin/implementation/runtime/twin-read-only-projections.cjs'));
const fabric=path.join(work,'lane03-fabric/source/integration-fabric/runtime');
const {createFieldProjectionAuthority}=await import(pathToFileURL(path.join(fabric,'field-projection-authority.mjs')));
const {evaluateProviderCapabilityAuthority}=await import(pathToFileURL(path.join(fabric,'provider-capability-authority.mjs')));
globalThis.fetch=()=>{throw Error('TRUST_REVIEW_NETWORK_FORBIDDEN');};
const observed=[];
function record(t,id,data){const row={id,...data};observed.push(row);t.diagnostic(JSON.stringify(row));}
test.after(()=>fs.writeFileSync(path.join(directory,'twin-fabric.observations.json'),JSON.stringify({node:process.version,externalProviderRequests:0,observations:observed},null,2)));
const early='2026-09-15T10:00:00.000Z',later='2026-09-15T11:00:00.000Z';
const node=(id,data={},type='evidence',observedAt=early)=>({id,type,source:'trusted-canonical-feed',observedAt,verified:true,data});
const revision=(nodes,edges=[])=>Twin.createTwinRevision({tenant:'independent-tenant',nodes,edges});
const project=(api,r)=>Projections[api]({tenant:'independent-tenant',revision:r});

test('TWIN control: exact canonical revision provenance and authority are preserved',t=>{
 const r=revision([node('source',{},'site'),node('target')],[{from:'source',to:'target',relation:'evidenced-by',source:'canonical-edge',observedAt:early,effectiveAt:early,data:{validTo:later}}]);
 const view=project('projectTwinGraph',r);assert.equal(view.sourceTwinRevision,r.revision);assert.equal(view.executionAuthority,'NONE');assert.equal(view.relatedAt('source','evidenced-by',{at:early,knownAt:early})[0].id,'target');assert.deepEqual(view.relatedAt('source','evidenced-by',{at:later,knownAt:later}),[]);
 record(t,'TWIN-CANONICAL',{sourceTwinRevision:view.sourceTwinRevision,authority:view.executionAuthority});
});
test('TWIN: recomputed cross-tenant node and tampered digest are rejected',()=>{
 const r=revision([node('record')]);r.nodes[0].tenant='another-tenant';r.revision=Twin.digest({tenant:r.tenant,nodes:r.nodes,edges:r.edges});assert.throws(()=>project('projectTwinGraph',r),/tenant/i);
 const altered=revision([node('record')]);altered.nodes[0].data.changed=true;assert.throws(()=>project('projectTwinGraph',altered),/identity|revision/i);
});
test('TWIN: source/output aliasing cannot change revision data or expose mutable nested state',()=>{
 const r=revision([node('record',{nested:{sentinel:19}})]),text=JSON.stringify(r),view=project('projectTwinGraph',r);
 assert.equal(JSON.stringify(r),text);r.nodes[0].data.nested.sentinel=30;assert.equal(view.nodeById('record').data.nested.sentinel,19);assert.throws(()=>{view.nodeById('record').data.nested.sentinel=40;},TypeError);
});
test('TWIN: replay methods cannot learn late events or reveal an unknown anchor',t=>{
 const r=revision([node('record',{operationalEvents:[{id:'late',kind:'telemetry',occurredAt:early,evidence:{sourceRef:'bounded-feed:late',observedAt:later}}]})]);
 const history=project('projectOperationalHistory',r);assert.equal(history.eventsInWindow({from:early,to:later,knownAt:early}).length,0);assert.throws(()=>history.incidentBundle({anchorEventId:'late',knownAt:early}),/known/i);assert.equal(history.eventsInWindow({from:early,to:later,knownAt:later}).length,1);
 record(t,'TWIN-TIME',{knownEarlyCount:0,knownLaterCount:1});
});
const drawing=(id,vector,extra={},observedAt=early)=>node(id,{engineeringRecord:{partId:'part-'+id,revision:'R1',engineeringVector:vector,evidence:{sourceRef:'drawing:'+id,observedAt},...extra}},'evidence',early);
test('TWIN: extreme finite and subnormal vectors retain stable hand-computable cosine',t=>{
 const r=revision([drawing('large',[1e308,1e308]),drawing('tiny',[1e-320,1e-320]),drawing('orthogonal',[1e308,-1e308])]);
 const result=project('projectEngineeringMemory',r).similarTo('large',{knownAt:later});
 assert.deepEqual(result.map(row=>[row.nodeId,row.score]),[['tiny',1],['orthogonal',0]]);assert.ok(result.every(row=>Number.isFinite(row.score)));
 record(t,'TWIN-MATH',{results:result.map(row=>({id:row.nodeId,score:row.score}))});
});
test('TWIN: future engineering records are invisible and future lineage is rejected',()=>{
 const memory=project('projectEngineeringMemory',revision([drawing('query',[1,0]),drawing('future',[1,0],{},later)]));assert.equal(memory.similarTo('query',{knownAt:early}).length,0);
 const r=revision([drawing('old',[1,0],{partId:'same',previousRevisionId:'future'}),drawing('future',[1,0],{partId:'same'},later)]);assert.throws(()=>project('projectEngineeringMemory',r),/future/i);
});
test('TWIN: invalid/zero/nonmatching vectors fail closed rather than emit NaN ranking',()=>{
 for(const vector of [[0,0],[Infinity,1],[NaN,1]])assert.throws(()=>project('projectEngineeringMemory',revision([drawing('query',vector)])),/vector|finite|zero|identity/i);
 const memory=project('projectEngineeringMemory',revision([drawing('query',[1,0]),drawing('other',[1,0,0])]));assert.throws(()=>memory.similarTo('query',{knownAt:later}),/dimension/i);
});

function fieldPolicy(routePath='/read'){return {provider:'bounded-provider',wfmTenantId:'independent-tenant',connectionId:'connection-1',sourceAccountId:'account-1',apiOrigin:'https://approved.example.invalid',apiVersion:'v1',resource:'employees',routePath,method:'GET',readOperation:'read-employees',schemaFingerprint:'schema-1',projectionFingerprint:'projection-1',identityField:'employeeId',allowedFields:['employeeId'],requiredFields:['employeeId'],deniedSensitiveFields:['bankAccountNumber'],maxFields:1,maxRecords:1};}
function fieldRequest(p){const {identityField,allowedFields,requiredFields,deniedSensitiveFields,maxFields,maxRecords,...scope}=p;return {...scope,fields:['employeeId']};}
function capabilityInput(exactHost='https://approved.example.invalid',route='/read'){const operation={method:'GET',path:route,capability:'employees',operationId:'read-employees',readOnly:true};return {provider:'bounded-provider',wfmTenant:'independent-tenant',connectionId:'connection-1',exactHost,credentialRevision:'revision-1',approvedCapabilities:['employees'],observedCapabilities:['employees'],requiredCapabilities:['employees'],approvedOperations:[operation],requestedOperation:operation};}
test('FABRIC controls: ordinary route is allowed; tenant and operation drift stay blocked',()=>{
 const p=fieldPolicy(),authority=createFieldProjectionAuthority(p),plan=authority.authorizeRead(fieldRequest(p));assert.equal(plan.apiOrigin,p.apiOrigin);assert.equal(plan.readIntent,true);assert.equal(plan.writeBackAuthority,false);assert.throws(()=>authority.authorizeRead({...fieldRequest(p),wfmTenantId:'other'}),/tenant|authority/i);
 assert.equal(evaluateProviderCapabilityAuthority(capabilityInput()).allowed,true);const bad=capabilityInput();bad.requestedOperation={...bad.requestedOperation,path:'/other'};assert.equal(evaluateProviderCapabilityAuthority(bad).allowed,false);
});
test('FABRIC P2 inert data: array getter must never execute before being rejected',t=>{
 const p=fieldPolicy();let calls=0;const values=[];Object.defineProperty(values,'0',{enumerable:true,configurable:true,get(){calls++;return 'employeeId';}});p.allowedFields=values;
 let error=null;try{createFieldProjectionAuthority(p);}catch(e){error=e.message;}
 record(t,'FABRIC-GETTER',{calls,error});assert.match(error,/executable|hidden/i);assert.equal(calls,0,'Untrusted accessor must be inspected without invocation');
});
test('FABRIC P2 destination: field read plan must reject scheme-relative host escape',t=>{
 const p=fieldPolicy('//outside.example.invalid/read');let plan=null,error=null;try{plan=createFieldProjectionAuthority(p).authorizeRead(fieldRequest(p));}catch(e){error=e.message;}
 const resolved=plan?new URL(plan.routePath,plan.apiOrigin).origin:null;record(t,'FABRIC-FIELD-ORIGIN',{admitted:plan!==null,approved:p.apiOrigin,resolved,error});assert.equal(plan,null,'Read authority must not approve a path that changes the supplied origin');
});
test('FABRIC P2 destination: capability authority must reject scheme-relative host escape',t=>{
 const input=capabilityInput('https://approved.example.invalid','//outside.example.invalid/read'),decision=evaluateProviderCapabilityAuthority(input);
 record(t,'FABRIC-CAPABILITY-ORIGIN',{allowed:decision.allowed,approved:input.exactHost,resolved:new URL(input.requestedOperation.path,input.exactHost).origin});assert.equal(decision.allowed,false,'Allowed read must stay on exact approved HTTPS origin');
});
test('FABRIC P2 destination: capability exactHost must reject credentials/userinfo hostname confusion',t=>{
 const input=capabilityInput('https://approved.example.invalid@outside.example.invalid'),decision=evaluateProviderCapabilityAuthority(input);
 record(t,'FABRIC-CAPABILITY-USERINFO',{allowed:decision.allowed,exactHost:input.exactHost,actualOrigin:new URL(input.exactHost).origin});assert.equal(decision.allowed,false,'An exact host must be parsed as a credential-free origin');
});
