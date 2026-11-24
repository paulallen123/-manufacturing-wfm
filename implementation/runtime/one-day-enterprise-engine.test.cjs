'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash,createHmac } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createOneDayEnterpriseEngine, REQUIREMENTS } = require('./one-day-enterprise-engine.cjs');

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-one-day-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('bravo', 1, '{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha', 'alpha', 'm1', 'manager', 1, 's', '00', JSON.stringify(['company.configure']));
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('employee@alpha', 'alpha', 'e1', 'employee', 0, 's', '00', '[]');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@bravo', 'bravo', 'm2', 'manager', 1, 's', '00', JSON.stringify(['company.configure']));
  const tokens = {
    manager: 'm'.repeat(64),
    employee: 'e'.repeat(64),
    bravo: 'b'.repeat(64)
  };
  const expires = Date.now() + 60_000;
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.manager), 'manager@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.employee), 'employee@alpha', expires);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(tokens.bravo), 'manager@bravo', expires);
  db.close();

  const sentInvitations = [];
  let invitationAttempts = 0;
  const engineOptions = {
    configurationCompiler: options.configurationCompiler,
    verifySignedContract: options.verifySignedContract,
    provisionInitialOwner: options.provisionInitialOwner,
    createCanonicalTenant: options.createCanonicalTenant,
    strictEvidence: options.strictEvidence,
    agentsApiEnabled: false,
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: options.publicOrigin ?? 'https://implementation.test',
    requireCandidateBinding: options.requireCandidateBinding,
    candidateSha: options.candidateSha || 'a'.repeat(40),
    deploymentId: options.deploymentId || 'deployment-test',
    notificationRetryDelayMs: options.notificationRetryDelayMs,
    notificationRetryPollMs: options.notificationRetryPollMs ?? 0
  };
  if (!options.omitDedicatedRecoverySecret) {
    engineOptions.invitationRecoverySecret = options.invitationRecoverySecret || 'dedicated-invitation-recovery-test-secret';
  }
  if (!options.useDefaultInvitationSender) {
    engineOptions.sendInvitation = options.sendInvitation || (async invitation => {
      invitationAttempts += 1;
      if (options.acceptThenFailFirstInvitation && invitationAttempts === 1) {
        sentInvitations.push(invitation);
        throw new Error('simulated lost provider response after acceptance');
      }
      if (Number(options.failInvitationAttempts || 0) >= invitationAttempts) throw new Error('simulated temporary mail outage');
      if (options.failFirstInvitation && invitationAttempts === 1) throw new Error('simulated temporary mail outage');
      if (options.rejectInvitationCredentials) {
        const error = new Error('simulated provider credential rejection');
        error.permanent = true;
        error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
        throw error;
      }
      if (options.failInvitationDelivery) throw new Error('simulated mail transport failure');
      sentInvitations.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-' + sentInvitations.length };
    });
  }
  const engine = createOneDayEnterpriseEngine(engineOptions);

  return {
    dir,
    dbPath,
    candidateSha: engineOptions.candidateSha,
    deploymentId: engineOptions.deploymentId,
    engine,
    tokens,
    sentInvitations,
    get invitationAttempts() { return invitationAttempts; },
    internal: { 'x-wfm-implementation-internal': 'implementation-worker-test-token' },
    contractWebhook: { 'x-wfm-contract-webhook': 'contract-webhook-test-token' },
    close() {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function response() {
  const headers = {};
  return {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    body: '',
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    end(value = '') {
      this.body = String(value);
      this.headersSent = true;
      this.writableEnded = true;
    },
    headers
  };
}

test('legacy activation rejects before all writes when an unassociated run or environment already exists',async t=>{
  for(const kind of ['run','environment','both']){
    const f=fixture();const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
    if(kind!=='environment')db.prepare('INSERT INTO implementation_runs VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-run','alpha',sha256('legacy-contract'),'BUILDING',Date.now(),Date.now()+3600000,1,new Date().toISOString(),new Date().toISOString());
    if(kind!=='run')db.prepare('INSERT INTO tenant_environments VALUES(?,?,?,?,?,?,?,?,?)').run('alpha','legacy-env','legacy-namespace','legacy-run','READY','{}','legacy-digest','old','old');
    const tables=['implementation_runs','implementation_scope','implementation_invitations','implementation_notification_outbox','tenant_environments','implementation_work_jobs','implementation_events','tenant_environment_events'];
    const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all());const before=snapshot();
    const result=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'new-contract',recipientEmail:'manager@alpha'},f.internal);
    assert.equal(result.status,409,JSON.stringify(result.body));assert.equal(result.body.code,'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');assert.deepEqual(snapshot(),before);assert.equal(f.invitationAttempts,0);
  }
});

async function waitFor(predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for automatic recovery.');
}

test('trusted adoption resolves identity independently of spoofed body and preserves completed setup through fresh-session renewal and upgrade',async t=>{
  let trusted;
  const f=fixture({configurationCompiler:require('./test-support/sealed-compiler.cjs')(t),verifySignedContract(){return trusted;},provisionInitialOwner(){throw Error('Adoption must preserve the existing owner');}});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  const started=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'legacy-contract',recipientEmail:'manager@alpha'},f.internal);
  assert.equal(started.status,201);
  const route='/api/implementation/autonomous/setup';
  const saved=await call(f.engine,f.tokens.manager,'POST',route,{expectedRevision:0,answers:setupAnswers()});
  assert.equal((await call(f.engine,f.tokens.manager,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,200);
  const env=db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get('alpha');
  trusted={operation:'adopt-existing',verified:true,ownerAuthorized:true,customerId:'legacy-customer',customerAuthorityRef:'fixture-verified-customer',tenant:'alpha',provider:'fixture-verified-provider',eventId:'adoption',contractRef:'renewal',relationship:'renewal',ownerEmail:'manager@alpha',ownerAuthorityRef:'fixture-existing-owner',existingRunId:started.body.implementation.runId,existingEnvironmentId:env.environment_id,existingNamespace:env.namespace};
  const tables=['implementation_runs','implementation_scope','tenant_environments','workspace_setup_drafts','workspace_setup_events','users','implementation_invitations','implementation_notification_outbox','implementation_events','implementation_work_jobs'];
  const preserved=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all());const before=preserved();
  const spoof={operation:'adopt-existing',verified:true,ownerAuthorized:true,tenant:'bravo',existingRunId:'attacker-run',ownerEmail:'manager@bravo',customerId:'attacker'};
  const send=()=>call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',spoof,f.contractWebhook);
  const adopted=await send();assert.equal(adopted.status,200,JSON.stringify(adopted.body));assert.equal(adopted.body.workspace.tenant,'alpha');assert.equal(adopted.body.workspace.initialSetupRunId,env.run_id);assert.equal(adopted.body.questionnaireReset,false);
  assert.deepEqual(preserved(),before);assert.equal((await send()).body.workspace.workspaceId,adopted.body.workspace.workspaceId);assert.deepEqual(preserved(),before);
  const complete=(await call(f.engine,f.tokens.manager,'GET',route)).body;assert.equal(complete.questionnaireComplete,true);
  const fresh='fresh-session-after-adoption';db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(fresh),'manager@alpha',Date.now()+60_000);
  assert.deepEqual((await call(f.engine,fresh,'GET',route)).body,complete);
  for(const relationship of ['renewal','amendment']){
    trusted={...trusted,eventId:relationship+'-next',contractRef:relationship+'-next',relationship,existingWorkspaceId:adopted.body.workspace.workspaceId};
    for(const key of ['operation','existingRunId','existingEnvironmentId','existingNamespace'])delete trusted[key];
    assert.equal((await send()).status,200);assert.deepEqual(preserved(),before);assert.deepEqual((await call(f.engine,fresh,'GET',route)).body,complete);
  }
  const bypass=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'unverified-renewal',recipientEmail:'manager@alpha'},f.internal);
  assert.equal(bypass.status,409);assert.deepEqual(preserved(),before);assert.equal(f.invitationAttempts,1);
  trusted={...trusted,operation:'adopt-existing',existingWorkspaceId:undefined,existingRunId:env.run_id,existingEnvironmentId:env.environment_id,existingNamespace:env.namespace,verified:false};
  assert.equal((await send()).status,403);assert.deepEqual(preserved(),before);
});

test('initial adoption and replay preserve a pending legacy invitation without acquiring notification authority',async t=>{
  let trusted;
  const f=fixture({failInvitationAttempts:2,notificationRetryDelayMs:0,verifySignedContract(){return trusted;}});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  const started=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'legacy-contract',recipientEmail:'manager@alpha',scope:scopeFixture()},f.internal);
  assert.equal(started.status,201);assert.equal(started.body.notification.pendingRetry,true);assert.equal(f.invitationAttempts,2);
  const env=db.prepare('SELECT * FROM tenant_environments').get();
  trusted={operation:'adopt-existing',verified:true,ownerAuthorized:true,customerId:'legacy-customer',customerAuthorityRef:'fixture-verified-customer',tenant:'alpha',provider:'fixture-verified-provider',eventId:'adoption',contractRef:'legacy-contract',relationship:'initial',ownerEmail:'manager@alpha',ownerAuthorityRef:'fixture-existing-owner',existingRunId:env.run_id,existingEnvironmentId:env.environment_id,existingNamespace:env.namespace};
  const tables=['implementation_invitations','implementation_notification_outbox','implementation_notification_attempts','implementation_events','tenant_environments','implementation_runs','implementation_scope'];
  const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all()),before=snapshot();
  for(let i=0;i<2;i++){
    const adopted=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);
    assert.equal(adopted.status,200);assert.deepEqual(snapshot(),before,'Adoption must not dispatch or mutate legacy invitation recovery');assert.equal(f.invitationAttempts,2);
  }
  for(const key of ['operation','existingRunId','existingEnvironmentId','existingNamespace'])delete trusted[key];
  const replay=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);
  assert.equal(replay.status,200);assert.deepEqual(snapshot(),before,'A normal signing replay must retain the adopted workspace boundary');assert.equal(f.invitationAttempts,2);
});

test('HTTP adoption audit failures roll back associations and successful adoption performs no later legacy audit writes',async t=>{
  let trusted;
  const f=fixture({failInvitationAttempts:2,notificationRetryDelayMs:0,verifySignedContract(){return trusted;}});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  const started=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'legacy-contract',recipientEmail:'manager@alpha',scope:scopeFixture()},f.internal);
  assert.equal(started.status,201);assert.equal(started.body.notification.pendingRetry,true);
  const env=db.prepare('SELECT * FROM tenant_environments').get();
  trusted={operation:'adopt-existing',verified:true,ownerAuthorized:true,customerId:'legacy-customer',customerAuthorityRef:'fixture-verified-customer',tenant:'alpha',provider:'fixture-verified-provider',eventId:'adoption',contractRef:'legacy-contract',relationship:'initial',ownerEmail:'manager@alpha',ownerAuthorityRef:'fixture-existing-owner',existingRunId:env.run_id,existingEnvironmentId:env.environment_id,existingNamespace:env.namespace};
  const legacyTables=['implementation_invitations','implementation_notification_outbox','implementation_notification_attempts','implementation_events','tenant_environments','implementation_runs','implementation_scope'];
  const snapshot=tables=>tables.map(table=>db.prepare('SELECT * FROM '+table).all()),before=snapshot(legacyTables);
  const associations=['customer_workspaces','customer_workspace_contracts','customer_workspace_events','customer_workspace_adoptions'];
  for(const table of ['customer_workspace_events','customer_workspace_adoptions']){
    db.exec(`CREATE TRIGGER refuse_adoption_audit BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'adoption audit unavailable'); END`);
    const failed=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);
    assert.equal(failed.status,500);assert.deepEqual(snapshot(legacyTables),before);assert.ok(snapshot(associations).every(rows=>rows.length===0));assert.equal(f.invitationAttempts,2);
    db.exec('DROP TRIGGER refuse_adoption_audit');
  }
  db.exec("CREATE TRIGGER refuse_legacy_audit BEFORE INSERT ON implementation_events BEGIN SELECT RAISE(ABORT,'legacy audit unavailable'); END");
  const adopted=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);
  assert.equal(adopted.status,200);assert.deepEqual(snapshot(legacyTables),before);assert.ok(snapshot(associations).every(rows=>rows.length===1));assert.equal(f.invitationAttempts,2);
});


async function call(engine, token, method, url, body, extraHeaders = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = {
    ...(token ? { cookie: 'wfm_session=' + token } : {}),
    ...extraHeaders
  };
  const res = response();
  const handled = await engine.handleRequest(req, res);
  assert.equal(handled, true);
  return {
    status: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
    headers: res.headers
  };
}

const GOLDEN_JOURNEY_STEPS = [
  'contract-signed','secure-sign-in','integrations-connected','source-discovery',
  'workforce-import','source-reconciliation','customer-configuration',
  'customer-specific-training','go-live-admission','shift-workforce-management',
  'time-absence-approval','payroll-batch-released','payroll-provider-accepted','payroll-provider-readback',
  'downstream-state-update','roi-value-evidence',
  'support-problem-injected','support-problem-detected','support-problem-repaired'
];

