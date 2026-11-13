'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {mkdtempSync,rmSync}=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const Boundaries=require('./canonical-production-boundaries.cjs');

const binding={tenant:'retry-fixture',implementationRunId:'run-fixture',candidateSha:'a'.repeat(40),deploymentId:'deployment-fixture',configurationId:'config-fixture',employerId:'employer-fixture'};
const actor={tenant:binding.tenant,personId:'reviewer-fixture',email:'reviewer@example.invalid',permissions:['payroll.export','company.configure']};
function fixture(t){
  const directory=mkdtempSync(path.join(os.tmpdir(),'staffology-consumed-retry-')),file=path.join(directory,'state.sqlite');
  let db=new DatabaseSync(file),clock=1000,principal=structuredClone(actor);
  const options={now:()=>clock,resolvePrincipal:()=>structuredClone(principal)};
  t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
  return {get db(){return db;},options,setClock(value){clock=value;},setPrincipal(value){principal=value;},reopen(){db.close();db=new DatabaseSync(file);return db;}};
}
function permit(extra={}){return {binding,deliveryId:'delivery-fixture',digest:'b'.repeat(64),run:{taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0},entryId:'entry-fixture',baselineSha256:'c'.repeat(64),baselineRunSha256:'d'.repeat(64),expectedBasicPay:'12.50',rounding:'exact-cent',...extra};}
const consumedError={code:'STAFFOLOGY_APPROVAL_CONSUMED',status:409};
function rows(db){return db.prepare('SELECT * FROM outbound_staffology_approvals ORDER BY id').all().map(row=>({...row}));}

test('same exact consumed permit cannot be reissued and its original evidence remains',t=>{
  const f=fixture(t),authority=Boundaries.createAuthority(f.db,f.options),approved=permit(),issued=authority.issue(actor,approved);
  assert.equal(authority.consume(approved),issued.id);
  const before=rows(f.db);
  assert.throws(()=>authority.issue(actor,approved),consumedError);
  assert.deepEqual(rows(f.db),before);
  assert.equal(authority.check(approved),false);
  assert.throws(()=>authority.consume(approved),{code:'STAFFOLOGY_WRITE_NOT_AUTHORIZED'});
});

test('reopen and expiry do not rearm a consumed permit for the same or replacement person',t=>{
  const f=fixture(t),authority=Boundaries.createAuthority(f.db,f.options),approved=permit(),issued=authority.issue(actor,approved,{ttlMs:1000});
  authority.consume(approved);
  const before=rows(f.db);
  f.setClock(1000000);f.reopen();
  const reopened=Boundaries.createAuthority(f.db,f.options);
  assert.throws(()=>reopened.issue(actor,approved),consumedError);
  const replacement={...actor,personId:'replacement-fixture'};f.setPrincipal(replacement);
  assert.throws(()=>reopened.issue(replacement,approved),consumedError);
  assert.deepEqual(rows(f.db),before);
  assert.equal(rows(f.db)[0].id,issued.id);
  assert.equal(reopened.check(approved),false);
});

test('unconsumed retry, expiry renewal and a distinct permit remain available',t=>{
  const f=fixture(t),authority=Boundaries.createAuthority(f.db,f.options),approved=permit(),first=authority.issue(actor,approved,{ttlMs:1000});
  assert.equal(authority.issue(actor,approved).id,first.id);
  f.setClock(2001);
  const renewed=authority.issue(actor,approved);
  assert.notEqual(renewed.id,first.id);
  assert.equal(authority.check(approved),true);
  authority.consume(approved);
  const distinct=permit({deliveryId:'delivery-distinct',digest:'e'.repeat(64)}),second=authority.issue(actor,distinct);
  assert.notEqual(second.id,renewed.id);
  assert.equal(authority.check(distinct),true);
  assert.equal(rows(f.db).length,2);
});

