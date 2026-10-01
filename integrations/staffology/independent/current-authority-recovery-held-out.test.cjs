'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const B=require('../canonical-production-boundaries.cjs');
const S=require('../staffology-adapter.cjs');
const fixtures={"binding":{"tenant":"offline-tenant-a","implementationRunId":"offline-run-001","candidateSha":"35d8e4673f2cd8e205e92f9cb46187acb3277d79","deploymentId":"offline-deployment-001","configurationId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","employerId":"employer-001"},"actor":{"tenant":"offline-tenant-a","personId":"offline-reviewer-001","email":"approving-account@example.invalid","permissions":["payroll.export","company.configure"]},"input":{"tenant":"offline-tenant-a","implementationRunId":"offline-run-001","candidateSha":"35d8e4673f2cd8e205e92f9cb46187acb3277d79","deploymentId":"offline-deployment-001","configurationId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","employerId":"employer-001","employeeId":"employee-001","entryId":"entry-001","payrollCode":"PAY001","effectiveDate":"2026-09-15","batchId":"batch-001","sourceRevision":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mode":"hourly-basic-replacement","rounding":"exact-cent","taxYear":"Year2026","payPeriod":"Monthly","periodNumber":9,"ordinal":1,"version":0,"lines":[{"code":"BASIC","hours":"1.25","rate":"10.00"}]}};
const permit={"binding":fixtures.binding,"deliveryId":"held-authority-001","digest":"8f4bdb44b30f200d0e2bbdfb90ec586428ac8691caeced2504a1f9aef0b3fe70","run":{"ordinal":1,"payPeriod":"Monthly","periodNumber":9,"taxYear":"Year2026","version":0},"entryId":"entry-001","baselineSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","baselineRunSha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","expectedBasicPay":"12.50","rounding":"exact-cent"};

test('current canonical resolver binds the exact approving account when two accounts share personId',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,permissions TEXT NOT NULL)');
 const permissions=JSON.stringify(fixtures.actor.permissions);for(const email of ['first-account@example.invalid',fixtures.actor.email])db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(email,fixtures.actor.tenant,fixtures.actor.personId,permissions);
 const resolvePrincipal=({tenant,email})=>{const row=db.prepare('SELECT email,tenant,person_id,permissions FROM users WHERE email=? AND tenant=?').get(email,tenant);return row&&{email:row.email,tenant:row.tenant,personId:row.person_id,permissions:JSON.parse(row.permissions)};};
 const authority=B.createAuthority(db,{now:()=>1000,resolvePrincipal});authority.issue(fixtures.actor,permit);assert.equal(authority.check(permit),true);
 db.prepare('UPDATE users SET permissions=? WHERE email=?').run('[]',fixtures.actor.email);const stillValid=authority.check(permit);let consumed=false;try{authority.consume(permit);consumed=true;}catch{}
 console.log('SHARED_PERSON_AUTHORITY_OBSERVATION='+JSON.stringify({approvingAccount:fixtures.actor.email,currentApprovingPermissions:[],samePersonOtherAccountStillPrivileged:true,stillValid,consumed,providerRequests:0}));
 assert.deepEqual({stillValid,consumed},{stillValid:false,consumed:false});
});

test('current canonical authority replacement invalidates permit even when issued request actor is immutable snapshot',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let canonicalPrincipal=structuredClone(fixtures.actor);
 const authority=B.createAuthority(db,{now:()=>1000,resolvePrincipal:()=>structuredClone(canonicalPrincipal)});const issuedRequestActor=structuredClone(canonicalPrincipal);
 authority.issue(issuedRequestActor,permit);assert.equal(authority.check(permit),true);
 const reopenedAuthority=B.createAuthority(db,{now:()=>1000,resolvePrincipal:()=>structuredClone(canonicalPrincipal)});assert.equal(reopenedAuthority.check(permit),true);
 canonicalPrincipal={...canonicalPrincipal,permissions:[]};assert.equal(canonicalPrincipal.permissions.includes('payroll.export'),false);
 const stillValid=reopenedAuthority.check(permit);let consumed=false;try{reopenedAuthority.consume(permit);consumed=true;}catch{}
 console.log('HELD_CURRENT_AUTHORITY_OBSERVATION='+JSON.stringify({currentPermissions:canonicalPrincipal.permissions,cachedPermissions:issuedRequestActor.permissions,stillValid,consumed,providerRequests:0}));
 assert.deepEqual({stillValid,consumed},{stillValid:false,consumed:false});
 canonicalPrincipal={...fixtures.actor,tenant:'offline-tenant-b'};assert.equal(reopenedAuthority.check(permit),false);
});