function setupAnswers() {
  return {organisation:{name:'New Works',countries:['UK'],sites:[{code:'NW',name:'New Factory',timezone:'Europe/London'}]},
    workforce:{count:10,languages:['en'],shiftPatterns:2},
    capabilities:{modules:['core','scheduling','integrations'],trainingRoles:['employee','manager']},
    connections:{timing:'later',systems:[]}};
}
function signingFixture(t,extra={}){
  const secret='isolated-signing-test-secret',bindings=new Map();let provisions=0;
  const owner='first.owner@alpha.test';
  const f=fixture({sendInvitation:extra.sendInvitation,configurationCompiler:require('./test-support/sealed-compiler.cjs')(t),
    verifySignedContract({rawBody,headers}){
      const expected=createHmac('sha256',secret).update(rawBody).digest('hex');
      if(headers['x-test-signature']!==expected)throw Object.assign(Error('Invalid signing signature'),{statusCode:403});
      const event=JSON.parse(rawBody.toString('utf8'));const binding=bindings.get(event.eventId);
      if(!binding)throw Object.assign(Error('Unknown verified contract'),{statusCode:403});return binding;
    },
    provisionInitialOwner({db,tenant,email,role,costs,permissions}){
      provisions++;
      // Isolated account fixture only. No real credential or identity authority.
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run(email,tenant,'fixture-owner-root',role,costs,'fixture-disabled','00',JSON.stringify(permissions));
    }});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  const initial={verified:true,ownerAuthorized:true,customerId:'customer-a',customerAuthorityRef:'crm/customer-a',tenant:'alpha',provider:'test-signature-provider',eventId:'signed-a',contractRef:'first-contract',relationship:'initial',ownerEmail:owner,ownerAuthorityRef:'signed-owner-a',profile:{organisationName:'Alpha Works'}};
  const send=async(binding=initial,body={eventId:binding.eventId},signature)=>{
    bindings.set(binding.eventId,binding);
    return call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',body,{...f.contractWebhook,'x-test-signature':signature??createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex')});
  };
  return {...f,db,owner,initial,send,get provisions(){return provisions;}};
}
for(const background of [false,true])for(const success of [false,true])test('revocation during '+(background?'background':'initial')+' invitation '+(success?'success':'failure')+' prevents later sends and preserves cancellation',async t=>{
  let entered,finish,count=0;const started=new Promise(resolve=>{entered=resolve;});
  const f=signingFixture(t,{async sendInvitation(){
    count++;if(background&&count<=2)throw Error('temporary outage');
    if(count>(background?3:1))return {provider:'fixture',messageId:'forbidden-retry'};
    entered();return await new Promise((resolve,reject)=>{finish=()=>success?resolve({provider:'fixture',messageId:'already-dispatched'}):reject(Error('transport failed'));});
  }});
  let pending;
  if(background){assert.equal((await f.send()).status,201);f.db.exec('UPDATE implementation_notification_outbox SET next_attempt_at_ms=0');pending=f.engine.retryDueNotifications();}
  else pending=f.send();
  await started;f.db.prepare('UPDATE users SET permissions=? WHERE email=?').run('[]',f.owner);finish();const result=await pending;
  assert.equal(count,background?3:1,'No invitation send may start after revocation');
  assert.equal(f.db.prepare('SELECT status FROM implementation_invitations').get().status,'REVOKED');
  assert.equal(f.db.prepare('SELECT state FROM implementation_notification_outbox').get().state,'BLOCKED');
  if(background)assert.equal(result.delivered,0);else{assert.equal(result.body.notification.delivered,false);assert.equal(result.body.notification.blocked,true);}
});
for(const change of ['permission','session','freeze']) test('setup apply rechecks '+change+' after reading the body inside its transaction',async t=>{
  const f=signingFixture(t);assert.equal((await f.send()).status,201);
  const token='race-owner-session';f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(token),f.owner,Date.now()+60000);
  const route='/api/implementation/autonomous/setup';
  const saved=await call(f.engine,token,'POST',route,{expectedRevision:0,answers:setupAnswers()});assert.equal(saved.status,200);
  const before=f.db.prepare('SELECT * FROM workspace_setup_drafts').all();
  const req=Readable.from((async function*(){
    if(change==='permission')f.db.prepare('UPDATE users SET permissions=? WHERE email=?').run('[]',f.owner);
    if(change==='session')f.db.prepare('DELETE FROM sessions WHERE email=?').run(f.owner);
    if(change==='freeze')f.db.exec("CREATE TABLE identity_tenant_control(tenant TEXT PRIMARY KEY,privileged_freeze INTEGER); INSERT INTO identity_tenant_control VALUES('alpha',1)");
    yield JSON.stringify({expectedRevision:1,reviewToken:saved.body.reviewToken});
  })());
  req.method='POST';req.url=route+'/apply';req.headers={cookie:'wfm_session='+token};const res=response();
  await f.engine.handleRequest(req,res);
  assert.ok([401,403].includes(res.statusCode),res.body);
  assert.deepEqual(f.db.prepare('SELECT * FROM workspace_setup_drafts').all(),before);
  assert.equal(f.db.prepare('SELECT state FROM tenant_environments').get().state,'SETUP_REQUIRED');
});
test('signed input without a real verifier is disabled and creates no workspace',async t=>{
  const f=fixture();t.after(()=>f.close());
  const result=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{state:'SIGNED',tenant:'alpha',contractId:'unverified',recipientEmail:'first@alpha.test'},f.contractWebhook);
  assert.equal(result.status,503);assert.equal(f.sentInvitations.length,0);
  const db=new DatabaseSync(f.dbPath);assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,0);db.close();
});
test('verified signing creates a new owner once and renewal preserves completed questionnaire and namespace',async t=>{
  const f=signingFixture(t);
  const bad=await f.send(f.initial,{eventId:'signed-a'},'invalid');assert.equal(bad.status,403);assert.equal(f.provisions,0);
  const signed=await f.send(f.initial,{eventId:'signed-a',tenant:'bravo',recipientEmail:'attacker@bravo.test'});
  assert.equal(signed.status,201,JSON.stringify(signed.body));assert.equal(f.provisions,1);
  const owner=f.db.prepare('SELECT * FROM users WHERE email=?').get(f.owner);assert.equal(owner.tenant,'alpha');assert.equal(owner.costs,0);assert.deepEqual(JSON.parse(owner.permissions),['company.configure']);
  const workspace=f.db.prepare('SELECT * FROM customer_workspaces').get();const environment=f.db.prepare('SELECT * FROM tenant_environments').get();
  assert.equal(environment.state,'SETUP_REQUIRED');assert.equal(environment.run_id,workspace.initial_run_id);
  // This route test uses an isolated session. Separate WebAuthn proof must enrol/authenticate the new owner.
  const token='new-owner-session-fixture';f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(token),f.owner,Date.now()+60000);
  const route='/api/implementation/autonomous/setup';
  const saved=await call(f.engine,token,'POST',route,{expectedRevision:0,answers:setupAnswers()});assert.equal(saved.status,200);
  assert.equal((await call(f.engine,token,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,200);
  const completed=(await call(f.engine,token,'GET',route)).body;assert.equal(completed.questionnaireComplete,true);
  assert.equal((await f.send()).status,200);assert.equal(f.provisions,1);assert.equal(f.sentInvitations.length,1);
  const renewal=await f.send({...f.initial,eventId:'renewal-event',contractRef:'renewal-contract',relationship:'renewal',existingWorkspaceId:workspace.workspace_id});
  assert.equal(renewal.status,200,JSON.stringify(renewal.body));assert.equal(f.provisions,1);assert.equal(f.sentInvitations.length,1);
  const after=(await call(f.engine,token,'GET',route)).body;assert.equal(after.runId,completed.runId);assert.equal(after.completedAt,completed.completedAt);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);
  assert.equal(f.db.prepare('SELECT namespace FROM tenant_environments').get().namespace,environment.namespace);
  const conflicting=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'third-contract',recipientEmail:f.owner},f.internal);
  assert.equal(conflicting.status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);
});
test('signing audit interruption rolls back owner, workspace, run and notification reservation',async t=>{
  const f=signingFixture(t);
  f.db.exec("CREATE TRIGGER refuse_signing BEFORE INSERT ON customer_workspace_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.equal((await f.send()).status,500);
  for(const table of ['customer_workspaces','implementation_runs','tenant_environments','organisation_access_setup','implementation_invitations','implementation_notification_outbox'])assert.equal(f.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users WHERE email=?').get(f.owner).n,0);assert.equal(f.sentInvitations.length,0);
  f.db.exec('DROP TRIGGER refuse_signing');assert.equal((await f.send()).status,201);
});
test('replayed signing cannot issue fresh invitation authority after expiry',async t=>{
  const f=signingFixture(t);assert.equal((await f.send()).status,201);
  const before=f.db.prepare('SELECT id,token_hash FROM implementation_invitations').get();
  f.db.exec('UPDATE implementation_invitations SET expires_at_ms=1');
  assert.equal((await f.send()).status,200);
  assert.deepEqual(f.db.prepare('SELECT id,token_hash FROM implementation_invitations').get(),before);
  assert.equal(f.sentInvitations.length,1);assert.equal(f.provisions,1);
});
for(const mutation of ["UPDATE users SET permissions='[]' WHERE email=?",'DELETE FROM users WHERE email=?']) {
  test('canonical owner revocation atomically closes initial authority: '+mutation,async t=>{
    const f=signingFixture(t);assert.equal((await f.send()).status,201);
    f.db.exec("CREATE TRIGGER refuse_revocation_audit BEFORE INSERT ON organisation_access_setup_events WHEN NEW.action='INITIAL_OWNER_ACCESS_REVOKED' BEGIN SELECT RAISE(ABORT,'revocation audit unavailable'); END");
    assert.throws(()=>f.db.prepare(mutation).run(f.owner),/revocation audit unavailable/);
    assert.equal(f.db.prepare('SELECT state FROM organisation_access_initial_authority').get().state,'CONSUMED');
    assert.equal(f.db.prepare('SELECT permissions FROM users WHERE email=?').get(f.owner).permissions,'["company.configure"]');
    f.db.exec('DROP TRIGGER refuse_revocation_audit');f.db.prepare(mutation).run(f.owner);
    assert.equal(f.db.prepare('SELECT state FROM organisation_access_initial_authority').get().state,'REVOKED');
    assert.equal(f.db.prepare('SELECT status FROM implementation_invitations').get().status,'REVOKED');
    assert.equal((await f.send()).status,200);assert.equal(f.provisions,1);assert.equal(f.sentInvitations.length,1);
  });
}
test('permanent workspace rejects legacy scope and activation replay cannot overwrite a reviewed setup',async t=>{
  const f=signingFixture(t);await f.send();
  const before=f.db.prepare('SELECT * FROM tenant_environments').all();
  const replay=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:f.initial.contractRef,recipientEmail:f.owner,scope:{companyName:'Overwrite',employeeCount:1,countries:['UK'],sites:['Other']}},f.internal);
  assert.equal(replay.status,200);assert.deepEqual(f.db.prepare('SELECT * FROM tenant_environments').all(),before);
  const denied=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/scope',{companyName:'Overwrite',employeeCount:1,countries:['UK'],sites:['Other']});
  assert.equal(denied.status,409);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM implementation_scope').get().n,0);
});
async function setupFixture(t) {
  const compiler=require('./test-support/sealed-compiler.cjs')(t);
  const f=fixture({configurationCompiler:compiler});
  const connections=[];
  f.inspectDb=()=>{const db=new DatabaseSync(f.dbPath);connections.push(db);return db;};
  t.after(()=>{for(const db of connections)db.close();f.close();});
  const start=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',
    {tenant:'alpha',contractRef:'setup-contract',recipientEmail:'manager@alpha.test'},f.internal);
  assert.ok([200,201].includes(start.status),JSON.stringify(start.body));
  return f;
}
test('setup routes require manager authority and bind drafts to the session tenant/current run',async t=>{
  const f=await setupFixture(t), route='/api/implementation/autonomous/setup';
  for(const method of ['GET','POST']) {
    assert.equal((await call(f.engine,null,method,route,{})).status,401);
    assert.equal((await call(f.engine,f.tokens.employee,method,route,{})).status,403);
  }
  const saved=await call(f.engine,f.tokens.manager,'POST',route,{expectedRevision:0,answers:setupAnswers()});
  assert.equal(saved.status,200); assert.equal(saved.body.tenant,'alpha');
  assert.equal((await call(f.engine,f.tokens.bravo,'GET',route)).status,409);
  assert.equal((await call(f.engine,f.tokens.bravo,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,409);
});
test('reviewed setup applies metadata through the fenced effect and keeps all 21 readiness controls',async t=>{
  const f=await setupFixture(t), route='/api/implementation/autonomous/setup';
  const saved=await call(f.engine,f.tokens.manager,'POST',route,{expectedRevision:0,answers:setupAnswers()});
  assert.equal(saved.status,200);
  const db=f.inspectDb();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_scope').get().n,0);
  const applied=await call(f.engine,f.tokens.manager,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken});
  assert.equal(applied.status,200,JSON.stringify(applied.body)); assert.equal(applied.body.status,'APPLIED');
  const env=db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get('alpha');
  const config=JSON.parse(env.configuration_json);
  assert.equal(config.companyName,'New Works'); assert.equal(config.workspaceSetup.organisation.sites[0].timezone,'Europe/London');
  assert.equal(config.workspaceSetup.workforce.shiftPatterns,2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_work_receipts').get().n,1);
  const current=f.engine.statusForTenant('alpha'); assert.equal(current.requirements.length,21); assert.equal(current.operationalReady,false);
  assert.equal(current.requirements.find(r=>r.key==='source-systems').satisfied,false);
  assert.equal(current.requirements.find(r=>r.key==='identity-access').satisfied,false);
  assert.equal((await call(f.engine,f.tokens.manager,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,200);
});
for(const table of ['implementation_events','tenant_environment_events','workspace_setup_events']) {
  test('setup application rolls back scope, environment, jobs and draft when '+table+' audit fails',async t=>{
    const f=await setupFixture(t), route='/api/implementation/autonomous/setup';
    const saved=await call(f.engine,f.tokens.manager,'POST',route,{expectedRevision:0,answers:setupAnswers()}); assert.equal(saved.status,200);
    const db=f.inspectDb();
    const before=JSON.stringify(db.prepare('SELECT * FROM implementation_work_jobs').all());
    db.exec('CREATE TRIGGER refuse_setup_apply BEFORE INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'test audit unavailable'); END");
    const result=await call(f.engine,f.tokens.manager,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken});
    assert.equal(result.status,500);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_scope').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM tenant_environments').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_work_receipts').get().n,0);
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM implementation_work_jobs').all()),before);
    assert.equal((await call(f.engine,f.tokens.manager,'GET',route)).body.status,'DRAFT');
    db.exec('DROP TRIGGER refuse_setup_apply');
    assert.equal((await call(f.engine,f.tokens.manager,'POST',route+'/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,200);
  });
}
test('legacy scope write cannot commit when the required scope audit fails',async t=>{
  const f=await setupFixture(t), db=f.inspectDb();
  db.exec("CREATE TRIGGER refuse_scope_audit BEFORE INSERT ON implementation_events WHEN NEW.event='CUSTOMER_SCOPE_SUBMITTED' BEGIN SELECT RAISE(ABORT,'scope audit unavailable'); END");
  const result=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/scope',
    {companyName:'Works',countries:['UK'],sites:['Main'],employeeCount:10});
  assert.equal(result.status,500); assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_scope').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM tenant_environments').get().n,0);
});

function evidenceDetail(kind) {
  if (kind === 'time-policies') {
    return {
      authoritativeConfirmation: true,
      sourceRef: 'test-customer/time-policy-v1',
      effectiveDate: '2026-01-01',
      unresolvedRules: 0, unknownPolicyFields: 0,
      breakRulesVerified: true, overtimeRulesVerified: true,
      workingTimeRulesVerified: true, timeZoneVerified: true
    };
  }
  if (kind === 'absence-policies') {
    return {
      authoritativeConfirmation: true,
      sourceRef: 'test-customer/absence-policy-v1',
      effectiveDate: '2026-01-01',
      unresolvedRules: 0, unknownPolicyFields: 0,
      leaveYearVerified: true, entitlementMethodVerified: true,
      approvalRulesVerified: true, absenceTypesVerified: true,
      usesOpeningBalance: false, openingBalanceFictional: false,
      openingBalanceSourceVerified: false
    };
  }
  if (kind === 'source-systems') return {
    fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
    discoveryCompleted: true, authorizationVerified: true,
    providers: [{ provider: 'Test HCM', discovered: true, authorized: true, connected: true, mode: 'sandbox' }]
  };
  if (kind === 'scheduling') return {
    cloudRuntime: true, sourceAuthoritative: true, rosterSourceVerified: true,
    skillCoverageVerified: true, availabilityVerified: true, ruleEvaluationVerified: true,
    publishedScheduleReadbackVerified: true, unresolvedExceptions: 0
  };
  if (kind === 'approvals') return {
    cloudRuntime: true, sourceAuthoritative: true, delegationRulesVerified: true,
    selfApprovalBlocked: true, auditTrailVerified: true, approvalReadbackVerified: true
  };
  if (kind === 'clocking') return {
    cloudRuntime: true, sourceAuthoritative: true, deviceOrSourceVerified: true,
    duplicateProtectionVerified: true, offlineHandlingVerified: true,
    timezoneDstVerified: true, attendanceReadbackVerified: true
  };
  if (kind === 'payroll-mapping') return {
    readinessClass: 'customer-specific', dataClass: 'customer-authorised',
    mappingAuthorityVerified: true, providerTargetVerified: true,
    employeeIdentityMappingVerified: true, payCodesVerified: true,
    absenceMappingVerified: true, roundingPolicyVerified: true,
    releasedBatchId: 'B-unit-current', batchChecksum: 'c'.repeat(64),
    fullPayrollVerified: true
  };
  if (kind === 'historical-replay') return {
    dataClass: 'customer-authorised', independentCalculation: true,
    expectedTotal: 100, calculatedTotal: 100, unexplainedVariance: 0
  };
  if (kind === 'security-controls') return {
    cloudRuntime: true, tenantIsolationVerified: true, crossTenantNegativeTests: 1, criticalFailures: 0
  };
  if (kind === 'resilience') return {
    hostedRuntime: true, faultInjected: true, detected: true, classified: true,
    repairOrContainmentApplied: true, independentVerificationPassed: true,
    durableAuditVerified: true, replaySafetyVerified: true, rollbackRequired: false,
    criticalFailures: 0
  };
  if (kind === 'scenario-validation') return {
    cloudRuntime: true, testDataClass: 'synthetic-unit-journey', criticalFailures: 0,
    totalScenarios: GOLDEN_JOURNEY_STEPS.length, passedScenarios: GOLDEN_JOURNEY_STEPS.length,
    correlationId: 'unit-golden-journey',
    steps: GOLDEN_JOURNEY_STEPS.map(id => ({ id, status: 'PASS', evidenceRef: 'unit:' + id, correlationId: 'unit-golden-journey' })),
    payrollProvider:{correlationId:'unit-golden-journey',batchId:'B-unit',batchChecksum:'a'.repeat(64),providerBindingDigest:'b'.repeat(64),batchReceiptDigest:'c'.repeat(64),readbackDigest:'d'.repeat(64),releaseEvidenceRef:'unit:payroll-batch-released',acceptanceEvidenceRef:'unit:payroll-provider-accepted',readbackEvidenceRef:'unit:payroll-provider-readback',fullPayrollVerified:true}
  };
  if (kind === 'test-data-cleanup') return { remainingTestRows: 0, liveRowsTouched: 0 };
  if (kind === 'live-data-import') return {
    fixtureOnly: false, zeroHuman: true, humanInterventions: 0, sourceAuthoritative: true,
    sourceCount: 10000, importedCount: 10000, invalidCount: 0, checksumMatch: true
  };
  return { checked: true };
}

async function createInvitation(f, tenant = 'alpha', contractRef = 'contract-001', targetHours = 8) {
  const recipientEmail = tenant === 'bravo' ? 'manager@bravo' : 'manager@alpha';
  const before = f.sentInvitations.length;
  const result = await call(
    f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
    { tenant, contractRef, targetHours, recipientEmail }, f.internal
  );
  assert.ok([200, 201].includes(result.status));
  if (result.status === 201) assert.equal(f.sentInvitations.length, before + 1);
  const sent = f.sentInvitations[f.sentInvitations.length - 1];
  const token = sent ? new URL(sent.startUrl).searchParams.get('implementation_invite') : null;
  return { result, token };
}

function scopeFixture(tenant = 'alpha') {
  return {
    companyName: tenant === 'bravo' ? 'Bravo Manufacturing' : 'Alpha Manufacturing',
    countries: ['United Kingdom'],
    sites: ['Plant 1'],
    employeeCount: 10000,
    sourceSystems: ['ERP', 'HCM'],
    features: ['Scheduling', 'Time & attendance', 'Absence'],
    workPatterns: ['24/7 rotating shifts'],
    clockingMethods: ['Existing access control', 'Mobile fallback'],
    payrollSystem: '',
    hcmSystem: 'HCM provider',
    erpSystem: 'ERP provider',
    agencyLabour: true,
    priorities: 'Accurate payroll, safe automation and simple manager workflows'
  };
}

async function startRun(f, tenant = 'alpha', contractRef = 'contract-001', targetHours = 8) {
  const invitation = await createInvitation(f, tenant, contractRef, targetHours);
  assert.ok(invitation.token);
  const token = tenant === 'bravo' ? f.tokens.bravo : f.tokens.manager;
  const started = await call(
    f.engine, token, 'POST', '/api/implementation/autonomous/start',
    { token: invitation.token }
  );
  assert.ok([200, 201].includes(started.status));
  const scoped = await call(
    f.engine, token, 'POST', '/api/implementation/autonomous/scope',
    scopeFixture(tenant)
  );
  assert.ok([200, 201].includes(scoped.status));
  assert.equal(scoped.body.scopeCaptured, true);
  return scoped.body;
}

async function passAllEvidence(f, runId, verifierSuffix = '') {
  let last;
  const db = new DatabaseSync(f.dbPath);
  const run = db.prepare('SELECT tenant FROM implementation_runs WHERE id=?').get(runId);
  db.close();
  const managerToken = run.tenant === 'bravo' ? f.tokens.bravo : f.tokens.manager;
  for (const item of REQUIREMENTS) {
    if (item.key === 'time-policies' || item.key === 'absence-policies') continue;
    let detail = evidenceDetail(item.key);
    let source = 'deterministic-test';
    if (item.key === 'tenant-environment') {
      source = 'hosted-proof';
      detail = {
        fixtureOnly: false, zeroHuman: true, humanInterventions: 0,
        provisioned: true, tenantExists: true, environmentId: 'test-cloud-environment',
        provisioningMode: 'cloud-runtime', runtimeHealthPassed: true, healthcheckPassed: true,
        tenantIsolationVerified: true, crossTenantNegativeTests: 1, durableStateVerified: true,
        exactCandidateSha: f.candidateSha, exactTargetDeploymentId: f.deploymentId,
        tenant: run.tenant, implementationRunId: runId, verifierRunId: 'unit-' + runId + verifierSuffix,
        proofRunnerIdentity: 'unit-test-runner',
        targetDeploymentCreatedAt: new Date(Date.now() - 60000).toISOString(),
        evidenceGeneratedAt: new Date().toISOString()
      };
    }
    last = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      { runId, kind: item.key, status: 'PASS', confidence: 1, source, detail },
      f.internal
    );
    assert.equal(last.status, 200, item.key + ': ' + JSON.stringify(last.body));
  }
  const current = await call(f.engine, managerToken, 'GET', '/api/implementation/autonomous/status');
  if(current.body?.scopeCaptured!==true) return current.body;
  for (const [kind,key] of [['time-policies','time-policy-authority'],['absence-policies','absence-policy-authority']]) {
    last = await call(
      f.engine, managerToken, 'POST', '/api/implementation/autonomous/decision',
      { runId, key, action: 'ACCEPTED', detail: evidenceDetail(kind) }
    );
    assert.equal(last.status, 200, kind + ': ' + JSON.stringify(last.body));
  }
  return last.body;
}

test('hosted readiness reopens persisted evidence from a different candidate deployment or invalid policy authority', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-current' });
  try {
    const run = await startRun(f);
    const db = new DatabaseSync(f.dbPath);
    for (const [kind, detail] of [
      ['identity-access', { exactCandidateSha: 'b'.repeat(40), exactTargetDeploymentId: 'deployment-old' }],
      ['security-controls', { exactCandidateSha: candidateSha, exactTargetDeploymentId: 'deployment-old' }],
      ['tenant-environment', { environmentId: 'another-service' }],
      ['time-policies', { exactCandidateSha: candidateSha, exactTargetDeploymentId: 'deployment-current' }]
    ]) {
      db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(run.runId, 'alpha', kind, 'PASS', 1, 'hosted-proof', JSON.stringify(detail), new Date().toISOString());
    }
    db.close();
    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const requirements = new Map(status.body.requirements.map(item => [item.key,item]));
    for(const kind of ['identity-access','security-controls','tenant-environment']) {
      assert.equal(requirements.get(kind).satisfied, false, kind + ' must reopen');
      assert.equal(requirements.get(kind).status, 'REVALIDATION_REQUIRED');
      assert.ok(requirements.get(kind).evidenceBinding.reason);
    }
    assert.equal(requirements.get('time-policies').satisfied, false);
    assert.equal(requirements.get('time-policies').status, 'REVALIDATION_REQUIRED');
    assert.match(requirements.get('time-policies').evidenceValidation.reason, /policy evidence|authoritative policy|customer-authorised|provider-authorised|contract-authorised/i);
    const preserved = new DatabaseSync(f.dbPath);
    assert.equal(preserved.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE source=?').get('hosted-proof').n, 4);
    preserved.close();
  } finally { f.close(); }
});

test('deployment change reopens previously satisfied work without deleting evidence', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-first' });
  let restarted;
  try {
    const run = await startRun(f);
    const accepted = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
      {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',
        detail:{exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-first'}},f.internal);
    assert.equal(accepted.status,200);
    const before = new DatabaseSync(f.dbPath);
    assert.equal(before.prepare('SELECT status FROM implementation_work_jobs WHERE run_id=? AND requirement_key=?').get(run.runId,'identity-access').status,'SATISFIED');
    before.close();
    f.engine.close();
    restarted=createOneDayEnterpriseEngine({dbPath:f.dbPath,requireCandidateBinding:true,candidateSha,deploymentId:'deployment-next',notificationRetryPollMs:0});
    const status=await call(restarted,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(item=>item.key==='identity-access').satisfied,false);
    const after = new DatabaseSync(f.dbPath);
    assert.notEqual(after.prepare('SELECT status FROM implementation_work_jobs WHERE run_id=? AND requirement_key=?').get(run.runId,'identity-access').status,'SATISFIED');
    assert.equal(after.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE kind=?').get('identity-access').n,1);
    after.close();
  } finally { restarted?.close(); f.close(); }
});

test('hosted evidence admission refuses another candidate without recording a PASS', async () => {
  const candidateSha = 'a'.repeat(40);
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId: 'deployment-current' });
  try {
    const run = await startRun(f);
    for(const detail of [{}, {exactCandidateSha:'b'.repeat(40),exactTargetDeploymentId:'deployment-current'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-other'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',tenant:'bravo'},
      {exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',runId:'another-run'}]) {
      const denied = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
        {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',detail},f.internal);
      assert.equal(denied.status,409);
      assert.equal(denied.body.readinessEvidenceAccepted,false);
    }
    const accepted = await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',
      {runId:run.runId,kind:'identity-access',status:'PASS',confidence:1,source:'hosted-proof',
        detail:{exactCandidateSha:candidateSha,exactTargetDeploymentId:'deployment-current',tenant:'alpha',runId:run.runId}},f.internal);
    assert.equal(accepted.status,200);
    assert.equal(accepted.body.requirements.find(item=>item.key==='identity-access').satisfied,true);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE kind=?').get('identity-access').n,1);
    db.close();
  } finally { f.close(); }
});

function verifiedFixtureEvent({rawBody}) {
  // Explicit test authority adapter for legacy notification regressions only.
  const input=JSON.parse(rawBody.toString('utf8'));
  if(input.event==='draft')return null;
  if(!['external-contract-001','external-auto-mail-retry','external-ambiguous-mail','external-mail-retry'].includes(input.contractId))throw Error('Unknown fixture contract');
  return {verified:true,ownerAuthorized:true,customerId:'fixture-alpha',customerAuthorityRef:'fixture-customer-authority',
    tenant:'alpha',provider:'fixture-provider',eventId:input.contractId+'-signed',contractRef:input.contractId,
    relationship:'initial',ownerEmail:'manager@alpha',ownerAuthorityRef:'fixture-owner-authority',profile:{organisationName:'Alpha'}};
}

function registeredOrder(overrides={}) {return {orderId:'vector-order-alpha',expectedRevision:0,orderAuthorized:true,ownerAuthorized:true,
  orderAuthorityRef:'vector-register/order-alpha',customerId:'registered-alpha',customerAuthorityRef:'vector-register/customer-alpha',tenant:'alpha',provider:'docusign',
  envelopeId:'registered-envelope-1',contractRef:'registered-contract-1',relationship:'initial',nominatedSuperUserEmail:'manager@alpha',nominationAuthorityRef:'customer-nomination/alpha-1',profile:{organisationName:'Alpha Factory'},...overrides};}
function verifiedOrderCompletion(overrides={}) {return {verified:true,provider:'DocuSign',status:'completed',eventId:'registered-completion-1',envelopeId:'registered-envelope-1',
  signerEmail:'signer@different.company',tenant:'bravo',ownerEmail:'manager@bravo',...overrides};}
test('stored order HTTP completion uses its nominee and permanent workspace through setup, duplicate and renewal',async t=>{
  let event=verifiedOrderCompletion();const f=fixture({configurationCompiler:require('./test-support/sealed-compiler.cjs')(t),verifySignedContract:()=>event});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  assert.equal(typeof f.engine.recordCustomerOrder,'function','The existing engine must expose its trusted register adapter');
  f.engine.recordCustomerOrder(registeredOrder());
  const send=()=>call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{tenant:'bravo',ownerEmail:'attacker@bravo',signerEmail:'not-nominee'},f.contractWebhook);
  const initial=await send();assert.equal(initial.status,201,JSON.stringify(initial.body));assert.equal(initial.body.notification.delivered,true);assert.equal(f.sentInvitations.length,1);assert.equal(f.sentInvitations[0].to,'manager@alpha');
  const workspace=db.prepare('SELECT * FROM customer_workspaces').get();const invitation=db.prepare('SELECT * FROM implementation_invitations').get();
  const receipt=db.prepare('SELECT * FROM customer_workspace_invitation_bindings WHERE invitation_id=?').get(invitation.id);
  assert.equal(receipt.workspace_id,workspace.workspace_id);assert.equal(receipt.order_revision,1);assert.equal(receipt.nomination_revision,1);
  const token=new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
  assert.equal((await call(f.engine,f.tokens.bravo,'POST','/api/implementation/autonomous/start',{token})).status,404);
  const started=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/start',{token});assert.equal(started.status,201);
  const saved=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/setup',{expectedRevision:0,answers:setupAnswers()});
  assert.equal((await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/setup/apply',{expectedRevision:1,reviewToken:saved.body.reviewToken})).status,200);
  const tables=['users','implementation_runs','tenant_environments','workspace_setup_drafts','workspace_setup_events','implementation_scope','organisation_access_setup'];
  const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all());const before=snapshot();
  event=verifiedOrderCompletion({eventId:'duplicate-completion'});const replay=await send();assert.equal(replay.status,200);assert.equal(replay.body.workspace.workspaceId,workspace.workspace_id);assert.equal(replay.body.questionnaireReset,false);
  f.engine.recordCustomerOrder(registeredOrder({orderId:'vector-renewal',envelopeId:'registered-renewal',contractRef:'registered-renewal-contract',relationship:'renewal',existingWorkspaceId:workspace.workspace_id}));
  event=verifiedOrderCompletion({eventId:'renewal-completion',envelopeId:'registered-renewal'});const renewal=await send();assert.equal(renewal.status,200,JSON.stringify(renewal.body));assert.equal(renewal.body.workspace.workspaceId,workspace.workspace_id);assert.equal(renewal.body.questionnaireReset,false);
  assert.deepEqual(snapshot(),before);assert.equal(f.sentInvitations.length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);
});
for(const change of ['nomination','revocation'])test('stored order '+change+' while verifier awaits rejects old completion before owner or workspace effects',async t=>{
  let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  const f=fixture({verifySignedContract:async()=>{entered();await gate;return verifiedOrderCompletion();}});const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  assert.equal(typeof f.engine.recordCustomerOrder,'function');f.engine.recordCustomerOrder(registeredOrder());
  const pending=call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);await started;
  if(change==='nomination')f.engine.recordCustomerOrder(registeredOrder({expectedRevision:1,envelopeId:'registered-envelope-2',contractRef:'registered-contract-2',nominatedSuperUserEmail:'new-nominee@alpha',nominationAuthorityRef:'customer-nomination/alpha-2'}));
  else f.engine.revokeCustomerNomination({orderId:'vector-order-alpha',expectedRevision:1,reasonRef:'customer-authority-revoked'});
  release();const result=await pending;assert.equal(result.status,change==='nomination'?409:403,JSON.stringify(result.body));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_workspaces').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,0);assert.equal(f.sentInvitations.length,0);
});
test('stored order nomination change during invitation claim cancels old link and cannot restart questionnaire',async t=>{
  const f=fixture({configurationCompiler:require('./test-support/sealed-compiler.cjs')(t),verifySignedContract:()=>verifiedOrderCompletion()});const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  assert.equal(typeof f.engine.recordCustomerOrder,'function');f.engine.recordCustomerOrder(registeredOrder());
  const first=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);assert.equal(first.status,201);
  const token=new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
  const request=Readable.from((async function*(){f.engine.recordCustomerOrder(registeredOrder({expectedRevision:1,envelopeId:'changed-envelope',contractRef:'changed-contract',nominatedSuperUserEmail:'new-nominee@alpha',nominationAuthorityRef:'customer-nomination/2'}));yield JSON.stringify({token});})());
  request.method='POST';request.url='/api/implementation/autonomous/start';request.headers={cookie:'wfm_session='+f.tokens.manager};const responseValue=response();await f.engine.handleRequest(request,responseValue);
  assert.equal(responseValue.statusCode,404);assert.equal(db.prepare('SELECT status FROM implementation_invitations').get().status,'REVOKED');assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM workspace_setup_drafts').get().n,0);
});
test('stored order invitation stays bound through a same-nominee revision and fails atomically if its receipt cannot persist',async t=>{
  let event=verifiedOrderCompletion();const f=fixture({verifySignedContract:()=>event});const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  f.engine.recordCustomerOrder(registeredOrder());
  db.exec("CREATE TRIGGER fail_order_receipt BEFORE INSERT ON customer_workspace_invitation_bindings BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
  const send=()=>call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook);
  assert.equal((await send()).status,500);assert.equal(f.sentInvitations.length,0);
  for(const table of ['customer_workspaces','implementation_runs','organisation_access_setup','implementation_invitations','implementation_notification_outbox'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0,table);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_workspace_orders').get().n,1,'Trusted register revision remains stored');
  db.exec('DROP TRIGGER fail_order_receipt');assert.equal((await send()).status,201);
  const token=new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite'),workspace=db.prepare('SELECT * FROM customer_workspaces').get();
  f.engine.recordCustomerOrder(registeredOrder({expectedRevision:1,envelopeId:'same-nominee-renewal',contractRef:'renewal',relationship:'renewal',existingWorkspaceId:workspace.workspace_id}));
  event=verifiedOrderCompletion({envelopeId:'same-nominee-renewal',eventId:'same-nominee-renewal'});assert.equal((await send()).status,200);
  assert.equal((await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/start',{token})).status,201);
  assert.equal(f.sentInvitations.length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM customer_workspace_invitation_bindings').get().n,1);
});
test('stored order explicitly adopts a verified legacy tuple without mail authority and revocation cannot reuse its existing owner',async t=>{
  const f=fixture({configurationCompiler:require('./test-support/sealed-compiler.cjs')(t),failInvitationAttempts:2,notificationRetryDelayMs:0,verifySignedContract:()=>verifiedOrderCompletion()});
  const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  const first=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',{tenant:'alpha',contractRef:'legacy-contract',recipientEmail:'manager@alpha',scope:scopeFixture()},f.internal);assert.equal(first.status,201);
  const environment=db.prepare('SELECT * FROM tenant_environments WHERE tenant=?').get('alpha');
  f.engine.recordCustomerOrder(registeredOrder({operation:'adopt-existing',profile:undefined,contractRef:'legacy-contract',existingRunId:environment.run_id,existingEnvironmentId:environment.environment_id,existingNamespace:environment.namespace}));
  const tables=['users','implementation_runs','implementation_scope','tenant_environments','implementation_invitations','implementation_notification_outbox','implementation_events'];const snapshot=()=>tables.map(table=>db.prepare('SELECT * FROM '+table).all()),before=snapshot();
  const adopted=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{existingNamespace:'forged'},f.contractWebhook);assert.equal(adopted.status,200,JSON.stringify(adopted.body));assert.equal(adopted.body.workspace.adopted,true);assert.deepEqual(snapshot(),before);assert.equal(f.invitationAttempts,2);
  assert.equal((await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/setup')).status,200);
  f.engine.revokeCustomerNomination({orderId:'vector-order-alpha',expectedRevision:1,reasonRef:'legacy-owner-authority-withdrawn'});
  assert.equal((await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/setup')).status,403,'A historical owner session cannot outlive its stored nomination authority');
  assert.equal((await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook)).status,403);assert.equal(db.prepare('SELECT status FROM implementation_invitations').get().status,'REVOKED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);assert.equal(f.invitationAttempts,2);
});
for(const change of ['role','permission','session','revocation'])test('stored order invitation rechecks '+change+' after the awaited claim body',async t=>{
  const f=fixture({verifySignedContract:()=>verifiedOrderCompletion()});const db=new DatabaseSync(f.dbPath);t.after(()=>{db.close();f.close();});
  f.engine.recordCustomerOrder(registeredOrder());assert.equal((await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',{},f.contractWebhook)).status,201);
  const token=new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
  const req=Readable.from((async function*(){
    if(change==='role')db.prepare('UPDATE users SET role=? WHERE email=?').run('employee','manager@alpha');
    else if(change==='permission')db.prepare('UPDATE users SET permissions=? WHERE email=?').run('[]','manager@alpha');
    else if(change==='session')db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(f.tokens.manager));
    else f.engine.revokeCustomerNomination({orderId:'vector-order-alpha',expectedRevision:1,reasonRef:'revoked-during-body'});
    yield JSON.stringify({token});
  })());req.method='POST';req.url='/api/implementation/autonomous/start';req.headers={cookie:'wfm_session='+f.tokens.manager};const res=response();await f.engine.handleRequest(req,res);
  assert.equal(res.statusCode,change==='session'?401:403,res.body);assert.equal(db.prepare('SELECT status FROM implementation_invitations').get().status,change==='session'?'PENDING':'REVOKED');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM implementation_runs').get().n,1);assert.equal(db.prepare('SELECT started_run_id FROM implementation_invitations').get().started_run_id,null);
});

test('verified signed contract starts implementation immediately and sends one invitation', async () => {
  const f = fixture({verifySignedContract:verifiedFixtureEvent});
  try {
    const denied = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha'
      }
    );
    assert.equal(denied.status, 403);
    assert.equal(f.sentInvitations.length, 0);

    const ignored = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'draft',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha'
      },
      f.contractWebhook
    );
    assert.equal(ignored.status, 202);
    assert.equal(ignored.body.ignored, true);
    assert.equal(f.sentInvitations.length, 0);

    const signed = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed',
        tenant: 'alpha',
        contractId: 'external-contract-001',
        implementationContactEmail: 'manager@alpha',
        targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(signed.status, 201);
    assert.equal(signed.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(signed.body.implementation.state, 'BUILDING');
    assert.equal(signed.body.implementation.operationalReady, false);
    assert.equal(signed.body.notification.delivered, true);
    assert.equal(f.sentInvitations.length, 1);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('trusted activation auto-starts a legacy pending invitation without reporting a missing run', async () => {
  const f = fixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    const now = '2026-09-26T19:00:00.000Z';
    db.prepare(
      'INSERT INTO implementation_invitations(id,tenant,contract_ref_hash,recipient_hash,token_hash,status,target_hours,expires_at_ms,started_run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).run(
      'legacy-invitation',
      'alpha',
      sha256('legacy-contract'),
      sha256('manager@alpha'),
      sha256('legacy-token'),
      'PENDING',
      8,
      Date.now() + 60_000,
      null,
      now,
      now
    );
    db.close();

    const activated = await call(
      f.engine,
      null,
      'POST',
      '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'legacy-contract', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );

    assert.equal(activated.status, 200);
    assert.equal(activated.body.invitation.invitationId, 'legacy-invitation');
    assert.equal(activated.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(activated.body.implementation.state, 'BUILDING');
    assert.ok(activated.body.implementation.runId);
    assert.equal(f.sentInvitations.length, 0);

    const check = new DatabaseSync(f.dbPath);
    assert.equal(check.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(check.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_AUTO_STARTED'").get().count, 1);
    check.close();
  } finally {
    f.close();
  }
});

function importGuidanceFixture(tenant, role) {
  const settings = { WFM_IMPORT_GUIDANCE_PILOT_TENANT: tenant, WFM_IMPORT_GUIDANCE_PILOT_ROLE: role };
  const previous = {};
  try {
    for (const [key, value] of Object.entries(settings)) {
      previous[key] = process.env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fixture();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('held import guidance follows the authenticated tenant and current setup role', async t => {
  const f = importGuidanceFixture('alpha', 'manager');
  t.after(() => f.close());
  const route = '/api/implementation/autonomous';
  const alpha = await startRun(f, 'alpha');
  const bravo = await startRun(f, 'bravo');
  assert.equal(alpha.showHeldImportGuidance, true);
  assert.equal(bravo.showHeldImportGuidance, undefined);
  assert.equal(f.engine.statusForTenant('alpha').showHeldImportGuidance, undefined);

  const status = token => call(f.engine, token, 'GET', route + '/status');
  assert.equal((await status(f.tokens.manager)).body.showHeldImportGuidance, true);
  assert.equal((await status(f.tokens.bravo)).body.showHeldImportGuidance, undefined);
  assert.equal((await status(f.tokens.employee)).status, 403);

  const decision = await call(f.engine, f.tokens.manager, 'POST', route + '/decision', {
    runId: alpha.runId, key: 'time-policy-authority', action: 'REJECTED'
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.showHeldImportGuidance, true);

  const db = new DatabaseSync(f.dbPath);
  t.after(() => db.close());
  db.prepare('UPDATE users SET role=? WHERE email=?').run('admin', 'manager@alpha');
  const otherRole = await status(f.tokens.manager);
  assert.equal(otherRole.status, 200);
  assert.equal(otherRole.body.showHeldImportGuidance, undefined);
});

for (const [tenant, role] of [[undefined, undefined], ['alpha', undefined], [undefined, 'manager']]) {
  test('held import guidance stays off with tenant=' + tenant + ' and role=' + role, async t => {
    const f = importGuidanceFixture(tenant, role);
    t.after(() => f.close());
    assert.equal((await startRun(f)).showHeldImportGuidance, undefined);
  });
}

test('employee cannot inspect enterprise implementation control plane', async () => {
  const f = fixture();
  try {
    const result = await call(
      f.engine, f.tokens.employee, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(result.status, 403);
  } finally {
    f.close();
  }
});

test('eight-hour target is assessed by parallel critical path, not serial task sum', async () => {
  const f = fixture();
  try {
    const eightHour = await startRun(f, 'alpha', 'critical-path-8h', 8);
    assert.equal(eightHour.state, 'BUILDING');
    assert.ok(eightHour.parallelWorkMinutes > eightHour.criticalPathRemainingMinutes);
    assert.ok(eightHour.criticalPathRemainingMinutes <= 480);

    const fourHour = await startRun(f, 'bravo', 'critical-path-4h', 4);
    assert.equal(fourHour.state, 'AT_RISK');
    assert.ok(fourHour.criticalPathRemainingMinutes > 240);
  } finally {
    f.close();
  }
});


test('notification transport failure cannot block trusted zero-touch implementation start', async () => {
  const f = fixture({ failInvitationDelivery: true });
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-mail-failure', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(activated.status, 201);
    assert.equal(activated.body.notification.delivered, false);
    assert.equal(activated.body.invitation, null);
    assert.equal(activated.body.implementation.state, 'BUILDING');
    assert.ok(activated.body.implementation.runId);

    const status = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(status.status, 200);
    assert.equal(status.body.runId, activated.body.implementation.runId);
    assert.equal(status.body.state, 'BUILDING');

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 2);
    db.close();
  } finally {
    f.close();
  }
});

test('legacy activation replay is blocked while the authorised recovery worker retries the same invitation', async () => {
  const f = fixture({ failInvitationAttempts: 2, notificationRetryDelayMs:0 });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-retry', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.delivered, false);
    assert.equal(first.body.invitation, null);
    const repeated = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(repeated.status, 409);
    assert.equal(repeated.body.code, 'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
    assert.equal(f.invitationAttempts, 2);
    const recovery=await f.engine.retryDueNotifications({nowMs:Date.now()+60_000});
    assert.equal(recovery.delivered,1);
    assert.equal(f.sentInvitations.length, 1);
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_AUTO_STARTED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('one trusted contract event automatically recovers a transient invitation failure', async () => {
  const f = fixture({ failFirstInvitation: true,verifySignedContract:verifiedFixtureEvent });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed', tenant: 'alpha', contractId: 'external-auto-mail-retry',
        implementationContactEmail: 'manager@alpha', targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.notification.delivered, true);
    assert.equal(result.body.invitation.state, 'AWAITING_CUSTOMER_START');
    assert.equal(f.invitationAttempts, 2);
    assert.equal(f.sentInvitations.length, 1);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('automatic retry preserves an ambiguously accepted invitation and delivery identity', async () => {
  const f = fixture({ acceptThenFailFirstInvitation: true,verifySignedContract:verifiedFixtureEvent });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed',
      {
        event: 'contract_signed', tenant: 'alpha', contractId: 'external-ambiguous-mail',
        implementationContactEmail: 'manager@alpha', targetHours: 8
      },
      f.contractWebhook
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.notification.delivered, true);
    assert.equal(f.invitationAttempts, 2);
    assert.equal(f.sentInvitations.length, 2);
    assert.equal(f.sentInvitations[1].invitationId, f.sentInvitations[0].invitationId);
    assert.equal(f.sentInvitations[1].startUrl, f.sentInvitations[0].startUrl);
    assert.equal(f.sentInvitations[1].idempotencyKey, f.sentInvitations[0].idempotencyKey);
    assert.ok(f.sentInvitations[0].idempotencyKey);

    const firstToken = new URL(f.sentInvitations[0].startUrl).searchParams.get('implementation_invite');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: firstToken }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.runId, result.body.implementation.runId);
  } finally {
    f.close();
  }
});

test('signed contract webhook replay uses the same bounded notification recovery', async () => {
  const f = fixture({ failInvitationAttempts: 2,verifySignedContract:verifiedFixtureEvent });
  try {
    const event = {
      event: 'contract_signed', tenant: 'alpha', contractId: 'external-mail-retry',
      implementationContactEmail: 'manager@alpha', targetHours: 8
    };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed', event, f.contractWebhook);
    const pending=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-signed',event,f.contractWebhook);
    assert.equal(pending.body.notification.delivered,false,'Replay must respect the existing retry delay');
    const dueDb=new DatabaseSync(f.dbPath);dueDb.exec('UPDATE implementation_notification_outbox SET next_attempt_at_ms=0');dueDb.close();
    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-signed', event, f.contractWebhook);
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.delivered, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.notification.delivered, true,JSON.stringify({notification:replay.body.notification,attempts:f.invitationAttempts}));
    assert.equal(replay.body.implementation.runId, first.body.implementation.runId);
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('failed invitation retries stop at a durable three-attempt budget', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs:0 });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-budget', targetHours: 8, recipientEmail: 'manager@alpha' };
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal));
    }
    assert.deepEqual(results.map(result => result.status), [201, 409, 409, 409]);
    assert.ok(results.slice(1).every(result=>result.body.code==='LEGACY_WORKSPACE_ASSOCIATION_REQUIRED'));
    assert.equal(f.invitationAttempts,2);
    const recovery=await f.engine.retryDueNotifications({nowMs:Date.now()+60_000});
    assert.equal(recovery.exhausted,1);
    await f.engine.retryDueNotifications({nowMs:Date.now()+120_000});
    assert.equal(f.invitationAttempts, 3);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_FAILED'").get().count, 3);
    db.close();
  } finally {
    f.close();
  }
});

test('simultaneous delayed retry and trusted replay cannot duplicate delivery or falsely exhaust recovery', async () => {
  let attempts = 0;
  let releaseFinalAttempt;
  let finalAttemptStarted;
  const finalStarted = new Promise(resolve => { finalAttemptStarted = resolve; });
  const finalRelease = new Promise(resolve => { releaseFinalAttempt = resolve; });
  const deliveries = [];
  let sweep;
  const f = fixture({
    notificationRetryDelayMs: 0,
    sendInvitation: async invitation => {
      attempts += 1;
      if (attempts <= 2) throw new Error('simulated provider outage');
      finalAttemptStarted();
      await finalRelease;
      deliveries.push(invitation);
      return { provider: 'test-mailer', messageId: 'mail-race-winner' };
    }
  });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-race', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);

    sweep = f.engine.retryDueNotifications({ nowMs: Date.now() + 60_000 });
    await finalStarted;
    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(replay.status,409);
    assert.equal(replay.body.code,'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
    const during=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.notEqual(during.body.notificationRecovery.state,'EXHAUSTED');

    releaseFinalAttempt();
    const recovery = await sweep;
    assert.equal(recovery.delivered, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(attempts, 3);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_SENT'").get().count, 1);
    db.close();
  } finally {
    releaseFinalAttempt?.();
    await sweep?.catch(() => {});
    f.close();
  }
});

test('implementation status explains pending and exhausted invitation recovery without exposing secrets', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs:0 });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-health', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);

    const recovering = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(recovering.status, 200);
    assert.equal(recovering.body.notificationRecovery.state, 'RECOVERING');
    assert.equal(recovering.body.notificationRecovery.attempts, 2);
    assert.equal(recovering.body.notificationRecovery.remainingAttempts, 1);
    assert.ok(recovering.body.notificationRecovery.nextRetryAt);
    assert.equal('recipientEmail' in recovering.body.notificationRecovery, false);
    assert.equal('startUrl' in recovering.body.notificationRecovery, false);
    assert.equal('contractRef' in recovering.body.notificationRecovery, false);

    const final = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(final.status,409);assert.equal(final.body.code,'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
    assert.equal((await f.engine.retryDueNotifications({nowMs:Date.now()+60_000})).exhausted,1);
    const exhausted = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(exhausted.body.notificationRecovery.state, 'EXHAUSTED');
    assert.equal(exhausted.body.notificationRecovery.attempts, 3);
    assert.equal(exhausted.body.notificationRecovery.remainingAttempts, 0);
    assert.equal(exhausted.body.notificationRecovery.automaticActionAvailable, false);
    assert.equal(exhausted.body.notificationRecovery.terminalAction, 'PROVIDER_OR_ADMIN_AUTHORIZATION_REQUIRED');
  } finally {
    f.close();
  }
});

test('failed invitation is retried automatically after a safe engine restart', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs: 0 });
  let restarted;
  let originalClosed = false;
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-restart', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.delivered, false);
    f.engine.close();
    originalClosed = true;
    const delivered = [];
    restarted = createOneDayEnterpriseEngine({
      dbPath: f.dbPath,
      internalToken: 'implementation-worker-test-token',
      contractWebhookSecret: 'contract-webhook-test-token',
      invitationRecoverySecret: 'dedicated-invitation-recovery-test-secret',
      publicOrigin: 'https://implementation.test',
      notificationRetryDelayMs: 0,
      notificationRetryPollMs: 5,
      sendInvitation: async invitation => {
        delivered.push(invitation);
        return { provider: 'test-mailer', messageId: 'mail-after-restart' };
      }
    });
    await waitFor(() => delivered.length === 1);
    assert.equal(delivered.length, 1);
    const recoveredToken = new URL(delivered[0].startUrl).searchParams.get('implementation_invite');
    const started = await call(
      restarted, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: recoveredToken }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.runId, first.body.implementation.runId);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 3);
    db.close();
  } finally {
    restarted?.close();
    if (!originalClosed) f.engine.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('tampered delayed-retry evidence fails closed without sending', async () => {
  const f = fixture({ failInvitationDelivery: true, notificationRetryDelayMs: 0 });
  let restarted;
  let originalClosed = false;
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-mail-tamper', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.body.notification.pendingRetry, true);
    f.engine.close();
    originalClosed = true;

    const tamper = new DatabaseSync(f.dbPath);
    tamper.prepare('UPDATE implementation_notification_outbox SET recipient_ciphertext=?').run('tampered');
    tamper.close();

    const delivered = [];
    restarted = createOneDayEnterpriseEngine({
      dbPath: f.dbPath,
      internalToken: 'implementation-worker-test-token',
      contractWebhookSecret: 'contract-webhook-test-token',
      invitationRecoverySecret: 'dedicated-invitation-recovery-test-secret',
      publicOrigin: 'https://implementation.test',
      notificationRetryPollMs: 0,
      sendInvitation: async invitation => {
        delivered.push(invitation);
        return { provider: 'test-mailer', messageId: 'must-not-send' };
      }
    });
    const recovery = await restarted.retryDueNotifications({ nowMs: Date.now() + 60_000 });
    assert.equal(recovery.blocked, 1);
    assert.equal(recovery.delivered, 0);
    assert.equal(delivered.length, 0);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'BLOCKED');
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 2);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_RECOVERY_BLOCKED'").get().count, 1);
    db.close();
  } finally {
    restarted?.close();
    if (!originalClosed) f.engine.close();
    fs.rmSync(f.dir, { recursive: true, force: true });
  }
});

test('missing public origin does not block trusted implementation start or create a token', async () => {
  const f = fixture({ publicOrigin: '' });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-no-origin', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.implementation.state, 'BUILDING');
    assert.equal(result.body.notification.unavailable, true);
    assert.equal(result.body.invitation, null);
    assert.equal(f.invitationAttempts, 0);
    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_invitations').get().count, 0);
    db.close();
  } finally {
    f.close();
  }
});

test('missing message provider configuration fails immediately without wasting retries or storing an invitation', async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  const f = fixture({ useDefaultInvitationSender: true });
  try {
    const result = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-no-provider', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(result.status, 201);
    assert.equal(result.body.implementation.state, 'BUILDING');
    assert.equal(result.body.notification.unavailable, true);
    assert.equal(result.body.notification.reason, 'MESSAGE_PROVIDER_NOT_CONFIGURED');
    assert.equal(result.body.invitation, null);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'UNAVAILABLE');
    assert.equal(status.body.notificationRecovery.terminalAction, 'MESSAGE_PROVIDER_CONFIGURATION_REQUIRED');

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_invitations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_attempts').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_UNAVAILABLE'").get().count, 1);
    db.close();
  } finally {
    f.close();
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousFrom === undefined) delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
    else process.env.WFM_IMPLEMENTATION_FROM_EMAIL = previousFrom;
  }
});

