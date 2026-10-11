'use strict';
// Isolated configuration tests: real sealed compiler and SQLite, no accounts/providers.
const test = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createWorkspaceSetup} = require('./workspace-setup.cjs');
const compiler = require('./test-support/sealed-compiler.cjs')(test);
const binding = {tenant:'alpha', runId:'run-a'};
const candidate = {candidateSha:'a'.repeat(40), deploymentId:'deployment-a'};
const answers = () => ({
  organisation:{name:'Example Works',countries:['UK'],sites:[{code:'AA',name:'Factory',timezone:'Europe/London'}]},
  workforce:{count:25,languages:['en'],shiftPatterns:2},
  capabilities:{modules:['core','scheduling','integrations'],trainingRoles:['employee','manager']},
  connections:{timing:'later',systems:[]}
});
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE applied(tenant TEXT PRIMARY KEY,run_id TEXT,scope_digest TEXT,configuration_digest TEXT);');
  let calls = 0;
  const getAppliedState = ({tenant,runId}) => {
    const row = db.prepare('SELECT * FROM applied WHERE tenant=? AND run_id=?').get(tenant,runId);
    return {scopeDigest:row?.scope_digest || null,configurationDigest:row?.configuration_digest || null};
  };
  const applyConfiguration = value => {
    calls++;
    db.prepare('INSERT INTO applied VALUES(?,?,?,?) ON CONFLICT(tenant) DO UPDATE SET scope_digest=excluded.scope_digest,configuration_digest=excluded.configuration_digest')
      .run(value.tenant,value.runId,value.compiled.scopeDigest,value.compiled.manifestDigest);
    return getAppliedState(value);
  };
  const open = (options={}) => createWorkspaceSetup({db,compiler,...candidate,getAppliedState,applyConfiguration,...options});
  const setup = open();
  t.after(() => db.close());
  const save = (value=answers(),revision=0) => setup.save({...binding,expectedRevision:revision,answers:value,actor:'owner-a'});
  const apply = (draft,options={}) => setup.apply({...binding,expectedRevision:draft.revision,reviewToken:draft.reviewToken,actor:'owner-a',...options});
  return {db,setup,open,save,apply,getAppliedState,applyConfiguration,get calls(){return calls;}};
}