test('zero-dispatch initial read failure remains safely recoverable through real store successor',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let clock=1000,posts=0,gets=0;
 const authority=B.createAuthority(db,{now:()=>clock}),store=B.createStore(db,{authority,binding:fixtures.binding,workerId:'old-worker',leaseMs:100,now:()=>clock});
 const client=async (_url,options)=>{if(options.method==='POST')posts++;else gets++;throw Error('INJECTED_INITIAL_GET_FAILURE');};
 const config={apiKey:'synthetic-offline-key-001',timeoutMs:100,baseUrl:'https://api.staffology.co.uk'};
 const c=S.createDeliveryCoordinator({store,client,config,binding:fixtures.binding,authorizeWrite:async()=>true});
 await assert.rejects(c.deliver(fixtures.input),{code:'STAFFOLOGY_TRANSPORT_ERROR'});assert.equal(gets,1,'exact initial GET transport was reached');let row=db.prepare('SELECT delivery_id,digest FROM outbound_staffology_deliveries').get();
 const before=store.get(row.delivery_id);assert.equal(posts,0);assert.equal(before.dispatchAttempt,null);assert.equal(before.baseline,null);
 clock=1200;const successor=B.createStore(db,{authority,binding:fixtures.binding,workerId:'successor-worker',leaseMs:100,now:()=>clock});
 const claim=successor.recover(row.delivery_id,row.digest),s=S.createDeliveryCoordinator({store:successor,client,config,binding:fixtures.binding,authorizeWrite:async()=>true});
 let reconciliation,code;try{reconciliation=await s.reconcile({deliveryId:row.delivery_id,token:claim.token});}catch(e){code=e.code||e.message;}
 const replay=await s.deliver(fixtures.input);
 console.log('HELD_PRE_DISPATCH_SUCCESSOR_OBSERVATION='+JSON.stringify({beforeStatus:before.status,fence:claim.fence,posts,gets,reconciliation,code,replay,providerRequests:0}));
 assert.equal(Boolean(code)||reconciliation?.status==='unresolved',false,'Claimed zero-dispatch successor remains wedged: '+(code||reconciliation?.code));
});

test('fresh fenced successor can resume the original intent once and reconcile without the old worker',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let clock=1000,failFirst=true,posts=0,issued=false;
 const actor=structuredClone(fixtures.actor),authority=B.createAuthority(db,{now:()=>clock,resolvePrincipal:({tenant,email})=>tenant===actor.tenant&&email===actor.email?structuredClone(actor):null});
 const oldStore=B.createStore(db,{authority,binding:fixtures.binding,workerId:'old-worker',leaseMs:100,now:()=>clock});
 const run={taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,version:0,state:'Open',startDate:'2026-09-01',endDate:'2026-09-30'};
 const entry=amount=>({id:'entry-001',employee:{id:'employee-001'},employmentDetails:{payrollCode:'PAY001'},taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,payRunVersion:0,state:'Open',payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:amount===100?10:1.25,regularPayLines:[{code:'BASIC',rate:10,multiplier:amount===100?10:1.25,value:amount}]},totals:{basicPay:amount}});
 const response=body=>new Response(body===undefined?null:JSON.stringify(body),{status:200});
 const client=async(url,options)=>{if(failFirst){failFirst=false;throw Error('INJECTED_INITIAL_GET_FAILURE');}if(options.method==='POST'){posts++;return response();}const path=new URL(url).pathname;if(path==='/open')return response([run]);if(path.endsWith('/entry-001'))return response(entry(posts?12.5:100));return response(run);};
 const config={apiKey:'synthetic-offline-key-001',timeoutMs:1000,baseUrl:'https://api.staffology.co.uk'};
 const old=S.createDeliveryCoordinator({store:oldStore,client,config,binding:fixtures.binding,authorizeWrite:async()=>true});
 await assert.rejects(old.deliver(fixtures.input),{code:'STAFFOLOGY_TRANSPORT_ERROR'});const row=db.prepare('SELECT delivery_id,digest FROM outbound_staffology_deliveries').get();
 clock=1200;const successorStore=B.createStore(db,{authority,binding:fixtures.binding,workerId:'successor-worker',leaseMs:1000,now:()=>clock}),claim=successorStore.recover(row.delivery_id,row.digest);
 const authorizeWrite=async currentPermit=>{if(!issued){authority.issue(actor,currentPermit);issued=true;}return authority.check(currentPermit);};
 const successor=S.createDeliveryCoordinator({store:successorStore,client,config,binding:fixtures.binding,authorizeWrite});
 const result=await successor.reconcile({deliveryId:row.delivery_id,token:claim.token});assert.equal(result.status,'reconciled');assert.equal(posts,1);
 assert.throws(()=>oldStore.recordEvidence(row.delivery_id,{phase:'late-old-worker'},oldStore.get(row.delivery_id)?.token),{code:'STAFFOLOGY_OWNERSHIP_LOST'});
 assert.equal((await successor.deliver(fixtures.input)).replayed,true);assert.equal(posts,1);
});