test('provider credential rejection stops after one attempt and requests authorised repair', async () => {
  const f = fixture({ rejectInvitationCredentials: true });
  try {
    const event = { tenant: 'alpha', contractRef: 'contract-provider-auth', targetHours: 8, recipientEmail: 'manager@alpha' };
    const first = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(first.status, 201);
    assert.equal(first.body.implementation.state, 'BUILDING');
    assert.equal(first.body.notification.delivered, false);
    assert.equal(first.body.notification.blocked, true);
    assert.equal(first.body.notification.reason, 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED');
    assert.equal(f.invitationAttempts, 1);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'BLOCKED');
    assert.equal(status.body.notificationRecovery.attempts, 1);
    assert.equal(status.body.notificationRecovery.automaticActionAvailable, false);
    assert.equal(status.body.notificationRecovery.terminalAction, 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED');

    const repeated = await call(f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal);
    assert.equal(repeated.status,409);assert.equal(repeated.body.code,'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
    assert.equal(f.invitationAttempts, 1);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT attempts FROM implementation_notification_attempts').get().attempts, 1);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'PROVIDER_BLOCKED');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_PROVIDER_BLOCKED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('authorised provider recovery resumes the same blocked invitation exactly once', async () => {
  let providerAuthorised = false;
  const attemptedInvitations = [];
  const f = fixture({
    sendInvitation: async invitation => {
      attemptedInvitations.push(invitation);
      if (!providerAuthorised) {
        const error = new Error('simulated provider credential rejection');
        error.permanent = true;
        error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
        throw error;
      }
      return { provider: 'test-mailer', messageId: 'mail-provider-recovered' };
    }
  });
  try {
    const event = {
      tenant: 'alpha', contractRef: 'contract-provider-recovery', targetHours: 8,
      recipientEmail: 'manager@alpha'
    };
    const first = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.blocked, true);
    assert.equal(attemptedInvitations.length, 1);

    const denied = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }
    );
    assert.equal(denied.status, 403);
    assert.equal(attemptedInvitations.length, 1);

    providerAuthorised = true;
    const recovered = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.notification.delivered, true);
    assert.equal(recovered.body.notification.recovered, true);
    assert.equal(recovered.body.implementation.state, 'BUILDING');
    assert.equal(attemptedInvitations.length, 2);
    assert.equal(attemptedInvitations[1].startUrl, attemptedInvitations[0].startUrl);
    assert.equal(attemptedInvitations[1].idempotencyKey, attemptedInvitations[0].idempotencyKey);

    const repeated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(repeated.status, 409);
    assert.equal(attemptedInvitations.length, 2);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'DELIVERED');
    assert.equal(status.body.notificationRecovery.attempts, 2);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_notification_outbox').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_PROVIDER_RECOVERED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('provider recovery becomes exhausted on the third failed send without a fourth action', async () => {
  let invitationAttempts = 0;
  const f = fixture({
    sendInvitation: async () => {
      invitationAttempts += 1;
      const error = new Error('simulated persistent provider credential rejection');
      error.permanent = true;
      error.code = 'MESSAGE_PROVIDER_AUTHORIZATION_REQUIRED';
      throw error;
    }
  });
  try {
    const event = {
      tenant: 'alpha', contractRef: 'contract-provider-recovery-budget', targetHours: 8,
      recipientEmail: 'manager@alpha'
    };
    const first = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated', event, f.internal
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.notification.blocked, true);

    const second = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(second.status, 409);
    assert.equal(second.body.notification.state, 'BLOCKED');

    const third = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(third.status, 409);
    assert.equal(third.body.notification.state, 'EXHAUSTED');
    assert.equal(third.body.notification.terminalAction, 'PROVIDER_OR_ADMIN_AUTHORIZATION_REQUIRED');
    assert.equal(invitationAttempts, 3);

    const fourth = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/notification-recovery/resume',
      { tenant: event.tenant, contractRef: event.contractRef }, f.internal
    );
    assert.equal(fourth.status, 409);
    assert.equal(invitationAttempts, 3);

    const status = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    assert.equal(status.body.notificationRecovery.state, 'EXHAUSTED');
    assert.equal(status.body.notificationRecovery.attempts, 3);
    assert.equal(status.body.notificationRecovery.remainingAttempts, 0);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT state FROM implementation_notification_outbox').get().state, 'EXHAUSTED');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM implementation_events WHERE event='CONTRACT_INVITATION_RECOVERY_EXHAUSTED'").get().count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('implementation entry preflight exposes missing requirements before a contract without exposing secrets', async () => {
  const previousApiKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  delete process.env.RESEND_API_KEY;
  delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
  const f = fixture({ useDefaultInvitationSender: true });
  try {
    const denied = await call(f.engine, null, 'GET', '/api/implementation/autonomous/preflight');
    assert.equal(denied.status, 403);

    const result = await call(
      f.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined, f.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'BLOCKED');
    assert.equal(result.body.ready, false);
    assert.deepEqual(result.body.checks, {
      contractAuthentication: true,
      secureCustomerOrigin: true,
      invitationProvider: false,
      restartRecovery: true
    });
    assert.deepEqual(result.body.requiredActions, ['MESSAGE_PROVIDER_CONFIGURATION_REQUIRED']);
    assert.equal(JSON.stringify(result.body).includes('implementation-worker-test-token'), false);
    assert.equal(JSON.stringify(result.body).includes('contract-webhook-test-token'), false);
    assert.equal('apiKey' in result.body, false);
    assert.equal('fromEmail' in result.body, false);
  } finally {
    f.close();
    if (previousApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousApiKey;
    if (previousFrom === undefined) delete process.env.WFM_IMPLEMENTATION_FROM_EMAIL;
    else process.env.WFM_IMPLEMENTATION_FROM_EMAIL = previousFrom;
  }

  const ready = fixture();
  try {
    const result = await call(
      ready.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined, ready.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'READY');
    assert.equal(result.body.ready, true);
    assert.deepEqual(result.body.requiredActions, []);
  } finally {
    ready.close();
  }

  const sharedSecretFallback = fixture({ omitDedicatedRecoverySecret: true });
  try {
    const result = await call(
      sharedSecretFallback.engine, null, 'GET', '/api/implementation/autonomous/preflight', undefined,
      sharedSecretFallback.internal
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'BLOCKED');
    assert.equal(result.body.checks.restartRecovery, false);
    assert.deepEqual(result.body.requiredActions, ['INVITATION_RECOVERY_SECRET_CONFIGURATION_REQUIRED']);
  } finally {
    sharedSecretFallback.close();
  }
});

