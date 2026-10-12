'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {createCustomerWorkspaceRegistry}=require('./customer-workspace.cjs');
const sha=value=>createHash('sha256').update(value).digest('hex');
const initial=()=>({verified:true,ownerAuthorized:true,customerId:'customer-a',customerAuthorityRef:'crm/customer-a',tenant:'alpha',provider:'verified-provider',eventId:'event-a',contractRef:'contract-a',relationship:'initial',ownerEmail:'owner@alpha.test',ownerAuthorityRef:'contract-owner-a'});
function fixture(t){
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE tenants(id TEXT PRIMARY KEY);CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT,contract_ref_hash TEXT);');db.prepare('INSERT INTO tenants VALUES(?)').run('alpha');
  let calls=0;
  const createInitialWorkspace=b=>{calls++;const runId='run-'+calls;db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run(runId,b.tenant,sha(b.contractRef));return {initialSetupRunId:runId};};
  const open=opts=>createCustomerWorkspaceRegistry({db,createInitialWorkspace,...opts});const registry=open();t.after(()=>db.close());
  return {db,registry,open,createInitialWorkspace,get calls(){return calls;}};
}
test('verified initial signing creates one permanent workspace and replay never re-invokes creation',t=>{
  const f=fixture(t),first=f.registry.accept(initial());assert.equal(first.created,true);assert.equal(first.initialSetupRunId,'run-1');
  const replay=f.registry.accept(initial());assert.equal(replay.workspaceId,first.workspaceId);assert.equal(replay.created,false);assert.equal(f.calls,1);
  assert.equal(f.open().forTenant('alpha').workspaceId,first.workspaceId);
  assert.equal(f.registry.accept({...initial(),eventId:'same-contract-new-delivery'}).workspaceId,first.workspaceId);assert.equal(f.calls,1);
});
test('renewal associates explicitly without creating a run or resetting setup',t=>{
  const f=fixture(t),first=f.registry.accept(initial());
  const renewal=f.registry.accept({...initial(),contractRef:'contract-renewal',eventId:'event-renewal',relationship:'renewal',existingWorkspaceId:first.workspaceId});
  assert.equal(renewal.workspaceId,first.workspaceId);assert.equal(renewal.initialSetupRunId,first.initialSetupRunId);assert.equal(f.calls,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_contracts').get().n,2);
});
for(const [name,change] of [
  ['unverified',{verified:false}],['unauthorised owner',{ownerAuthorized:false}],['missing customer authority',{customerAuthorityRef:''}],
  ['changed customer',{customerId:'customer-b'}],['changed tenant',{tenant:'bravo'}],['changed owner',{ownerEmail:'other@alpha.test'}],
  ['unlinked renewal',{relationship:'renewal',eventId:'renewal',contractRef:'renewal'}],
  ['second initial contract',{eventId:'second',contractRef:'second'}],
  ['rebound initial run',{initialSetupRunId:'wrong-run'}]
])test(name+' cannot alter an existing workspace',t=>{
  const f=fixture(t),first=f.registry.accept(initial());assert.throws(()=>f.registry.accept({...initial(),...change}));
  assert.equal(f.registry.forTenant('alpha').workspaceId,first.workspaceId);assert.equal(f.calls,1);
});
test('event identity cannot be reassigned to another contract even with a renewal association',t=>{
  const f=fixture(t),first=f.registry.accept(initial());
  assert.throws(()=>f.registry.accept({...initial(),contractRef:'contract-b',relationship:'renewal',existingWorkspaceId:first.workspaceId}),/event/i);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_contracts').get().n,1);
});
test('failed initial creation rolls back run and permanent identity reservation',t=>{
  const f=fixture(t),failed=f.open({createInitialWorkspace:b=>{f.createInitialWorkspace(b);throw Error('interrupted');}});
  assert.throws(()=>failed.accept(initial()),/interrupted/);assert.equal(f.registry.forTenant('alpha'),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,0);
  assert.equal(f.registry.accept(initial()).created,true);
});
test('missing canonical run cannot be accepted from adapter claims',t=>{
  const f=fixture(t),failed=f.open({createInitialWorkspace:()=>({initialSetupRunId:'claimed'})});
  assert.throws(()=>failed.accept(initial()),/canonical/i);assert.equal(f.registry.forTenant('alpha'),null);
});
test('audit failure rolls back initial creation and outer transactions remain caller owned',t=>{
  const f=fixture(t);f.db.exec("CREATE TRIGGER refuse_signing_audit BEFORE INSERT ON customer_workspace_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.registry.accept(initial()),/audit unavailable/);assert.equal(f.registry.forTenant('alpha'),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,0);
  f.db.exec('DROP TRIGGER refuse_signing_audit; BEGIN IMMEDIATE');f.registry.accept(initial());assert.equal(f.db.isTransaction,true);
  f.db.exec('ROLLBACK');assert.equal(f.registry.forTenant('alpha'),null);
});
test('permanent workspace and associations cannot be deleted or rebound',t=>{
  const f=fixture(t);f.registry.accept(initial());
  assert.throws(()=>f.db.exec("UPDATE customer_workspaces SET initial_run_id='new-run'"),/permanent/i);
  assert.throws(()=>f.db.exec('DELETE FROM customer_workspaces'),/permanent/i);
  assert.throws(()=>f.db.exec('DELETE FROM customer_workspace_contracts'),/permanent/i);
});

test('DocuSign claims cannot create a workspace without a stored order binding',t=>{
  const f=fixture(t);
  assert.throws(()=>f.registry.accept({...initial(),provider:'DocuSign'}),/stored.*order|order.*binding/i);
  assert.equal(f.calls,0);assert.equal(f.registry.forTenant('alpha'),null);
});

function order(overrides={}) {return {orderId:'order-alpha',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,
  orderAuthorityRef:'vector-register/alpha-order',customerId:'customer-a',customerAuthorityRef:'vector-register/customer-a',
  tenant:'alpha',provider:'docusign',envelopeId:'envelope-alpha-1',contractRef:'contract-alpha-1',relationship:'initial',
  nominatedSuperUserEmail:'nominee@alpha.test',nominationAuthorityRef:'customer-nomination/1',profile:{organisationName:'Alpha Factory'},...overrides};}
function completion(overrides={}) {return {verified:true,provider:'docusign',status:'completed',eventId:'complete-alpha-1',envelopeId:'envelope-alpha-1',...overrides};}
test('stored order revision chooses the nominee and tenant even when a verified signer differs',t=>{
  const f=fixture(t);assert.equal(typeof f.registry.recordOrder,'function','The existing register must store revisioned orders');
  const recorded=f.registry.recordOrder(order());assert.equal(recorded.revision,1);
  const binding=f.registry.resolveCompletedOrder(completion({signerEmail:'signer@different.test',tenant:'bravo',ownerEmail:'attacker@bravo.test',orderId:'forged-order'}));
  assert.equal(binding.tenant,'alpha');assert.equal(binding.ownerEmail,'nominee@alpha.test');assert.equal(binding.orderId,'order-alpha');assert.equal(binding.orderRevision,1);
  const first=f.registry.accept(binding);assert.equal(first.created,true);assert.equal(f.calls,1);
  const again=f.registry.accept(f.registry.resolveCompletedOrder(completion()));assert.equal(again.workspaceId,first.workspaceId);assert.equal(f.calls,1);
  assert.throws(()=>f.db.exec("UPDATE customer_workspace_orders SET envelope_id='forged'"),/permanent|append/i);
  assert.throws(()=>f.db.exec('DELETE FROM customer_workspace_orders'),/permanent|append/i);
});
test('superseded order revisions and changed nominations never admit the old envelope again',t=>{
  const f=fixture(t);assert.equal(typeof f.registry.recordOrder,'function');f.registry.recordOrder(order());
  f.registry.recordOrder(order({expectedRevision:1,envelopeId:'envelope-alpha-2',contractRef:'contract-alpha-2',nominatedSuperUserEmail:'new-nominee@alpha.test',nominationAuthorityRef:'customer-nomination/2'}));
  assert.throws(()=>f.registry.resolveCompletedOrder(completion()),/superseded|nomination/i);assert.equal(f.calls,0);
  const current=f.registry.resolveCompletedOrder(completion({eventId:'complete-alpha-2',envelopeId:'envelope-alpha-2'}));
  assert.equal(current.ownerEmail,'new-nominee@alpha.test');assert.equal(current.orderRevision,2);assert.equal(current.nominationRevision,2);
  assert.equal(f.registry.accept(current).created,true);
  assert.throws(()=>f.registry.recordOrder(order({expectedRevision:1,envelopeId:'stale-envelope'})),/revision/i);
});
test('renewals stay in the same workspace and cannot rearm revoked nomination authority',t=>{
  const f=fixture(t);assert.equal(typeof f.registry.recordOrder,'function');f.registry.recordOrder(order());
  const first=f.registry.accept(f.registry.resolveCompletedOrder(completion()));
  f.registry.recordOrder(order({orderId:'renewal-alpha',envelopeId:'renewal-envelope',contractRef:'renewal-contract',relationship:'renewal',existingWorkspaceId:first.workspaceId}));
  const renewed=f.registry.accept(f.registry.resolveCompletedOrder(completion({eventId:'renewal-complete',envelopeId:'renewal-envelope'})));
  assert.equal(renewed.workspaceId,first.workspaceId);assert.equal(renewed.initialSetupRunId,first.initialSetupRunId);assert.equal(f.calls,1);
  f.registry.revokeOrderNomination({orderId:'renewal-alpha',expectedRevision:1,reasonRef:'customer-authority-revoked'});
  assert.throws(()=>f.registry.resolveCompletedOrder(completion({eventId:'renewal-replayed',envelopeId:'renewal-envelope'})),/revoked/i);
  f.registry.recordOrder(order({orderId:'renewal-again',envelopeId:'renewal-again-envelope',contractRef:'renewal-again-contract',relationship:'renewal',existingWorkspaceId:first.workspaceId}));
  assert.throws(()=>f.registry.resolveCompletedOrder(completion({eventId:'renewal-again',envelopeId:'renewal-again-envelope'})),/revoked/i);
  assert.equal(f.registry.forTenant('alpha').workspaceId,first.workspaceId);assert.equal(f.calls,1);
});
test('DocuSign provider aliases, unknown envelopes and unverified completion cannot bypass stored records',t=>{
  const f=fixture(t);assert.equal(typeof f.registry.recordOrder,'function');f.registry.recordOrder(order());
  for(const change of [{verified:false},{status:'sent'},{envelopeId:'unknown'},{provider:'docu-sign'},{provider:'docusign-demo'}])assert.throws(()=>f.registry.resolveCompletedOrder(completion(change)));
  for(const provider of ['DocuSign',' docusign ','docu-sign','DOCUSIGN-demo'])assert.throws(()=>f.registry.accept({...initial(),provider}),/order|provider/i);
  assert.equal(f.calls,0);
  assert.throws(()=>f.registry.recordOrder(order({orderId:'other-order',envelopeId:'envelope-alpha-1'})),/envelope/i);
  assert.throws(()=>f.registry.recordOrder(order({orderAuthorized:false,envelopeId:'unauthorised'})),/authority/i);
});

test('resolved order authority is immutable and rechecked when accepted after nomination or revocation',t=>{
  for(const change of ['nomination','revocation']){
    const f=fixture(t);f.registry.recordOrder(order());const resolved=f.registry.resolveCompletedOrder(completion());
    assert.throws(()=>{resolved.profile.organisationName='Forged';},TypeError);
    assert.throws(()=>f.registry.accept({...resolved}),/stored.*order/i,'Copying a verifier result cannot copy registry authority');
    if(change==='nomination')f.registry.recordOrder(order({expectedRevision:1,envelopeId:'replacement',contractRef:'replacement',nominatedSuperUserEmail:'replacement@alpha.test'}));
    else f.registry.revokeOrderNomination({orderId:'order-alpha',expectedRevision:1,reasonRef:'revoked'});
    assert.throws(()=>f.registry.accept(resolved),/superseded|revoked/i);assert.equal(f.calls,0);
  }
});
test('trusted envelope authorizer returns the stored contract revision without creating authority or workspace effects',t=>{
  const f=fixture(t);f.registry.recordOrder(order());
  assert.equal(typeof f.registry.authorizeOrderEnvelope,'function');
  const mapped=f.registry.authorizeOrderEnvelope({provider:'docusign',envelopeId:'envelope-alpha-1',tenant:'forged',contractId:'forged'});
  assert.equal(mapped.contractId,'contract-alpha-1');assert.equal(mapped.revision,1);assert.equal(mapped.nominatedSuperUserEmail,'nominee@alpha.test');assert.equal(f.calls,0);
  assert.throws(()=>f.registry.authorizeOrderEnvelope({provider:'docu-sign',envelopeId:'envelope-alpha-1'}));
  assert.throws(()=>f.registry.authorizeOrderEnvelope({provider:'docusign',envelopeId:'unknown'}));
});
test('malformed verified DocuSign signedAt is rejected before workspace effects or completion receipts',t=>{
  const f=fixture(t);f.registry.recordOrder(order());
  for(const signedAt of ['not-a-time','2026-02-30T12:00:00.000Z',42,null,'2026-10-12'])assert.throws(()=>f.registry.accept(f.registry.resolveCompletedOrder(completion({signedAt}))),/signedAt|time/i);
  assert.equal(f.calls,0);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM customer_workspace_events').get().n,0);
  assert.equal(f.registry.accept(f.registry.resolveCompletedOrder(completion({signedAt:'2026-10-12T12:00:00.000Z'}))).created,true);
});
