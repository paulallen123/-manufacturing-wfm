'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createOrganisationAccessSetup } = require('./organisation-access-setup.cjs');
const hash = x => createHash('sha256').update(x).digest('hex');
const binding = { verified: true, ownerAuthorized: true, provider: 'fixture-provider', eventId: 'fixture-event',
  tenant: 'alpha', runId: 'run-alpha', contractRef: 'fixture-contract', ownerEmail: 'owner@alpha.test', ownerAuthorityRef: 'fixture-authority' };
const profile = { organisationName: 'Alpha Factory', industry: 'Manufacturing', timeZone: 'Europe/London' };
const key = { tenant: 'alpha', runId: 'run-alpha', expectedRevision: 1 };

function fixture(t, adapter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-setup-fixture-'));
  const dbPath = path.join(root, 'fixture.sqlite'); let db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,
      role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL);
    CREATE TABLE implementation_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,contract_ref_hash TEXT NOT NULL);
    CREATE TABLE tenant_environments(tenant TEXT PRIMARY KEY,run_id TEXT NOT NULL);
    CREATE TABLE implementation_invitations(tenant TEXT,contract_ref_hash TEXT,recipient_hash TEXT,started_run_id TEXT,status TEXT,expires_at_ms INTEGER);
    CREATE TABLE identity_tenant_control(tenant TEXT PRIMARY KEY,privileged_freeze INTEGER);
    CREATE TABLE passkey_credentials(id TEXT PRIMARY KEY,tenant TEXT,email TEXT,revoked_at INTEGER);
    CREATE TABLE implementation_evidence(id TEXT,kind TEXT,status TEXT);`);
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 4, '{"preserved":true}');
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 8, '{"preserved":true}');
  db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run('run-alpha', 'alpha', hash(binding.contractRef));
  db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run('run-bravo', 'bravo', hash('other-contract'));
  let service = createOrganisationAccessSetup({ db, provisionInitialOwner: adapter });
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { get db() { return db; }, get service() { return service; },
    reserve: (b = binding, p = profile) => service.reserve({ binding: b, profile: p }),
    reopen() { db.close(); db = new DatabaseSync(dbPath); service = createOrganisationAccessSetup({db,provisionInitialOwner:adapter}); },
    user(email = binding.ownerEmail, tenant = 'alpha', role = 'manager', permissions = ['company.configure']) {
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email, tenant, 'fixture-person', role, 0, 'fixture-disabled', 'fixture-disabled', JSON.stringify(permissions));
    },
    count(table) { return db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n; },
    auditFailure() { db.exec("CREATE TRIGGER fail_setup_audit BEFORE INSERT ON organisation_access_setup_events BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END;"); }
  };
}
// Fixture adapter only. Never exported or used by deployed composition.
function fixtureAccount({db,tenant,email,role,costs,permissions}) {
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'fixture-owner',role,costs,'fixture-disabled','fixture-disabled',JSON.stringify(permissions));
}

test('verified binding creates a durable profile without changing tenant data, credentials or readiness', t => {
  const f=fixture(t), before=f.db.prepare('SELECT * FROM tenants').all();
  const result=f.reserve();
  assert.equal(result.setupState,'SETUP_INCOMPLETE'); assert.equal(result.operationalReady,false);
  assert.equal(result.access,'ACCOUNT_SETUP_REQUIRED'); assert.equal(result.invitation,'NOT_AVAILABLE');
  assert.deepEqual(result.profile,profile); assert.equal(result.workspace.route,'onboarding');
  assert.equal(f.count('users'),0); assert.equal(f.count('passkey_credentials'),0); assert.equal(f.count('implementation_evidence'),0);
  assert.deepEqual(f.db.prepare('SELECT * FROM tenants').all(),before);
  assert.equal(f.count('tenant_environments'),0,'Namespace provisioning remains the canonical provisioner boundary');
});
test('missing or unauthorised signing evidence fails without a profile',t=>{
  const f=fixture(t);
  for(const change of [{verified:false},{ownerAuthorized:false}])assert.throws(()=>f.reserve({...binding,...change}),{code:'VERIFIED_OWNER_AUTHORITY_REQUIRED'});
  assert.equal(f.count('organisation_access_setup'),0);
});
test('run/tenant/contract mismatch and absent canonical tenant fail closed',t=>{
  const f=fixture(t);
  for(const change of [{tenant:'bravo'},{runId:'run-bravo'},{contractRef:'wrong-contract'}])assert.throws(()=>f.reserve({...binding,...change}),{code:'SETUP_RUN_BINDING_CONFLICT'});
  f.db.prepare('DELETE FROM tenants WHERE id=?').run('alpha');
  assert.throws(()=>f.reserve(),{code:'CANONICAL_TENANT_REQUIRED'});
});
test('wrong-tenant email and ambiguous case-insensitive identity are rejected',t=>{
  const f=fixture(t);f.user(binding.ownerEmail,'bravo');
  assert.throws(()=>f.reserve(),{code:'SETUP_OWNER_BINDING_CONFLICT'});
  f.db.prepare('DELETE FROM users').run();f.user();f.user('OWNER@alpha.test');
  assert.throws(()=>f.reserve(),{code:'SETUP_OWNER_BINDING_CONFLICT'});
});
test('duplicate signing is idempotent and does not reset a later profile revision',t=>{
  const f=fixture(t);f.user();f.reserve();
  const changed=f.service.updateProfile({...key,actor:{email:binding.ownerEmail,tenant:'alpha'},profile:{organisationName:'Updated'}});
  const replay=f.reserve(); assert.deepEqual(replay,changed);assert.equal(f.count('organisation_access_setup_events'),2);
});
test('changed email, event, provider or authority cannot rebind an existing setup',t=>{
  const f=fixture(t);f.reserve();
  for(const change of [{ownerEmail:'wrong@alpha.test'},{eventId:'another-event'},{provider:'another-provider'},{ownerAuthorityRef:'other-authority'}]) {
    assert.throws(()=>f.reserve({...binding,...change}),{code:'SETUP_BINDING_CONFLICT'});
  }
  assert.equal(f.count('organisation_access_setup_events'),1);
});
test('different contract/run and same-event wrong-tenant replay cannot attach silently',t=>{
  const f=fixture(t);f.reserve();
  f.db.prepare('INSERT INTO implementation_runs VALUES(?,?,?)').run('run-two','alpha',hash('contract-two'));
  assert.throws(()=>f.reserve({...binding,runId:'run-two',contractRef:'contract-two',eventId:'event-two'}),{code:'SETUP_BINDING_CONFLICT'});
  assert.throws(()=>f.reserve({...binding,tenant:'bravo',runId:'run-bravo',contractRef:'other-contract'}),{code:'SETUP_BINDING_CONFLICT'});
});
test('existing environment bound to a different run is preserved',t=>{
  const f=fixture(t);f.db.prepare('INSERT INTO tenant_environments VALUES(?,?)').run('alpha','old-run');
  assert.throws(()=>f.reserve(),{code:'SETUP_ENVIRONMENT_BINDING_CONFLICT'});
  assert.equal(f.db.prepare('SELECT run_id FROM tenant_environments').get().run_id,'old-run');
});
test('account adapter absence is an explicit pending boundary, never success',t=>{
  const f=fixture(t);f.reserve();assert.equal(f.service.ensureAccess(key).access,'ACCOUNT_SETUP_REQUIRED');assert.equal(f.count('users'),0);
});
test('fixture account adapter gets least privilege; duplicate/restart does not recreate account',t=>{
  let calls=0;const f=fixture(t,args=>{calls++;fixtureAccount(args);});f.reserve();
  const first=f.service.ensureAccess(key);assert.equal(first.access,'SECURE_ENROLMENT_REQUIRED');assert.equal(first.revision,2);
  assert.equal(f.count('passkey_credentials'),0);assert.equal(first.operationalReady,false);
  assert.deepEqual(JSON.parse(f.db.prepare('SELECT permissions FROM users').get().permissions),['company.configure']);
  f.reopen();const resumed=f.service.ensureAccess({...key,expectedRevision:2});assert.deepEqual(resumed,first);assert.equal(calls,1);
});
test('existing account with insufficient privilege is never elevated by setup',t=>{
  const f=fixture(t,()=>assert.fail('Adapter must not be called for an existing identity'));f.user(binding.ownerEmail,'alpha','employee',[]);f.reserve();
  assert.equal(f.service.ensureAccess(key).access,'AUTHORISED_ROLE_SETUP_REQUIRED');
  assert.equal(f.db.prepare('SELECT role FROM users').get().role,'employee');
});
test('wrong email or broad role returned by adapter rolls back all its account writes',t=>{
  for(const bad of ['email','role']) {
    const f=fixture(t,args=>fixtureAccount({...args,[bad]:bad==='email'?'wrong@alpha.test':'director'}));f.reserve();
    assert.throws(()=>f.service.ensureAccess(key),{code:'ACCOUNT_ADAPTER_POSTCONDITION_FAILED'});assert.equal(f.count('users'),0);
  }
});
test('audit failure rolls back profile reservation',t=>{
  const f=fixture(t);f.auditFailure();assert.throws(()=>f.reserve(),/fixture audit failure/);assert.equal(f.count('organisation_access_setup'),0);
});
test('audit failure rolls back account creation and revision',t=>{
  const f=fixture(t,fixtureAccount);f.reserve();f.auditFailure();assert.throws(()=>f.service.ensureAccess(key),/fixture audit failure/);
  assert.equal(f.count('users'),0);assert.equal(f.service.status(key).revision,1);
});
test('audit failure rolls back profile updates and preserves facts',t=>{
  const f=fixture(t);f.user();f.reserve();f.auditFailure();
  assert.throws(()=>f.service.updateProfile({...key,actor:{tenant:'alpha',email:binding.ownerEmail},profile:{organisationName:'Changed'}}),/fixture audit failure/);
  assert.deepEqual(f.service.status(key).profile,profile);assert.equal(f.service.status(key).revision,1);
});
test('outer orchestration rollback also rolls back setup and fixture account',t=>{
  const f=fixture(t,fixtureAccount);f.db.exec('BEGIN IMMEDIATE');f.reserve();f.service.ensureAccess(key);f.db.exec('ROLLBACK');
  assert.equal(f.count('organisation_access_setup'),0);assert.equal(f.count('users'),0);assert.equal(f.count('organisation_access_setup_events'),0);
});
test('wrong tenant, unknown email, revoked privilege and stale revisions cannot edit facts',t=>{
  const f=fixture(t);f.user();f.reserve();
  for(const actor of [{tenant:'bravo',email:binding.ownerEmail},{tenant:'alpha',email:'wrong@alpha.test'}])
    assert.throws(()=>f.service.updateProfile({...key,actor,profile}),{code:'SETUP_PERMISSION_REQUIRED'});
  const actor={tenant:'alpha',email:binding.ownerEmail};f.service.updateProfile({...key,actor,profile});
  assert.throws(()=>f.service.updateProfile({...key,actor,profile}),{code:'STALE_SETUP_REVISION'});
  f.db.prepare("UPDATE users SET permissions='[]'").run();
  assert.throws(()=>f.service.updateProfile({...key,expectedRevision:2,actor,profile}),{code:'SETUP_PERMISSION_REQUIRED'});
  assert.throws(()=>f.service.ensureAccess({...key,expectedRevision:undefined}),{code:'STALE_SETUP_REVISION'});
});
test('questionnaire roles, permissions and job-title fields cannot create authority',t=>{
  const f=fixture(t);f.user();f.reserve();
  for(const input of [{...profile,role:'director'},{...profile,permissions:['payroll.export']},{...profile,jobTitle:'CEO'}])
    assert.throws(()=>f.service.updateProfile({...key,actor:{tenant:'alpha',email:binding.ownerEmail},profile:input}),{code:'INVALID_PROFILE_FACTS'});
  assert.equal(f.service.status(key).revision,1);
});
test('canonical freeze prevents account creation and profile mutation',t=>{
  const f=fixture(t,fixtureAccount);f.reserve();f.db.prepare('INSERT INTO identity_tenant_control VALUES(?,1)').run('alpha');
  assert.equal(f.service.status(key).access,'ACCESS_FROZEN');assert.throws(()=>f.service.ensureAccess(key),{code:'SETUP_ACCESS_FROZEN'});
  assert.throws(()=>f.service.updateProfile({...key,actor:{tenant:'alpha',email:binding.ownerEmail},profile}),{code:'SETUP_PERMISSION_REQUIRED'});
  assert.equal(f.count('users'),0);
});
test('invitation projection rejects wrong email/run; replay reads never consume invitations',t=>{
  const f=fixture(t);f.reserve();
  const insert=f.db.prepare('INSERT INTO implementation_invitations VALUES(?,?,?,?,?,?)');
  insert.run('alpha',hash(binding.contractRef),hash('wrong@alpha.test'),null,'PENDING',Date.now()+60000);
  assert.throws(()=>f.service.status(key),{code:'SETUP_INVITATION_BINDING_CONFLICT'});
  f.db.prepare('UPDATE implementation_invitations SET recipient_hash=?,started_run_id=?').run(hash(binding.ownerEmail),'wrong-run');
  assert.throws(()=>f.service.status(key),{code:'SETUP_INVITATION_BINDING_CONFLICT'});
  f.db.prepare('UPDATE implementation_invitations SET started_run_id=NULL').run();
  assert.equal(f.service.status(key).invitation,'PENDING');assert.equal(f.service.status(key).invitation,'PENDING');
  f.db.prepare('UPDATE implementation_invitations SET expires_at_ms=0').run();assert.equal(f.service.status(key).invitation,'EXPIRED');
});
test('enrolment status reads canonical passkeys without claiming readiness',t=>{
  const f=fixture(t);f.user();f.reserve();
  assert.equal(f.service.status(key).access,'SECURE_ENROLMENT_REQUIRED');
  // Status-projection fixture only, not a WebAuthn ceremony or credential proof.
  f.db.prepare('INSERT INTO passkey_credentials VALUES(?,?,?,NULL)').run('fixture-id','alpha',binding.ownerEmail);
  assert.equal(f.service.status(key).access,'ENROLLED');assert.equal(f.service.status(key).operationalReady,false);
  f.db.prepare('UPDATE passkey_credentials SET revoked_at=1').run();assert.equal(f.service.status(key).access,'SECURE_ENROLMENT_REQUIRED');
});
test('setup audit is append-only',t=>{
  const f=fixture(t);f.reserve();assert.throws(()=>f.db.exec('DELETE FROM organisation_access_setup_events'),/append only/);
  assert.throws(()=>f.db.exec("UPDATE organisation_access_setup_events SET action='changed'"),/append only/);
});
test('a missing owner account cannot be reserved simultaneously for another tenant',t=>{
  const f=fixture(t);f.reserve();
  assert.throws(()=>f.reserve({...binding,tenant:'bravo',runId:'run-bravo',contractRef:'other-contract',eventId:'other-event'}),{code:'SETUP_BINDING_CONFLICT'});
  assert.equal(f.count('organisation_access_setup'),1);
});
test('async account adapters are refused before executing any callback',t=>{
  const f=fixture(t);let called=false;
  assert.throws(()=>createOrganisationAccessSetup({db:f.db,provisionInitialOwner:async()=>{called=true;}}),{code:'ASYNC_ACCOUNT_ADAPTER_FORBIDDEN'});
  assert.equal(called,false);
});
test('P1: deletion after initial creation, restart and signing replay cannot resurrect owner access',t=>{
  let calls=0;const f=fixture(t,args=>{calls++;fixtureAccount(args);});f.reserve();
  const created=f.service.ensureAccess(key);assert.equal(created.initialAccessState,'CONSUMED');
  f.db.prepare('DELETE FROM users WHERE email=?').run(binding.ownerEmail);f.reopen();
  const replay=f.reserve();assert.equal(replay.revision,created.revision);assert.equal(replay.access,'ACCESS_RESTORATION_REQUIRED');
  assert.throws(()=>f.service.ensureAccess({...key,expectedRevision:replay.revision}),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});
  assert.equal(calls,1);assert.equal(f.count('users'),0);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM organisation_access_setup_events WHERE action='INITIAL_OWNER_ACCOUNT_CREATED'").get().n,1);
});
test('existing account bound at reservation cannot be recreated after removal',t=>{
  const f=fixture(t,()=>assert.fail('Historical authority must not invoke adapter'));f.user();
  assert.equal(f.reserve().initialAccessState,'CONSUMED');f.db.prepare('DELETE FROM users').run();
  assert.throws(()=>f.service.ensureAccess(key),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});
});
test('revoked permission is not elevated and subsequent deletion cannot reopen consumed authority',t=>{
  let calls=0;const f=fixture(t,args=>{calls++;fixtureAccount(args);});f.reserve();const created=f.service.ensureAccess(key);
  f.db.prepare("UPDATE users SET permissions='[]'").run();
  assert.equal(f.service.ensureAccess({...key,expectedRevision:created.revision}).access,'AUTHORISED_ROLE_SETUP_REQUIRED');
  f.db.prepare('DELETE FROM users').run();const replay=f.reserve();
  assert.throws(()=>f.service.ensureAccess({...key,expectedRevision:replay.revision}),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});assert.equal(calls,1);
});
test('deny-only tombstone prevents even unused setup authority from provisioning after revocation',t=>{
  const f=fixture(t,()=>assert.fail('Revoked authority must not invoke adapter'));f.reserve();
  const revoked=f.service.revokeInitialAccess({...key,reasonRef:'fixture-revocation-case'});
  assert.equal(revoked.initialAccessState,'REVOKED');assert.equal(revoked.access,'ACCESS_RESTORATION_REQUIRED');
  assert.deepEqual(f.service.revokeInitialAccess({...key,reasonRef:'fixture-revocation-case'}),revoked);
  f.reopen();const replay=f.reserve();assert.equal(replay.initialAccessState,'REVOKED');
  assert.throws(()=>f.service.ensureAccess({...key,expectedRevision:replay.revision}),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});
  assert.equal(f.count('users'),0);
});
test('revocation and owner deletion share the outer canonical transaction and audit boundary',t=>{
  const f=fixture(t,fixtureAccount);f.reserve();f.service.ensureAccess(key);f.auditFailure();
  f.db.exec('BEGIN IMMEDIATE');
  try {
    f.db.prepare('DELETE FROM users').run();
    assert.throws(()=>f.service.revokeInitialAccess({...key,reasonRef:'fixture-revocation'}),/fixture audit failure/);
  } finally {f.db.exec('ROLLBACK');}
  assert.equal(f.count('users'),1);assert.equal(f.service.status(key).initialAccessState,'CONSUMED');
  assert.equal(f.service.status(key).revision,2);
});
test('failed initial-creation audit does not consume authority; safe retry still works',t=>{
  const f=fixture(t,fixtureAccount);f.reserve();f.auditFailure();
  assert.throws(()=>f.service.ensureAccess(key),/fixture audit failure/);
  assert.equal(f.service.status(key).initialAccessState,'RESERVED');assert.equal(f.count('users'),0);
  f.db.exec('DROP TRIGGER fail_setup_audit');f.reopen();
  assert.equal(f.service.ensureAccess(key).initialAccessState,'CONSUMED');assert.equal(f.count('users'),1);
});
test('legacy profile without a creation receipt is closed, never assumed to be unused',t=>{
  const f=fixture(t,()=>assert.fail('Legacy authority must not provision'));f.reserve();
  f.db.exec('DROP TABLE organisation_access_initial_authority');f.reopen();
  const migrated=f.service.status(key);assert.equal(migrated.initialAccessState,'CONSUMED');
  assert.equal(migrated.access,'ACCESS_RESTORATION_REQUIRED');
  assert.throws(()=>f.service.ensureAccess(key),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});
  const count=f.count('organisation_access_setup_events');f.reopen();assert.equal(f.count('organisation_access_setup_events'),count);
});
test('consumed/revoked lifecycle cannot be reset or deleted; freeze keeps its existing refusal',t=>{
  const f=fixture(t,fixtureAccount);f.reserve();f.service.ensureAccess(key);
  assert.throws(()=>f.db.exec("UPDATE organisation_access_initial_authority SET state='RESERVED'"),/cannot be reset/);
  assert.throws(()=>f.db.exec('DELETE FROM organisation_access_initial_authority'),/cannot be reset/);
  f.service.revokeInitialAccess({...key,reasonRef:'fixture-revocation'});
  assert.throws(()=>f.db.exec("UPDATE organisation_access_initial_authority SET state='CONSUMED'"),/cannot be reset/);
  f.db.prepare('INSERT INTO identity_tenant_control VALUES(?,1)').run('alpha');
  assert.equal(f.service.status(key).access,'ACCESS_FROZEN');
  assert.throws(()=>f.service.ensureAccess({...key,expectedRevision:3}),{code:'SETUP_ACCESS_FROZEN'});
});
test('cost privilege must be zero on new accounts; excess privilege rolls back account, receipt and audit',t=>{
  const f=fixture(t,args=>{assert.equal(args.costs,0);fixtureAccount({...args,costs:1});});f.reserve();
  assert.throws(()=>f.service.ensureAccess(key),{code:'ACCOUNT_ADAPTER_POSTCONDITION_FAILED'});
  assert.equal(f.count('users'),0);assert.equal(f.count('organisation_access_setup_events'),1);
  const status=f.service.status(key);assert.equal(status.initialAccessState,'RESERVED');assert.equal(status.revision,1);
});
test('existing cost privileges are neither reduced nor used as permission to recreate an account',t=>{
  const f=fixture(t,()=>assert.fail('Existing account must not invoke adapter'));f.user();
  f.db.prepare('UPDATE users SET costs=1').run();f.reserve();f.service.ensureAccess(key);
  assert.equal(f.db.prepare('SELECT costs FROM users').get().costs,1);
  f.db.prepare('DELETE FROM users').run();
  assert.throws(()=>f.service.ensureAccess(key),{code:'INITIAL_OWNER_RESTORATION_REQUIRES_FRESH_AUTHORITY'});
});