test('initial internal activation auto-starts once and replay requires a permanent workspace association', async () => {
  const f = fixture();
  try {
    const denied = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-idempotent', recipientEmail: 'manager@alpha' }
    );
    assert.equal(denied.status, 403);

    const first = await createInvitation(f, 'alpha', 'contract-idempotent');
    const second = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      { tenant: 'alpha', contractRef: 'contract-idempotent', targetHours: 8, recipientEmail: 'manager@alpha' },
      f.internal
    );
    assert.equal(first.result.status, 201);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
    assert.equal(f.sentInvitations.length, 1);

    const beforeStart = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(beforeStart.status, 200);
    assert.equal(beforeStart.body.state, 'BUILDING');
    assert.ok(beforeStart.body.runId);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM implementation_runs').get().count, 1);
    db.close();

    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: first.token }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.state, 'BUILDING');
    assert.equal(started.body.targetHours, 8);
    assert.equal(started.body.operationalReady, false);

    const replay = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: first.token }
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.runId, started.body.runId);
  } finally {
    f.close();
  }
});

test('invitation is bound to the intended tenant and recipient', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'recipient-boundary');
    const wrongTenant = await call(
      f.engine, f.tokens.bravo, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(wrongTenant.status, 404);

    const employeeAttempt = await call(
      f.engine, f.tokens.employee, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(employeeAttempt.status, 403);

    const managerPreview = await call(
      f.engine, f.tokens.manager, 'GET',
      '/api/implementation/autonomous/invitation?token=' + encodeURIComponent(invitation.token)
    );
    assert.equal(managerPreview.status, 200);
    assert.equal(managerPreview.body.invitation.state, 'AWAITING_CUSTOMER_START');
  } finally {
    f.close();
  }
});