function providerEvidence(amount){
  const hours=amount===100?10:1.25;
  const run={taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,version:0,state:'Open',startDate:'2026-09-01',endDate:'2026-09-30'};
  const entry={id:'entry-fixture',employee:{id:'employee-fixture'},employmentDetails:{payrollCode:'PAY-FIXTURE'},taxYear:'Year2026',payPeriod:'Monthly',period:9,ordinal:1,payRunVersion:0,state:'Open',payOptions:{basis:'Hourly',payCode:'BASIC',payAmount:10,payAmountMultiplier:hours,regularPayLines:[{code:'BASIC',rate:10,multiplier:hours,value:amount}]},totals:{basicPay:amount}};
  return {run,entry};
}

test('lost acknowledgement and reopened read-only recovery retain the consumed dispatch approval',async t=>{
  const f=fixture(t),config={apiKey:'offline-fixture-key-only',baseUrl:'https://api.staffology.co.uk',timeoutMs:1000};
  let posts=0,recoveryReads=0;
  const response=value=>new Response(JSON.stringify(value),{status:200});
  const client=async(url,options)=>{
    if(options.method==='POST'){posts++;throw Error('synthetic lost acknowledgement');}
    const p=new URL(url).pathname,evidence=providerEvidence(100);
    if(posts&&p.endsWith('/entry-fixture'))return new Response(null,{status:404});
    return response(p==='/open'?[evidence.run]:p.endsWith('/entry-fixture')?evidence.entry:evidence.run);
  };
  const input={...binding,employeeId:'employee-fixture',entryId:'entry-fixture',payrollCode:'PAY-FIXTURE',effectiveDate:'2026-09-15',batchId:'batch-fixture',sourceRevision:'sha256:'+('f'.repeat(64)),mode:'hourly-basic-replacement',rounding:'exact-cent',taxYear:'Year2026',payPeriod:'Monthly',periodNumber:9,ordinal:1,version:0,lines:[{code:'BASIC',hours:'1.25',rate:'10.00'}]};
  const boundaries=Boundaries.createBoundaries({db:f.db,...f.options}),first=await boundaries.approvedCoordinator(actor,{binding,config,client}).deliver(input);
  assert.equal(first.reconciliation.status,'unresolved');assert.equal(posts,1);
  const delivery=f.db.prepare('SELECT * FROM outbound_staffology_deliveries').get(),marker=JSON.parse(delivery.dispatch_json),payload=JSON.parse(delivery.payload_json);
  const originalPermit={binding,deliveryId:marker.deliveryId,digest:marker.digest,run:payload.run,entryId:payload.entryId,baselineSha256:marker.baselineSha256,baselineRunSha256:marker.baselineRunSha256,expectedBasicPay:payload.expectedBasicPay,rounding:payload.rounding};
  const originalApprovals=rows(f.db);
  assert.equal(originalApprovals[0].id,marker.approvalId);
  assert.ok(originalApprovals[0].consumed_at!==null);
  f.setClock(62000);f.reopen();
  const reopened=Boundaries.createBoundaries({db:f.db,...f.options});
  assert.throws(()=>reopened.authority.issue(actor,originalPermit),consumedError);
  assert.deepEqual(rows(f.db),originalApprovals);
  const recoveryClient=async(url,options)=>{
    assert.equal(options.method,'GET','recovery of a reserved dispatch must not resend');recoveryReads++;
    const p=new URL(url).pathname,evidence=providerEvidence(12.5);
    return response(p==='/open'?[evidence.run]:p.endsWith('/entry-fixture')?evidence.entry:evidence.run);
  };
  const coordinator=reopened.approvedCoordinator(actor,{binding,config,client:recoveryClient}),result=await coordinator.recover({deliveryId:marker.deliveryId,digest:marker.digest});
  assert.equal(result.status,'reconciled');assert.equal(result.mode,'read-only-reconciliation');
  assert.equal(result.approvalId,marker.approvalId);assert.equal(posts,1);assert.equal(recoveryReads,3);
  assert.deepEqual(rows(f.db),originalApprovals);
  assert.equal((await coordinator.deliver(input)).replayed,true);
  assert.equal(posts,1);assert.equal(recoveryReads,3);
  assert.equal(JSON.parse(f.db.prepare('SELECT dispatch_json FROM outbound_staffology_deliveries').get().dispatch_json).approvalId,marker.approvalId);
});