test('saving four answers produces a review and leaves applied configuration untouched', t => {
  const f=fixture(t); const draft=f.save();
  assert.equal(draft.revision,1); assert.equal(draft.status,'DRAFT');
  assert.equal(draft.compiled.status,'compiled'); assert.match(draft.reviewToken,/^[0-9a-f]{64}$/);
  assert.equal(f.calls,0); assert.equal(f.getAppliedState(binding).scopeDigest,null);
  assert.equal(draft.operationalReady,false);
  assert.deepEqual(draft.deferredIntegrations,[]);
  assert.ok(!draft.compiled.manifests.entitlements.modules.includes('integrations'));
  assert.deepEqual(f.setup.read(binding).answers,draft.answers);
});
test('restart preserves a saved draft and reviewed apply is idempotent', t => {
  const f=fixture(t), draft=f.save();
  const reopened=f.open(); assert.deepEqual(reopened.read(binding),draft);
  const applied=f.apply(draft); assert.equal(applied.status,'APPLIED');
  assert.equal(applied.applied.configurationDigest,draft.compiled.manifestDigest);
  assert.equal(f.calls,1); assert.equal(f.apply(draft).status,'APPLIED'); assert.equal(f.calls,1);
});
test('stale answers cannot overwrite a newer revision or apply the older review', t => {
  const f=fixture(t), first=f.save(); const next=answers(); next.workforce.count=40;
  const second=f.save(next,first.revision);
  assert.throws(()=>f.save(answers(),first.revision), /revision/i);
  assert.throws(()=>f.apply(first), /revision/i);
  assert.deepEqual(f.setup.read(binding),second);
});
test('changes to applied scope invalidate a saved review', t => {
  const f=fixture(t), draft=f.save(); f.db.prepare('INSERT INTO applied VALUES(?,?,?,?)').run('alpha','run-a','changed','changed');
  assert.throws(()=>f.apply(draft), /configuration changed/i);
  assert.equal(f.setup.read(binding).reviewToken,null); assert.equal(f.calls,0);
});
test('review from an earlier deployment cannot apply after restart', t => {
  const f=fixture(t), draft=f.save(), updated=f.open({deploymentId:'deployment-b'});
  assert.throws(()=>updated.apply({...binding,expectedRevision:1,reviewToken:draft.reviewToken,actor:'owner-a'}), /review/i);
  const fresh=updated.read(binding); assert.notEqual(fresh.reviewToken,draft.reviewToken);
  assert.equal(updated.apply({...binding,expectedRevision:1,reviewToken:fresh.reviewToken,actor:'owner-a'}).status,'APPLIED');
});
test('review requires a concrete candidate and deployment', t => {
  const f=fixture(t); const setup=f.open({candidateSha:'',deploymentId:''});
  const draft=setup.save({...binding,answers:answers(),expectedRevision:0,actor:'owner-a'});
  assert.equal(draft.reviewToken,null);
  assert.throws(()=>setup.apply({...binding,expectedRevision:1,reviewToken:'',actor:'owner-a'}), /review|deployment/i);
});
test('missing sites produce clarification without an applicable review', t => {
  const f=fixture(t), value=answers(); value.organisation.sites=[];
  const draft=f.save(value); assert.equal(draft.compiled.status,'needs_clarification');
  assert.ok(draft.compiled.questions.some(q=>q.code==='sites-required'));
  assert.equal(draft.reviewToken,null); assert.throws(()=>f.apply(draft), /clarification/i);
});
test('deferred systems remain requested and never become configured integrations', t => {
  const f=fixture(t), value=answers(); value.connections.systems=[{provider:'Example HR',mode:'api',objectTypes:['people']}];
  const draft=f.save(value); assert.equal(draft.deferredIntegrations[0].provider,'Example HR');
  assert.deepEqual(draft.compiled.manifests.integrations,[]);
  assert.equal(f.apply(draft).operationalReady,false);
});
for(const [label,mutate] of [
  ['unknown policy',v=>{v.policies={overtimeHours:8};}],
  ['access grant',v=>{v.capabilities.permissions=['company.configure'];}],
  ['invalid timezone',v=>{v.organisation.sites[0].timezone='Europe/NotReal';}],
  ['duplicate site',v=>{v.organisation.sites.push({...v.organisation.sites[0]});}],
  ['fractional count',v=>{v.workforce.count=1.5;}],
  ['invalid connection timing',v=>{v.connections.timing='done';}]
]) test(label+' is rejected without saving a draft', t => {
  const f=fixture(t), value=answers(); mutate(value);
  assert.throws(()=>f.save(value)); assert.equal(f.setup.read(binding).revision,0);
});
test('another tenant or run cannot read or reuse a review', t => {
  const f=fixture(t), draft=f.save();
  for(const other of [{tenant:'bravo',runId:'run-a'},{tenant:'alpha',runId:'run-b'}]) {
    assert.equal(f.setup.read(other).revision,0);
    assert.throws(()=>f.setup.apply({...other,expectedRevision:1,reviewToken:draft.reviewToken,actor:'owner-b'}), /revision|draft/i);
  }
});
test('draft audit failure rolls back the new revision', t => {
  const f=fixture(t); f.db.exec("CREATE TRIGGER refuse_setup_audit BEFORE INSERT ON workspace_setup_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.save(),/audit unavailable/); assert.equal(f.setup.read(binding).revision,0);
});
test('failed application preserves the draft and the previous applied state', t => {
  const f=fixture(t), draft=f.save();
  const failing=f.open({applyConfiguration:value=>{f.applyConfiguration(value);throw Error('interrupted');}});
  assert.throws(()=>failing.apply({...binding,expectedRevision:1,reviewToken:draft.reviewToken,actor:'owner-a'}),/interrupted/);
  assert.equal(f.getAppliedState(binding).scopeDigest,null); assert.deepEqual(f.setup.read(binding),draft);
  assert.equal(f.apply(draft).status,'APPLIED');
});
test('successful callback claims require matching persisted readback', t => {
  const f=fixture(t), draft=f.save();
  const lying=f.open({applyConfiguration:()=>({scopeDigest:'claimed',configurationDigest:'claimed'})});
  assert.throws(()=>lying.apply({...binding,expectedRevision:1,reviewToken:draft.reviewToken,actor:'owner-a'}),/readback/i);
  assert.deepEqual(f.setup.read(binding),draft);
});
test('apply audit failure undoes configuration and leaves the reviewed draft retryable', t => {
  const f=fixture(t), draft=f.save();
  f.db.exec("CREATE TRIGGER refuse_apply_audit BEFORE INSERT ON workspace_setup_events WHEN NEW.event='CONFIGURATION_APPLIED' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.apply(draft), /audit unavailable/);
  assert.equal(f.getAppliedState(binding).scopeDigest,null); assert.deepEqual(f.setup.read(binding),draft);
  f.db.exec('DROP TRIGGER refuse_apply_audit'); assert.equal(f.apply(draft).status,'APPLIED');
});
test('outer rollback undoes a saved draft without committing caller work', t => {
  const f=fixture(t); f.db.exec('BEGIN IMMEDIATE'); f.save();
  assert.equal(f.db.isTransaction,true); f.db.exec('ROLLBACK'); assert.equal(f.setup.read(binding).revision,0);
});
test('new draft after application preserves last applied readback until reviewed apply', t => {
  const f=fixture(t), first=f.save(), applied=f.apply(first), value=answers(); value.workforce.count=50;
  const next=f.save(value,first.revision); assert.equal(next.status,'DRAFT');
  assert.deepEqual(next.applied,applied.applied); assert.equal(f.getAppliedState(binding).scopeDigest,first.compiled.scopeDigest);
  assert.equal(f.apply(next).applied.scopeDigest,next.compiled.scopeDigest);
});
test('initial questionnaire completion survives restart and later settings drafts',t=>{
  const f=fixture(t),first=f.save();assert.equal(first.questionnaireComplete,false);
  const applied=f.apply(first);assert.equal(applied.questionnaireComplete,true);assert.ok(applied.completedAt);
  const restarted=f.open().read(binding);assert.equal(restarted.completedAt,applied.completedAt);
  const value=answers();value.workforce.count=32;const amendment=f.save(value,first.revision);
  assert.equal(amendment.questionnaireComplete,true);assert.equal(amendment.completedAt,applied.completedAt);
  assert.equal(f.apply(amendment).completedAt,applied.completedAt);
});
test('current compiler revalidates a saved draft before review and apply',t=>{
  const f=fixture(t),draft=f.save();
  const changed=f.open({compiler:{compile(input){compiler.compile(input);throw Object.assign(Error('Current compiler requires a new answer'),{status:409});}}});
  assert.throws(()=>changed.apply({...binding,expectedRevision:1,reviewToken:draft.reviewToken,actor:'owner-a'}),/Current compiler/);
  assert.equal(f.calls,0);
});
for(const timezone of ['UTC','America/Argentina/Buenos_Aires'])test('real IANA timezone '+timezone+' can be compiled without guessing another timezone',t=>{
  const f=fixture(t),value=answers();value.organisation.sites[0].timezone=timezone;
  const draft=f.save(value);assert.equal(draft.compiled.scope.sites[0].timezone,timezone);assert.ok(draft.reviewToken);
});