test('rigorous testing, cleanup and live import cannot be falsely marked complete', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'strict-proof');
    for (const [kind, detail] of [
      ['scenario-validation', { totalScenarios: 100, passedScenarios: 99, criticalFailures: 1 }],
      ['test-data-cleanup', { remainingTestRows: 1, liveRowsTouched: 0 }],
      ['live-data-import', { sourceCount: 100, importedCount: 99, invalidCount: 0, checksumMatch: true }]
    ]) {
      const result = await call(
        f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
        { runId: run.runId, kind, status: 'PASS', confidence: 1, source: 'invalid-proof', detail },
        f.internal
      );
      assert.equal(result.status, 409);
    }
  } finally {
    f.close();
  }
});

test('readiness is fail-closed until every required evidence item passes at confidence floor', async () => {
  const f = fixture();
  try {
    const run = await startRun(f);
    const firstRequirement = REQUIREMENTS.find(item => !['configuration-scope', 'tenant-environment'].includes(item.key));
    const weak = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId: run.runId,
        kind: firstRequirement.key,
        status: 'PASS',
        confidence: Math.max(0, firstRequirement.minConfidence - 0.01),
        source: 'test'
      },
      f.internal
    );
    assert.equal(weak.status, 200);
    assert.equal(weak.body.operationalReady, false);
    assert.equal(
      weak.body.requirements.find(x => x.key === firstRequirement.key).satisfied,
      false
    );

    const ready = await passAllEvidence(f, run.runId);
    assert.equal(ready.completedRequirements, REQUIREMENTS.length);
    assert.equal(ready.operationalReady, false);
    assert.ok(ready.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));
  } finally {
    f.close();
  }
});

