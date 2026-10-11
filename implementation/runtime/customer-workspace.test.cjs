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