test('high-risk inference exception blocks go-live until customer resolves it', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'contract-decision');
    const proposal = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/proposal',
      {
        runId: run.runId,
        key: 'night-overtime-threshold',
        question: 'Night overtime appears to change after 40 hours. Accept?',
        proposal: { thresholdHours: 40, multiplier: 1.5 },
        confidence: 0.91,
        risk: 'HIGH'
      },
      f.internal
    );
    assert.equal(proposal.status, 201);

    const evidenceReady = await passAllEvidence(f, run.runId);
    assert.equal(evidenceReady.operationalReady, false);
    assert.equal(evidenceReady.blockingDecisions.length, 1);

    const resolved = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/decision',
      {
        runId: run.runId,
        key: 'night-overtime-threshold',
        action: 'CHANGED',
        value: { thresholdHours: 37.5, multiplier: 1.5 }
      }
    );
    assert.equal(resolved.status, 200);
    assert.equal(resolved.body.blockingDecisions.length, 0);
    assert.equal(resolved.body.operationalReady, false);
    assert.ok(resolved.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));
  } finally {
    f.close();
  }
});

test('implementation runs and decisions are tenant isolated', async () => {
  const f = fixture();
  try {
    const alpha = await startRun(f, 'alpha', 'alpha-contract');
    await startRun(f, 'bravo', 'bravo-contract');

    await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/proposal',
      {
        runId: alpha.runId,
        key: 'alpha-only',
        question: 'Alpha-only decision?',
        proposal: { value: true },
        confidence: 0.8,
        risk: 'HIGH'
      },
      f.internal
    );

    const bravoStatus = await call(
      f.engine, f.tokens.bravo, 'GET', '/api/implementation/autonomous/status'
    );
    assert.equal(bravoStatus.status, 200);
    assert.equal(bravoStatus.body.tenant, 'bravo');
    assert.deepEqual(
      bravoStatus.body.decisions.map(item => item.key).sort(),
      ['absence-policy-authority', 'time-policy-authority']
    );
    assert.equal(bravoStatus.body.decisions.some(item => item.key === 'alpha-only'), false);

    const crossTenant = await call(
      f.engine, f.tokens.bravo, 'POST', '/api/implementation/autonomous/decision',
      {
        runId: alpha.runId,
        key: 'alpha-only',
        action: 'ACCEPTED'
      }
    );
    assert.equal(crossTenant.status, 404);
  } finally {
    f.close();
  }
});


test('customer configuration scope is required, persisted and tenant scoped', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'scope-required');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    assert.equal(started.status, 201);
    assert.equal(started.body.scopeCaptured, false);
    assert.equal(started.body.requirements.find(x => x.key === 'configuration-scope').satisfied, false);

    const denied = await call(
      f.engine, f.tokens.employee, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(denied.status, 403);

    const invalid = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      { companyName: 'Alpha Manufacturing', countries: [], sites: [], employeeCount: 0 }
    );
    assert.equal(invalid.status, 400);

    const invalidPartition = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      { ...scopeFixture('alpha'), workforcePartition: { authoritativeConfirmation: false, employeeCount: 5000, sourceRef: 'customer-partition-plan' } }
    );
    assert.equal(invalidPartition.status, 400);

    const saved = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(saved.status, 201);
    assert.equal(saved.body.scopeCaptured, true);
    assert.equal(saved.body.customerScope.employeeCount, 10000);
    assert.equal(saved.body.requirements.find(x => x.key === 'configuration-scope').satisfied, true);

    const fetched = await call(
      f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/scope'
    );
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.scopeCaptured, true);
    assert.equal(fetched.body.scope.companyName, 'Alpha Manufacturing');
    assert.equal(fetched.body.scope.workforcePartition, null);

    const partitioned = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      { ...scopeFixture('alpha'), workforcePartition: { authoritativeConfirmation: true, employeeCount: 5000, sourceRef: 'customer-authorised-wave-1', label: 'Wave 1' } }
    );
    assert.equal(partitioned.status, 200);
    assert.deepEqual(partitioned.body.customerScope.workforcePartition, {
      authoritativeConfirmation: true, employeeCount: 5000, sourceRef: 'customer-authorised-wave-1', label: 'Wave 1'
    });

    const crossTenant = await call(
      f.engine, f.tokens.bravo, 'GET', '/api/implementation/autonomous/scope'
    );
    assert.equal(crossTenant.status, 409);
  } finally {
    f.close();
  }
});

test('trusted evidence cannot bypass missing customer scope', async () => {
  const f = fixture();
  try {
    const invitation = await createInvitation(f, 'alpha', 'scope-readiness-gate');
    const started = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/start',
      { token: invitation.token }
    );
    const evidenceReady = await passAllEvidence(f, started.body.runId);
    assert.equal(evidenceReady.scopeCaptured, false);
    assert.equal(evidenceReady.operationalReady, false);
    assert.equal(evidenceReady.state, 'BUILDING');

    const scoped = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/scope',
      scopeFixture('alpha')
    );
    assert.equal(scoped.status, 201);
    assert.equal(scoped.body.scopeCaptured, true);
    assert.equal(scoped.body.operationalReady, false);
    const scopedMap=new Map(scoped.body.requirements.map(item=>[item.key,item]));
    assert.ok(scoped.body.requirements.filter(item => item.status === 'REVALIDATION_REQUIRED').length > 0);
    assert.equal(scopedMap.get('tenant-environment').status,'REVALIDATION_REQUIRED');
    assert.equal(scopedMap.get('identity-access').satisfied,true);
    assert.equal(scopedMap.get('security-controls').satisfied,true);
    const renewed = await passAllEvidence(f, started.body.runId, '-current-scope');
    assert.equal(renewed.completedRequirements, REQUIREMENTS.length);
    assert.equal(renewed.operationalReady, false);
    assert.ok(renewed.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));
    const audit = new DatabaseSync(f.dbPath);
    assert.ok(audit.prepare('SELECT COUNT(*) AS n FROM implementation_evidence WHERE run_id=?').get(started.body.runId).n >= REQUIREMENTS.length - 2);
    audit.close();
  } finally {
    f.close();
  }
});

test('implementation audit events are append only', async () => {
  const f = fixture();
  try {
    await startRun(f, 'alpha', 'contract-audit');
    const db = new DatabaseSync(f.dbPath);
    assert.throws(
      () => db.exec("UPDATE implementation_events SET event='tampered'"),
      /append only/
    );
    assert.throws(
      () => db.exec('DELETE FROM implementation_events'),
      /append only/
    );
    db.close();
  } finally {
    f.close();
  }
});

test('unknown evidence kinds and raw untrusted evidence are rejected', async () => {
  const f = fixture();
  try {
    const run = await startRun(f, 'alpha', 'contract-evidence');
    const browserAttempt = await call(
      f.engine, f.tokens.manager, 'POST', '/api/implementation/autonomous/evidence',
      { runId: run.runId, kind: 'security-controls', status: 'PASS', confidence: 1 }
    );
    assert.equal(browserAttempt.status, 403);

    const unknown = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      { runId: run.runId, kind: 'made-up-control', status: 'PASS', confidence: 1 },
      f.internal
    );
    assert.equal(unknown.status, 400);
  } finally {
    f.close();
  }
});



test('legacy implementation_events schema migrates every required audit field in place without losing rows or triggers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-one-day-legacy-'));
  const dbPath = path.join(dir, 'legacy.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);' +
    'CREATE TABLE implementation_events(' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, legacy_kind TEXT NOT NULL,' +
      'legacy_payload TEXT NOT NULL, legacy_at TEXT NOT NULL);' +
    'CREATE TRIGGER legacy_implementation_event_update BEFORE UPDATE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Legacy implementation events are append only.'); END;" +
    'CREATE TRIGGER legacy_implementation_event_delete BEFORE DELETE ON implementation_events ' +
      "BEGIN SELECT RAISE(ABORT,'Legacy implementation events are append only.'); END;"
  );
  const legacyPayload = '{"kept":true,"source":"pre-current-schema"}';
  db.prepare('INSERT INTO implementation_events(legacy_kind,legacy_payload,legacy_at) VALUES(?,?,?)')
    .run('legacy-event', legacyPayload, '2026-09-01T00:00:00.000Z');
  db.close();

  const options = {
    dbPath,
    internalToken: 'implementation-worker-test-token',
    contractWebhookSecret: 'contract-webhook-test-token',
    publicOrigin: 'https://implementation.test',
    sendInvitation: async () => ({ provider: 'test-mailer', messageId: 'legacy-migration' })
  };

  const engine = createOneDayEnterpriseEngine(options);
  engine.close();

  // A second startup proves the migration is idempotent after the columns exist.
  const second = createOneDayEnterpriseEngine(options);
  second.close();

  try {
    const migrated = new DatabaseSync(dbPath);
    const columns = migrated.prepare('PRAGMA table_info(implementation_events)').all().map(row => row.name);
    for (const expected of [
      'id','legacy_kind','legacy_payload','legacy_at',
      'run_id','tenant','event','detail_json','created_at'
    ]) {
      assert.ok(columns.includes(expected), 'missing migrated column: ' + expected);
    }

    const legacy = migrated.prepare(
      'SELECT legacy_kind,legacy_payload,legacy_at,run_id,tenant,event,detail_json,created_at FROM implementation_events WHERE id=1'
    ).get();
    assert.equal(legacy.legacy_kind, 'legacy-event');
    assert.equal(legacy.legacy_payload, legacyPayload);
    assert.equal(legacy.legacy_at, '2026-09-01T00:00:00.000Z');
    assert.equal(legacy.run_id, null);
    assert.equal(legacy.tenant, null);
    assert.equal(legacy.event, null);
    assert.equal(legacy.detail_json, null);
    assert.equal(legacy.created_at, null);

    const legacyTriggers = migrated.prepare(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'legacy_implementation_event_%' ORDER BY name"
    ).all().map(row => row.name);
    assert.deepEqual(legacyTriggers, [
      'legacy_implementation_event_delete',
      'legacy_implementation_event_update'
    ]);

    migrated.prepare(
      'INSERT INTO implementation_events(run_id,tenant,event,detail_json,created_at) VALUES(?,?,?,?,?)'
    ).run('run-new','alpha','new-event','{"new":true}','2026-09-26T00:00:00.000Z');
    const current = migrated.prepare(
      'SELECT run_id,tenant,event,detail_json,created_at FROM implementation_events WHERE run_id=?'
    ).get('run-new');
    assert.equal(current.event, 'new-event');

    assert.throws(
      () => migrated.exec("UPDATE implementation_events SET legacy_kind='tampered' WHERE id=1"),
      /append only/i
    );
    migrated.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tenant-environment PASS is validator-bound, fresh, and reopened by a later terminal failure', async () => {
  const candidateSha = 'a'.repeat(40);
  const deploymentId = 'deployment-current';
  const f = fixture({ requireCandidateBinding: true, candidateSha, deploymentId });
  try {
    const run = await startRun(f);
    const makeDetail = (verifierRunId) => ({
      fixtureOnly: false,
      zeroHuman: true,
      humanInterventions: 0,
      provisioned: true,
      tenantExists: true,
      environmentId: 'cloud-env-alpha',
      provisioningMode: 'cloud-runtime',
      healthcheckPassed: true,
      tenantIsolationVerified: true,
      durableStateVerified: true,
      exactCandidateSha: candidateSha,
      exactTargetDeploymentId: deploymentId,
      tenant: 'alpha',
      runId: run.runId,
      verifierDeploymentId: verifierRunId
    });
    const forged = makeDetail('forged-verifier');
    const db = new DatabaseSync(f.dbPath);
    db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(run.runId, 'alpha', 'tenant-environment', 'PASS', 1, 'hosted-proof', JSON.stringify(forged), new Date().toISOString());
    db.close();
    const before = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const beforeTenant = before.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(beforeTenant.satisfied, false);
    assert.equal(beforeTenant.status, 'REVALIDATION_REQUIRED');

    const passDetail = makeDetail('verifier-pass-001');
    const pass = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: passDetail
    }, f.internal);
    assert.equal(pass.status, 200);
    const passedTenant = pass.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(passedTenant.satisfied, true);
    assert.equal(passedTenant.status, 'PASS');

    const failure = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'FAIL', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: { verifierDeploymentId: 'verifier-fail-002', terminalFailure: true, error: 'TENANT_RUNTIME_HEALTH_FAILED' }
    }, f.internal);
    assert.equal(failure.status, 200);
    const failedTenant = failure.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(failedTenant.satisfied, false);
    assert.equal(failedTenant.status, 'FAIL');

    const replay = await call(f.engine, null, 'POST', '/api/implementation/autonomous/evidence', {
      runId: run.runId, kind: 'tenant-environment', status: 'PASS', confidence: 1,
      source: 'independent-hosted-tenant-environment-verifier', detail: passDetail
    }, f.internal);
    assert.equal(replay.status, 409);
    const reopened = await call(f.engine, f.tokens.manager, 'GET', '/api/implementation/autonomous/status');
    const reopenedTenant = reopened.body.requirements.find(item => item.key === 'tenant-environment');
    assert.equal(reopenedTenant.satisfied, false);
    assert.equal(reopenedTenant.status, 'FAIL');
  } finally {
    f.close();
  }
});

test('strict replay proof rejects coercible or nonfinite totals and variance before durable admission', async () => {
  const f = fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const detail={exactCandidateSha:f.candidateSha,exactTargetDeploymentId:f.deploymentId,dataClass:'synthetic-scale',independentCalculation:true,expectedTotal:0,calculatedTotal:0,unexplainedVariance:0};
    for(const field of ['expectedTotal','calculatedTotal','unexplainedVariance']) {
      for(const invalid of [null,'','0',false,[],{},Infinity,-Infinity,NaN]) {
        const result=await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',{runId:run.runId,kind:'historical-replay',status:'PASS',confidence:1,source:'isolated-regression',detail:{...detail,[field]:invalid}},f.internal);
        assert.equal(result.status,409,field+'='+JSON.stringify(invalid));
      }
    }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(x=>x.key==='historical-replay').satisfied,false);
    for(const total of [0,123.45,-10.5]) {
      const result=await call(f.engine,null,'POST','/api/implementation/autonomous/evidence',{runId:run.runId,kind:'historical-replay',status:'PASS',confidence:1,source:'isolated-regression',detail:{...detail,expectedTotal:total,calculatedTotal:total}},f.internal);
      assert.equal(result.status,200);
      assert.equal(result.body.requirements.find(x=>x.key==='historical-replay').satisfied,true);
    }
  } finally { f.close(); }
});

for(const kind of ['historical-replay','time-policies']) test('persisted malformed '+kind+' receipt loses authority but remains auditable', async()=>{
  const f=fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const binding={exactCandidateSha:f.candidateSha,exactTargetDeploymentId:f.deploymentId};
    const detail=kind==='historical-replay'?{...binding,dataClass:'synthetic-scale',independentCalculation:true,expectedTotal:null,calculatedTotal:'',unexplainedVariance:null}:{...binding,fixtureOnly:false,evidenceClass:'customer-authorised',sourceAuthoritative:true,sourceRef:'isolated-legacy-policy',effectiveDated:true,effectiveDate:'2026-02-30',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
    const db=new DatabaseSync(f.dbPath);
    try { db.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(run.runId,'alpha',kind,'PASS',1,'isolated-legacy-regression',JSON.stringify(detail),new Date().toISOString()); }
    finally { db.close(); }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    const gate=status.body.requirements.find(x=>x.key===kind);
    assert.equal(gate.satisfied,false);
    assert.equal(gate.status,'REVALIDATION_REQUIRED');
    const auditDb=new DatabaseSync(f.dbPath);
    try { assert.equal(auditDb.prepare('SELECT status FROM implementation_evidence WHERE run_id=? AND kind=?').get(run.runId,kind).status,'PASS'); }
    finally { auditDb.close(); }
  } finally {f.close();}
});

test('customer policy date rejects impossible days and malformed timestamps without resolving authority', async () => {
  const f=fixture({strictEvidence:true,requireCandidateBinding:true});
  try {
    const run=await startRun(f);
    const detail={authoritativeConfirmation:true,sourceRef:'isolated-regression-policy',effectiveDate:'2026-99-99',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
    for(const date of ['2026-99-99','2026-02-30','2025-02-29','2026-04-31','2026-10-01Tgarbage']) {
      const result=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/decision',{runId:run.runId,key:'time-policy-authority',action:'ACCEPTED',detail:{...detail,effectiveDate:date}});
      assert.equal(result.status,409,date);
    }
    const status=await call(f.engine,f.tokens.manager,'GET','/api/implementation/autonomous/status');
    assert.equal(status.body.requirements.find(x=>x.key==='time-policies').satisfied,false);
    const db=new DatabaseSync(f.dbPath);
    try { assert.equal(db.prepare('SELECT status FROM implementation_decisions WHERE run_id=? AND decision_key=?').get(run.runId,'time-policy-authority').status,'PENDING'); }
    finally { db.close(); }
    for(const date of ['2024-02-29','2026-10-01','2026-10-01T12:30:00Z','2026-10-01T23:30:00-02:00']) {
      const result=await call(f.engine,f.tokens.manager,'POST','/api/implementation/autonomous/decision',{runId:run.runId,key:'time-policy-authority',action:'ACCEPTED',detail:{...detail,effectiveDate:date}});
      assert.equal(result.status,200,date);
      assert.equal(result.body.requirements.find(x=>x.key==='time-policies').satisfied,true);
    }
  } finally { f.close(); }
});

// Retained real SQLite reproductions for current configuration and strict receipt admission.
{
'use strict';const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{Readable}=require('node:stream'),{createHash}=require('node:crypto'),{DatabaseSync}=require('node:sqlite');
const {createOneDayEnterpriseEngine,REQUIREMENTS}=require('./one-day-enterprise-engine.cjs'),observations=[],SHA='b51f291a5f73ccccd828cab4ad7650efcc67c53f',DPL='synthetic-current-review-deployment',TOKEN='review-internal-token',session='review-manager-session';const hash=x=>createHash('sha256').update(x).digest('hex');
const scope=()=>({companyName:'Review Tenant',countries:['United Kingdom'],sites:['Plant1'],employeeCount:1,sourceSystems:['HCM'],features:['Time','Absence'],workPatterns:['daytime'],clockingMethods:['badge'],payrollSystem:'',hcmSystem:'HCM',erpSystem:'ERP',agencyLabour:false,priorities:'accurate time and absence'});
function fixture(strict=true){const fixtures=path.join(require('node:os').tmpdir(),'vector-current-admission-tests');fs.mkdirSync(fixtures,{recursive:true});const dir=fs.mkdtempSync(path.join(fixtures,'case-')),dbPath=path.join(dir,'state.sqlite'),db=new DatabaseSync(dbPath),now=Date.now();db.exec("CREATE TABLE tenants(id TEXT PRIMARY KEY,version INTEGER NOT NULL,state TEXT NOT NULL);CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL,person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT '[]');CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL,expires INTEGER NOT NULL);");db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('review-alpha',1,'{}');db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@review','review-alpha','manager','manager',1,'salt','00',JSON.stringify(['company.configure']));db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(session),'manager@review',now+3600000);db.close();const opts={dbPath,strictEvidence:strict,requireCandidateBinding:true,candidateSha:SHA,deploymentId:DPL,internalToken:TOKEN,agentsApiEnabled:false,notificationRetryPollMs:0};let engine=createOneDayEnterpriseEngine(opts);const seed=new DatabaseSync(dbPath);seed.prepare('INSERT INTO implementation_runs(id,tenant,contract_ref_hash,state,started_at_ms,deadline_at_ms,target_hours,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('run-review','review-alpha','contract','BUILDING',now,now+8*3600000,8,new Date(now).toISOString(),new Date(now).toISOString());seed.close();return{dir,dbPath,get engine(){return engine;},reopen(strictNext=true){engine.close();engine=createOneDayEnterpriseEngine({...opts,strictEvidence:strictNext});},close(){engine.close();},audit(){const d=new DatabaseSync(dbPath),r={evidence:d.prepare('SELECT * FROM implementation_evidence ORDER BY id').all(),events:d.prepare('SELECT * FROM implementation_events ORDER BY id').all(),scope:d.prepare('SELECT * FROM implementation_scope').all(),environments:d.prepare('SELECT * FROM tenant_environments').all(),jobs:d.prepare('SELECT * FROM implementation_work_jobs').all()};d.close();return r;}};}
async function call(f,route,body,auth='worker'){const req=Readable.from(body===undefined?[]:[JSON.stringify(body)]);req.method=body===undefined?'GET':'POST';req.url='/api/implementation/autonomous/'+route;req.headers=auth==='worker'?{'x-wfm-implementation-internal':TOKEN}:auth==='manager'?{cookie:'wfm_session='+session}:{};const res={statusCode:200,headersSent:false,writableEnded:false,body:'',setHeader(){},end(x=''){this.body=String(x);this.headersSent=true;this.writableEnded=true;}};assert.equal(await f.engine.handleRequest(req,res),true);return{status:res.statusCode,body:res.body?JSON.parse(res.body):null};}
function detail(kind){
 const common={exactCandidateSha:SHA,exactTargetDeploymentId:DPL,tenant:'review-alpha',runId:'run-review',fixtureOnly:false};
 if(kind==='tenant-environment')return{...common,zeroHuman:true,humanInterventions:0,provisioned:true,tenantExists:true,environmentId:'synthetic-review-environment',provisioningMode:'cloud-runtime',runtimeHealthPassed:true,tenantIsolationVerified:true,crossTenantNegativeTests:1,durableStateVerified:true,implementationRunId:'run-review',verifierRunId:'review-verifier',proofRunnerIdentity:'review-identity',targetDeploymentCreatedAt:new Date(Date.now()-10000).toISOString(),evidenceGeneratedAt:new Date().toISOString()};
 if(kind==='time-policies')return{authoritativeConfirmation:true,sourceRef:'review-customer-time-policy',effectiveDate:'2026-01-01',unresolvedRules:0,unknownPolicyFields:0,breakRulesVerified:true,overtimeRulesVerified:true,workingTimeRulesVerified:true,timeZoneVerified:true};
 if(kind==='absence-policies')return{authoritativeConfirmation:true,sourceRef:'review-customer-absence-policy',effectiveDate:'2026-01-01',unresolvedRules:0,unknownPolicyFields:0,leaveYearVerified:true,entitlementMethodVerified:true,approvalRulesVerified:true,absenceTypesVerified:true,usesOpeningBalance:false,openingBalanceFictional:false,openingBalanceSourceVerified:false};
 if(kind==='source-systems')return{...common,zeroHuman:true,humanInterventions:0,discoveryCompleted:true,authorizationVerified:true,providers:[{provider:'review-HCM',discovered:true,authorized:true,connected:true,mode:'sandbox'}]};
 if(kind==='scheduling')return{...common,cloudRuntime:true,sourceAuthoritative:true,rosterSourceVerified:true,skillCoverageVerified:true,availabilityVerified:true,ruleEvaluationVerified:true,publishedScheduleReadbackVerified:true,unresolvedExceptions:0};
 if(kind==='approvals')return{...common,cloudRuntime:true,sourceAuthoritative:true,delegationRulesVerified:true,selfApprovalBlocked:true,auditTrailVerified:true,approvalReadbackVerified:true};
 if(kind==='clocking')return{...common,cloudRuntime:true,sourceAuthoritative:true,deviceOrSourceVerified:true,duplicateProtectionVerified:true,offlineHandlingVerified:true,timezoneDstVerified:true,attendanceReadbackVerified:true};
 if(kind==='payroll-mapping')return{...common,readinessClass:'customer-specific',dataClass:'customer-authorised',mappingAuthorityVerified:true,providerTargetVerified:true,employeeIdentityMappingVerified:true,payCodesVerified:true,absenceMappingVerified:true,roundingPolicyVerified:true,releasedBatchId:'B-review-current',batchChecksum:'c'.repeat(64),fullPayrollVerified:true};
 if(kind==='historical-replay')return{...common,dataClass:'customer-authorised',independentCalculation:true,expectedTotal:100,calculatedTotal:100,unexplainedVariance:0};
 if(kind==='security-controls')return{...common,cloudRuntime:true,tenantIsolationVerified:true,crossTenantNegativeTests:1,criticalFailures:0};
 if(kind==='resilience')return{...common,hostedRuntime:true,faultInjected:true,detected:true,classified:true,repairOrContainmentApplied:true,independentVerificationPassed:true,durableAuditVerified:true,replaySafetyVerified:true,rollbackRequired:false,criticalFailures:0};
 if(kind==='scenario-validation')return{...common,cloudRuntime:true,testDataClass:'synthetic-scenario',totalScenarios:GOLDEN_JOURNEY_STEPS.length,passedScenarios:GOLDEN_JOURNEY_STEPS.length,criticalFailures:0,correlationId:'review-golden-journey',steps:GOLDEN_JOURNEY_STEPS.map(id=>({id,status:'PASS',evidenceRef:'review:'+id,correlationId:'review-golden-journey'})),payrollProvider:{correlationId:'review-golden-journey',batchId:'B-review',batchChecksum:'a'.repeat(64),providerBindingDigest:'b'.repeat(64),batchReceiptDigest:'c'.repeat(64),readbackDigest:'d'.repeat(64),releaseEvidenceRef:'review:payroll-batch-released',acceptanceEvidenceRef:'review:payroll-provider-accepted',readbackEvidenceRef:'review:payroll-provider-readback',fullPayrollVerified:true}};
 if(kind==='test-data-cleanup')return{...common,remainingTestRows:0,liveRowsTouched:0};
 if(kind==='live-data-import')return{...common,zeroHuman:true,humanInterventions:0,sourceAuthoritative:true,sourceCount:1,importedCount:1,invalidCount:0,checksumMatch:true};
 return{...common,checked:true};
}
const submit=async(f,kind,payload=detail(kind),auth='worker')=>{
 if(['time-policies','absence-policies'].includes(kind)&&auth==='worker'){
  const key=kind==='time-policies'?'time-policy-authority':'absence-policy-authority';
  return call(f,'decision',{runId:'run-review',key,action:'ACCEPTED',detail:payload},'manager');
 }
 return call(f,'evidence',{runId:'run-review',kind,status:'PASS',confidence:1,source:kind==='tenant-environment'?'hosted-proof':'review-declared-producer',detail:payload},auth);
};
const row=(result,kind)=>result.body.requirements.find(x=>x.key===kind);
test('current admission: scope update reopens affected evidence without treating 21/21 evidence as launch readiness',async()=>{const f=fixture();try{const initial=await call(f,'scope',scope(),'manager');assert.equal(initial.status,201);for(const{key}of REQUIREMENTS){if(key==='configuration-scope')continue;const d=detail(key);d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;const r=await submit(f,key,d);assert.equal(r.status,200,JSON.stringify(r.body));}const before=await call(f,'status',undefined,'manager');assert.equal(before.body.operationalReady,false);assert.equal(before.body.completedRequirements,21);assert.ok(before.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));const beforeAudit=f.audit();const changed=scope();changed.countries=['Germany'];changed.sites=['Plant2'];changed.employeeCount=2;changed.erpSystem='ERP-DE';const after=await call(f,'scope',changed,'manager');assert.equal(after.status,200);observations.push({name:'current scope update',fixtureDir:f.dir,initialScope:scope(),newScope:changed,before:before.body,after:after.body,durable:f.audit()});assert.equal(after.body.operationalReady,false,'Old evidence incorrectly keeps READY on changed scope');assert.ok(after.body.requirements.some(x=>x.status==='REVALIDATION_REQUIRED'));
const durableAfter=f.audit();assert.equal(durableAfter.environments[0].environment_id,initial.body.tenantEnvironment.environmentId);assert.notEqual(after.body.tenantEnvironment.configurationDigest,initial.body.tenantEnvironment.configurationDigest);assert.deepEqual(durableAfter.evidence,beforeAudit.evidence);
assert.equal(JSON.parse(durableAfter.environments[0].configuration_json).erpSystem,'ERP-DE');
for(const{key}of REQUIREMENTS){if(key==='configuration-scope')continue;const d=detail(key);d.configurationDigest=after.body.tenantEnvironment.configurationDigest;if(key==='tenant-environment')d.verifierRunId='review-verifier-current-scope';assert.equal((await submit(f,key,d)).status,200,key);}
const renewed=await call(f,'status',undefined,'manager');assert.equal(renewed.body.completedRequirements,21);assert.equal(renewed.body.operationalReady,false);assert.ok(renewed.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));assert.equal(f.audit().evidence.length,40);f.reopen(true);const reopened=await call(f,'status',undefined,'manager');assert.equal(reopened.body.completedRequirements,21);assert.equal(reopened.body.operationalReady,false);
}finally{f.close();}});
const invalidPersisted=[['source-systems',d=>{d.fixtureOnly=true;d.providers[0].mode='fixture';}],['security-controls',d=>{d.cloudRuntime=false;d.tenantIsolationVerified=false;d.criticalFailures=1;}],['scenario-validation',d=>{d.cloudRuntime=false;d.testDataClass='fixture';}],['live-data-import',d=>{d.fixtureOnly=true;d.sourceAuthoritative=false;}]];
for(const[kind,mutate]of invalidPersisted)test('current admission: strict restart must retain and reject historical weak '+kind+' evidence',async()=>{const f=fixture(false);try{const d=detail(kind);mutate(d);const raw=new DatabaseSync(f.dbPath);raw.prepare('INSERT INTO implementation_evidence(run_id,tenant,kind,status,confidence,source,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run('run-review','review-alpha',kind,'PASS',1,'legacy-compatibility',JSON.stringify(d),new Date().toISOString());raw.close();const admitted=await call(f,'status',undefined,'manager');assert.equal(row(admitted,kind).satisfied,false);const before=f.audit();f.reopen(true);const status=await call(f,'status',undefined,'manager'),after=f.audit();assert.equal(after.evidence.length,before.evidence.length,'Evidence audit should remain');const configured=await call(f,'scope',scope(),'manager');assert.equal(configured.status,201);for(const{key}of REQUIREMENTS){if(key==='configuration-scope'||key===kind)continue;const p=detail(key);p.configurationDigest=configured.body.tenantEnvironment.configurationDigest;assert.equal((await submit(f,key,p)).status,200);}const final=await call(f,'status',undefined,'manager'),finalAudit=f.audit();assert.equal(finalAudit.evidence.length,20);assert.equal(finalAudit.evidence.find(x=>x.id===before.evidence[0].id).detail_json,before.evidence[0].detail_json,'Original invalid receipt preserved exactly');observations.push({name:'persisted strict '+kind,fixtureDir:f.dir,admitted:row(admitted,kind),reopened:row(status,kind),beforeEvidence:before.evidence,afterEvidence:after.evidence,beforeEventCount:before.events.length,afterEventCount:after.events.length,finalReadiness:final.body,finalDurable:finalAudit});assert.equal(final.body.operationalReady,false,'One invalid persisted receipt incorrectly completes strict readiness');assert.equal(row(status,kind).satisfied,false,'Weak compatibility evidence remains current PASS');assert.equal(row(status,kind).status,'REVALIDATION_REQUIRED');}finally{f.close();}});
test('current admission: strict immediate admission rejects fixture provider, weak security and fixture live import before persistence',async()=>{const f=fixture();try{for(const[kind,mutate]of invalidPersisted){const d=detail(kind);mutate(d);const r=await submit(f,kind,d);assert.equal(r.status,409,kind);}assert.equal(f.audit().evidence.length,0);}finally{f.close();}});
test('current admission: candidate/deployment/tenant/run explicit mismatches are denied without any PASS persistence',async()=>{const f=fixture();try{for(const fields of[{exactCandidateSha:'a'.repeat(40)},{exactTargetDeploymentId:'other-deployment'},{tenant:'other-tenant'},{runId:'old-run'}]){const r=await submit(f,'identity-access',{...detail('identity-access'),...fields});assert.equal(r.status,409);}assert.equal(f.audit().evidence.length,0);}finally{f.close();}});
test('current admission: manager cookie and unauthenticated caller cannot publish internal readiness evidence',async()=>{const f=fixture();try{for(const auth of['manager','none'])assert.equal((await submit(f,'identity-access',detail('identity-access'),auth)).status,403);assert.equal(f.audit().evidence.length,0);}finally{f.close();}});

async function admitEvidenceComplete(f){await call(f,'scope',scope(),'manager');for(const{key}of REQUIREMENTS){if(key!=='configuration-scope')assert.equal((await submit(f,key)).status,200,key);}const status=await call(f,'status',undefined,'manager');assert.equal(status.body.completedRequirements,REQUIREMENTS.length);assert.equal(status.body.operationalReady,false);assert.ok(status.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));return status.body;}
test('current admission: same-count scope changes invalidate only affected proof epochs and cannot resurrect prior configuration authority',async()=>{const f=fixture();try{await admitEvidenceComplete(f);const before=f.audit(),old=scope();const changed={...old,countries:['Germany'],sites:['Plant2'],erpSystem:'ERP-DE'};const updated=await call(f,'scope',changed,'manager');assert.equal(updated.body.operationalReady,false);assert.ok(updated.body.requirements.filter(x=>x.status==='REVALIDATION_REQUIRED').length>0);const scoped=new Map(updated.body.requirements.map(x=>[x.key,x]));assert.equal(scoped.get('tenant-environment').status,'REVALIDATION_REQUIRED');assert.equal(scoped.get('time-policies').status,'REVALIDATION_REQUIRED');assert.equal(scoped.get('identity-access').satisfied,true);assert.equal(scoped.get('security-controls').satisfied,true);assert.equal(scoped.get('source-systems').satisfied,true);assert.deepEqual(f.audit().evidence,before.evidence);f.reopen(true);assert.equal((await call(f,'status',undefined,'manager')).body.operationalReady,false);const back=await call(f,'scope',old,'manager');assert.equal(back.body.operationalReady,false,'Prior identical configuration must not resurrect old-revision authority');assert.deepEqual(f.audit().evidence,before.evidence);assert.equal(f.audit().environments[0].environment_id,before.environments[0].environment_id);}finally{f.close();}});
test('current admission: restored person binding cannot resurrect identity and security receipts',async()=>{
  const f=fixture();try{
    await admitEvidenceComplete(f);const before=f.audit().evidence;
    const d=new DatabaseSync(f.dbPath);const owner=d.prepare('SELECT email,person_id FROM users WHERE tenant=? AND role<>?').get('review-alpha','employee');
    d.prepare('UPDATE users SET person_id=? WHERE email=?').run('changed-authority-anchor',owner.email);
    const changed=await call(f,'status',undefined,'manager');
    for(const key of ['identity-access','security-controls'])assert.equal(row(changed,key).status,'REVALIDATION_REQUIRED',key);
    d.prepare('UPDATE users SET person_id=? WHERE email=?').run(owner.person_id,owner.email);d.close();
    const restored=await call(f,'status',undefined,'manager');
    for(const key of ['identity-access','security-controls'])assert.equal(row(restored,key).status,'REVALIDATION_REQUIRED',key);
    assert.deepEqual(f.audit().evidence,before);
  }finally{f.close();}
});

test('current admission: identical scope resubmission preserves ready receipts and existing effect/job identity',async()=>{const f=fixture();try{await admitEvidenceComplete(f);const before=f.audit(),d=new DatabaseSync(f.dbPath),count=d.prepare('SELECT COUNT(*) AS n FROM tenant_environment_events').get().n;d.close();const again=await call(f,'scope',scope(),'manager');assert.equal(again.body.completedRequirements,REQUIREMENTS.length);assert.equal(again.body.operationalReady,false);assert.deepEqual(f.audit().evidence,before.evidence);assert.deepEqual(f.audit().jobs.map(x=>[x.id,x.intent_digest,x.status]),before.jobs.map(x=>[x.id,x.intent_digest,x.status]));const check=new DatabaseSync(f.dbPath);assert.equal(check.prepare('SELECT COUNT(*) AS n FROM tenant_environment_events').get().n,count);check.close();}finally{f.close();}});
test('current admission: configuration-bound evidence rejects stale digest while caller-issued seals are always refused',async()=>{const f=fixture();try{await call(f,'scope',scope(),'manager');assert.equal((await submit(f,'scheduling',{...detail('scheduling'),configurationDigest:'prior-configuration'})).status,409);assert.equal((await submit(f,'identity-access',{...detail('identity-access'),_configurationValidation:{version:1}})).status,409);assert.equal(f.audit().evidence.length,0);}finally{f.close();}});

test('current admission: receipts accepted before first configuration cannot acquire its authority retroactively',async()=>{const f=fixture();try{for(const{key}of REQUIREMENTS)if(!['configuration-scope','time-policies','absence-policies'].includes(key))assert.equal((await submit(f,key)).status,200,key);const before=f.audit();assert.ok(before.evidence.every(x=>!JSON.parse(x.detail_json)._configurationValidation));const changed={...scope(),countries:['Germany'],sites:['Plant2'],erpSystem:'ERP-DE'};const captured=await call(f,'scope',changed,'manager');assert.equal(captured.body.operationalReady,false);assert.ok(captured.body.requirements.filter(x=>x.status==='REVALIDATION_REQUIRED').length>0);const capturedMap=new Map(captured.body.requirements.map(x=>[x.key,x]));assert.equal(capturedMap.get('tenant-environment').status,'REVALIDATION_REQUIRED');assert.equal(capturedMap.get('identity-access').satisfied,true);assert.equal(capturedMap.get('security-controls').satisfied,true);assert.deepEqual(f.audit().evidence,before.evidence);}finally{f.close();}});
test('current admission: unassociated activation cannot mutate scope or resurrect prior receipts',async()=>{
  const f=fixture();try{
    const d=new DatabaseSync(f.dbPath);d.prepare('UPDATE implementation_runs SET contract_ref_hash=? WHERE id=?').run(hash('review-existing-contract'),'run-review');d.close();
    await admitEvidenceComplete(f);const before=f.audit();
    for(const requested of [{...scope(),countries:['Germany'],sites:['Plant2'],erpSystem:'ERP-DE'},scope()]){
      const denied=await call(f,'contract-activated',{tenant:'review-alpha',contractRef:'review-existing-contract',recipientEmail:'synthetic@example.invalid',scope:requested});
      assert.equal(denied.status,409);assert.equal(denied.body.code,'LEGACY_WORKSPACE_ASSOCIATION_REQUIRED');
      assert.deepEqual(f.audit(),before,'Rejected activation must leave all durable state unchanged');
    }
  }finally{f.close();}
});


test('current admission: orchestration does not enter normal operation from evidence rows alone',async()=>{
  const f=fixture();try{
    const initial=await call(f,'scope',scope(),'manager');
    assert.equal(initial.status,201);
    let status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.orchestration.implementationComplete,false);
    assert.notEqual(status.body.orchestration.nextMode,'NORMAL_OPERATION');
    for(const{key}of REQUIREMENTS){
      if(key==='configuration-scope')continue;
      const d=detail(key);
      d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;
      const accepted=await submit(f,key,d);
      assert.equal(accepted.status,200,key);
    }
    status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.completedRequirements,REQUIREMENTS.length);
    assert.equal(status.body.operationalReady,false);
    assert.equal(status.body.orchestration.implementationComplete,false);
    assert.notEqual(status.body.orchestration.nextMode,'NORMAL_OPERATION');
    assert.ok(status.body.launchBoundary.blockers.includes('UNIFIED_INTEGRATION_TRUTH_UNPROVEN'));
  }finally{f.close();}
});

test('current admission: orchestration surfaces customer authority instead of pretending implementation is complete',async()=>{
  const f=fixture();try{
    const initial=await call(f,'scope',scope(),'manager');
    assert.equal(initial.status,201);
    for(const{key}of REQUIREMENTS){
      if(['configuration-scope','absence-policies'].includes(key))continue;
      const d=detail(key);
      d.configurationDigest=initial.body.tenantEnvironment.configurationDigest;
      assert.equal((await submit(f,key,d)).status,200,key);
    }
    const status=await call(f,'status',undefined,'manager');
    assert.equal(status.body.operationalReady,false);
    assert.equal(status.body.orchestration.implementationComplete,false);
    assert.equal(status.body.orchestration.customerActionRequired,true);
    assert.equal(status.body.orchestration.nextMode,'AWAITING_CUSTOMER_AUTHORITY');
    assert.ok(status.body.orchestration.awaitingExternalAuthority.some(x=>x.requirementKey==='absence-policies'));
  }finally{f.close();}
});

}
