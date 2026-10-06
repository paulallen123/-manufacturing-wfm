'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createOneDayEnterpriseEngine } = require('./one-day-enterprise-engine.cjs');

const sha256 = value => createHash('sha256').update(String(value)).digest('hex');

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
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

function scopeFixture() {
  return {
    companyName: 'Alpha Manufacturing',
    countries: ['United Kingdom'],
    sites: ['Plant 1'],
    employeeCount: 100,
    sourceSystems: ['HCM'],
    features: ['Scheduling', 'Time & attendance'],
    workPatterns: ['Rotating shifts'],
    clockingMethods: ['Existing access control'],
    payrollSystem: 'Payroll provider',
    hcmSystem: 'HCM provider',
    erpSystem: 'ERP provider',
    agencyLabour: false,
    priorities: 'Safe zero-human implementation'
  };
}

function fixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-active-implementation-'));
  const dbPath = path.join(dir, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec(
    'CREATE TABLE tenants(id TEXT PRIMARY KEY, version INTEGER NOT NULL, state TEXT NOT NULL);' +
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT NOT NULL REFERENCES tenants(id),person_id TEXT NOT NULL,role TEXT NOT NULL,costs INTEGER NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,permissions TEXT NOT NULL DEFAULT \'[]\');' +
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT NOT NULL REFERENCES users(email),expires INTEGER NOT NULL);'
  );
  db.prepare('INSERT INTO tenants VALUES(?,?,?)').run('alpha', 1, '{}');
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)').run('manager@alpha', 'alpha', 'm1', 'manager', 1, 's', '00', JSON.stringify(['company.configure']));
  const token = 'm'.repeat(64);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha256(token), 'manager@alpha', Date.now() + 60_000);
  db.close();

  const engine = createOneDayEnterpriseEngine({
    dbPath,
    internalToken: 'worker-token',
    contractWebhookSecret: 'contract-token',
    invitationRecoverySecret: 'recovery-token',
    publicOrigin: 'https://implementation.test',
    sendInvitation: async () => ({ provider: 'test' }),
    ...options
  });
  return {
    dir,
    dbPath,
    engine,
    token,
    internal: { 'x-wfm-implementation-internal': 'worker-token' },
    close() {
      engine.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('unregistered workers cannot claim with the shared internal token or a claimed owner label', async () => {
  const f=fixture();
  try {
    const result=await call(f.engine,null,'POST','/api/implementation/autonomous/work/claim',
      {tenant:'alpha',runId:'not-needed',ownerId:'canonical-executor'},f.internal);
    assert.equal(result.status,503);
    assert.match(result.body.error,/registered|worker/i);
  } finally {f.close();}
});

test('work result authentication is checked before looking up a run', async () => {
  const f=fixture({workOwnerId:'canonical-executor',workOwnerToken:'w'.repeat(32),
    workOwnerTenant:'alpha',workOwnerRunId:'run-authorized'});
  try {
    const result=await call(f.engine,null,'POST','/api/implementation/autonomous/work/result',
      {tenant:'alpha',runId:'not-needed',ownerId:'canonical-executor'},
      {...f.internal,'x-wfm-implementation-worker':'incorrect'});
    assert.equal(result.status,403);
  } finally {f.close();}
});

test('registered worker routes enforce exact scope, private claim tokens and result ownership', async () => {
  const f=fixture(); let engine;
  try {
    const activated=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',
      {tenant:'alpha',contractRef:'worker-route',recipientEmail:'manager@alpha',scope:scopeFixture()},f.internal);
    assert.equal(activated.status,201);
    const runId=activated.body.implementation.runId;
    f.engine.close();
    const candidateSha='a'.repeat(40), deploymentId='deployment-a';
    engine=createOneDayEnterpriseEngine({dbPath:f.dbPath,internalToken:'worker-token',
      workOwnerId:'canonical-executor',workOwnerToken:'w'.repeat(32),workOwnerTenant:'alpha',workOwnerRunId:runId,
      candidateSha,deploymentId,requireCandidateBinding:true});
    const headers={...f.internal,'x-wfm-implementation-worker':'w'.repeat(32)};
    const body={runId,tenant:'alpha',candidateSha,deploymentId,requirementKey:'tenant-environment'};
    for(const changed of [{tenant:'other'},{runId:'other'},{candidateSha:'b'.repeat(40)},
      {deploymentId:'other'},{ownerId:'forged-worker'}]) {
      const refused=await call(engine,null,'POST','/api/implementation/autonomous/work/claim',{...body,...changed},headers);
      assert.equal(refused.status,409);
    }
    // Re-open the existing fixture job for one external execution attempt.
    const db=new DatabaseSync(f.dbPath);
    db.prepare("UPDATE implementation_work_jobs SET status='PENDING' WHERE run_id=? AND requirement_key='tenant-environment'").run(runId);
    db.close();
    const claim=await call(engine,null,'POST','/api/implementation/autonomous/work/claim',body,headers);
    assert.equal(claim.status,200);assert.equal(claim.body.job.ownerId,'canonical-executor');
    const job=claim.body.job;
    assert.match(job.leaseToken,/^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(claim.body.workPlan).includes(job.leaseToken),false);
    const duplicate=await call(engine,null,'POST','/api/implementation/autonomous/work/claim',body,headers);
    assert.equal(duplicate.body.job,null);
    const result={...body,jobId:job.id,intentDigest:job.intentDigest,fence:job.fence,leaseToken:job.leaseToken,
      outcome:'EFFECT_RECORDED',detail:{fixtureOnly:true}};
    const stale=await call(engine,null,'POST','/api/implementation/autonomous/work/result',{...result,fence:job.fence+1},headers);
    assert.equal(stale.status,409);
    const accepted=await call(engine,null,'POST','/api/implementation/autonomous/work/result',result,headers);
    assert.equal(accepted.status,409);
    assert.match(accepted.body.error,/execution route/i);
    const dbAfter=new DatabaseSync(f.dbPath);
    assert.equal(dbAfter.prepare('SELECT COUNT(*) count FROM implementation_work_receipts WHERE job_id=?').get(job.id).count,1);
    assert.equal(dbAfter.prepare('SELECT status FROM implementation_work_jobs WHERE id=?').get(job.id).status,'RUNNING');
    dbAfter.close();
  } finally {engine?.close();f.close();}
});

test('registered worker executes only its live fenced tenant-environment claim and awaits independent evidence', async () => {
  const f=fixture(); let engine;
  try {
    const activated=await call(f.engine,null,'POST','/api/implementation/autonomous/contract-activated',
      {tenant:'alpha',contractRef:'worker-execute',recipientEmail:'manager@alpha',scope:scopeFixture()},f.internal);
    const runId=activated.body.implementation.runId;
    const originalEnvironment=activated.body.implementation.tenantEnvironment;
    f.engine.close();
    const candidateSha='c'.repeat(40), deploymentId='deployment-c';
    engine=createOneDayEnterpriseEngine({dbPath:f.dbPath,internalToken:'worker-token',
      workOwnerId:'canonical-executor',workOwnerToken:'w'.repeat(32),workOwnerTenant:'alpha',workOwnerRunId:runId,
      candidateSha,deploymentId,requireCandidateBinding:true});
    const headers={...f.internal,'x-wfm-implementation-worker':'w'.repeat(32)};
    const binding={runId,tenant:'alpha',candidateSha,deploymentId,requirementKey:'tenant-environment'};
    let db=new DatabaseSync(f.dbPath);
    db.prepare("UPDATE implementation_work_jobs SET status='PENDING' WHERE run_id=? AND requirement_key='tenant-environment'").run(runId);
    const eventCountBefore=db.prepare('SELECT COUNT(*) count FROM tenant_environment_events WHERE tenant=?').get('alpha').count;
    const receiptCountBefore=db.prepare('SELECT COUNT(*) count FROM implementation_work_receipts').get().count;
    db.close();
    const claim=await call(engine,null,'POST','/api/implementation/autonomous/work/claim',binding,headers);
    const job=claim.body.job;
    const execute={...binding,jobId:job.id,intentDigest:job.intentDigest,
      fence:job.fence,leaseToken:job.leaseToken};
    for(const stale of [
      {...execute,fence:job.fence+1},
      {...execute,leaseToken:'0'.repeat(64)},
      {...execute,intentDigest:'0'.repeat(64)},
      {...execute,ownerId:'another-worker'},
      {...execute,candidateSha:'d'.repeat(40)},
      {...execute,deploymentId:'deployment-other'}
    ]) {
      const refused=await call(engine,null,'POST','/api/implementation/autonomous/work/execute',stale,headers);
      assert.equal(refused.status,409);
    }
    db=new DatabaseSync(f.dbPath);
    db.prepare('UPDATE implementation_work_jobs SET lease_until_ms=? WHERE id=?').run(Date.now()-1,job.id);
    db.close();
    assert.equal((await call(engine,null,'POST','/api/implementation/autonomous/work/execute',execute,headers)).status,409);
    db=new DatabaseSync(f.dbPath);
    db.prepare('UPDATE implementation_work_jobs SET lease_until_ms=? WHERE id=?').run(Date.now()+60_000,job.id);
    db.prepare('UPDATE implementation_scope SET scope_json=? WHERE run_id=?').run(
      JSON.stringify({...scopeFixture(),priorities:'Changed only inside the rolled-back effect'}),runId);
    db.exec("CREATE TRIGGER reject_worker_effect_receipt BEFORE INSERT ON implementation_work_receipts BEGIN SELECT RAISE(ABORT,'receipt rejected'); END;");
    db.close();
    assert.equal((await call(engine,null,'POST','/api/implementation/autonomous/work/execute',execute,headers)).status,500);
    db=new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT configuration_digest FROM tenant_environments WHERE tenant=?').get('alpha').configuration_digest,
      originalEnvironment.configurationDigest);
    assert.equal(db.prepare('SELECT status FROM implementation_work_jobs WHERE id=?').get(job.id).status,'RUNNING');
    db.exec('DROP TRIGGER reject_worker_effect_receipt');
    db.prepare('UPDATE implementation_scope SET scope_json=? WHERE run_id=?').run(JSON.stringify(scopeFixture()),runId);
    db.close();
    const executed=await call(engine,null,'POST','/api/implementation/autonomous/work/execute',execute,headers);
    assert.equal(executed.status,200);
    assert.equal(executed.body.revalidated,true);
    assert.equal(executed.body.environment.environmentId,originalEnvironment.environmentId);
    assert.equal(executed.body.environment.configurationDigest,originalEnvironment.configurationDigest);
    assert.equal(executed.body.result.job.status,'AWAITING_EVIDENCE');
    assert.equal(executed.body.evidenceRequired,true);
    assert.equal(executed.body.readiness.operationalReady,false);
    assert.equal(executed.body.readiness.requirements.find(x=>x.key==='tenant-environment').satisfied,false);
    db=new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM tenant_environment_events WHERE tenant=?').get('alpha').count,eventCountBefore);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM implementation_work_receipts').get().count,receiptCountBefore+1);
    db.close();
    // A completed claim is never executed again, even with its original token.
    assert.equal((await call(engine,null,'POST','/api/implementation/autonomous/work/execute',execute,headers)).status,409);
  } finally {engine?.close();f.close();}
});

test('trusted activation captures scope and autonomously provisions one tenant environment', async () => {
  const f = fixture();
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      {
        tenant: 'alpha',
        contractRef: 'scope-from-contract',
        targetHours: 8,
        recipientEmail: 'manager@alpha',
        scope: scopeFixture()
      },
      f.internal
    );
    assert.equal(activated.status, 201);
    assert.equal(activated.body.implementation.scopeCaptured, true);
    const config = activated.body.implementation.requirements.find(item => item.key === 'configuration-scope');
    assert.equal(config.satisfied, true);
    assert.equal(activated.body.implementation.tenantEnvironment.state, 'READY');
    assert.equal(activated.body.implementation.tenantEnvironment.runId, activated.body.implementation.runId);
    assert.match(activated.body.implementation.tenantEnvironment.environmentId, /^[0-9a-f-]{36}$/);

    const work = activated.body.implementation.workPlan;
    assert.equal(work.jobs.find(item => item.requirementKey === 'configuration-scope').status, 'SATISFIED');
    assert.equal(work.jobs.find(item => item.requirementKey === 'tenant-environment').status, 'AWAITING_EVIDENCE');

    const internalStatus = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/work/status',
      { runId: activated.body.implementation.runId, tenant: 'alpha' },
      f.internal
    );
    assert.equal(internalStatus.status, 200);
    assert.equal(
      internalStatus.body.tenantEnvironment.environmentId,
      activated.body.implementation.tenantEnvironment.environmentId
    );

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environments WHERE tenant=?').get('alpha').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environment_events WHERE tenant=?').get('alpha').count, 1);
    db.close();
  } finally {
    f.close();
  }
});

test('automated tenant environment effect remains unproven until independent evidence is recorded', async () => {
  const f = fixture();
  try {
    const request = {
      tenant: 'alpha',
      contractRef: 'effect-receipt-contract',
      targetHours: 8,
      recipientEmail: 'manager@alpha',
      scope: scopeFixture()
    };
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      request,
      f.internal
    );
    const runId = activated.body.implementation.runId;
    const environmentId = activated.body.implementation.tenantEnvironment.environmentId;
    assert.equal(
      activated.body.implementation.workPlan.jobs.find(item => item.requirementKey === 'tenant-environment').status,
      'AWAITING_EVIDENCE'
    );
    assert.equal(
      activated.body.implementation.requirements.find(item => item.key === 'tenant-environment').satisfied,
      false
    );

    const replay = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      request,
      f.internal
    );
    assert.equal(replay.status, 200);
    assert.equal(replay.body.implementation.tenantEnvironment.environmentId, environmentId);

    const db = new DatabaseSync(f.dbPath);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environments WHERE tenant=?').get('alpha').count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tenant_environment_events WHERE tenant=?').get('alpha').count, 1);
    db.close();

    const evidenced = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/evidence',
      {
        runId,
        kind: 'tenant-environment',
        status: 'PASS',
        confidence: 1,
        source: 'independent-verifier',
        detail: { checked: true }
      },
      f.internal
    );
    assert.equal(evidenced.status, 409);
    const unchanged = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/work/status',
      { runId, tenant: 'alpha' },
      f.internal
    );
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.requirements.find(item => item.key === 'tenant-environment').satisfied, false);
    assert.equal(
      unchanged.body.workPlan.jobs.find(item => item.requirementKey === 'tenant-environment').status,
      'AWAITING_EVIDENCE'
    );
    const evidenceDb = new DatabaseSync(f.dbPath);
    assert.equal(evidenceDb.prepare('SELECT COUNT(*) AS count FROM implementation_evidence WHERE run_id=? AND kind=?')
      .get(runId, 'tenant-environment').count, 0);
    evidenceDb.close();
  } finally {
    f.close();
  }
});


test('missing policy authority creates blocking questions and only complete authorised answers satisfy policy gates', async () => {
  const f = fixture();
  try {
    const activated = await call(
      f.engine, null, 'POST', '/api/implementation/autonomous/contract-activated',
      {
        tenant: 'alpha',
        contractRef: 'policy-authority-contract',
        targetHours: 8,
        recipientEmail: 'manager@alpha',
        scope: scopeFixture()
      },
      f.internal
    );
    const runId = activated.body.implementation.runId;
    const decisions = activated.body.implementation.decisions;
    assert.deepEqual(
      decisions.map(item => item.key).sort(),
      ['absence-policy-authority', 'time-policy-authority']
    );
    assert.ok(decisions.every(item => item.risk === 'HIGH' && item.status === 'PENDING'));
    const initialWork = activated.body.implementation.workPlan.jobs;
    assert.equal(initialWork.find(item => item.requirementKey === 'time-policies').status, 'BLOCKED_RESUMABLE');
    assert.equal(initialWork.find(item => item.requirementKey === 'absence-policies').status, 'BLOCKED_RESUMABLE');

    const incomplete = await call(
      f.engine, f.token, 'POST', '/api/implementation/autonomous/decision',
      {
        runId,
        key: 'time-policy-authority',
        action: 'ACCEPTED',
        detail: { authoritativeConfirmation: true, sourceRef: 'customer-policy/time-v1' }
      }
    );
    assert.equal(incomplete.status, 409);

    const time = await call(
      f.engine, f.token, 'POST', '/api/implementation/autonomous/decision',
      {
        runId,
        key: 'time-policy-authority',
        action: 'ACCEPTED',
        detail: {
          authoritativeConfirmation: true,
          sourceRef: 'customer-policy/time-v1',
          effectiveDate: '2026-01-01',
          unresolvedRules: 0,
          unknownPolicyFields: 0,
          breakRulesVerified: true,
          overtimeRulesVerified: true,
          workingTimeRulesVerified: true,
          timeZoneVerified: true
        }
      }
    );
    assert.equal(time.status, 200);
    assert.equal(time.body.requirements.find(item => item.key === 'time-policies').satisfied, true);
    assert.equal(
      time.body.requirements.find(item => item.key === 'time-policies').source,
      'customer-authorised-policy-confirmation'
    );

    const absence = await call(
      f.engine, f.token, 'POST', '/api/implementation/autonomous/decision',
      {
        runId,
        key: 'absence-policy-authority',
        action: 'ACCEPTED',
        detail: {
          authoritativeConfirmation: true,
          sourceRef: 'customer-policy/absence-v1',
          effectiveDate: '2026-01-01',
          unresolvedRules: 0,
          unknownPolicyFields: 0,
          leaveYearVerified: true,
          entitlementMethodVerified: true,
          approvalRulesVerified: true,
          absenceTypesVerified: true,
          usesOpeningBalance: false,
          openingBalanceFictional: false,
          openingBalanceSourceVerified: false
        }
      }
    );
    assert.equal(absence.status, 200);
    assert.equal(absence.body.requirements.find(item => item.key === 'absence-policies').satisfied, true);
    assert.equal(
      absence.body.requirements.find(item => item.key === 'absence-policies').source,
      'customer-authorised-policy-confirmation'
    );
    assert.equal(absence.body.blockingDecisions.length, 0);
    const finalWork = absence.body.workPlan.jobs;
    assert.equal(finalWork.find(item => item.requirementKey === 'time-policies').status, 'SATISFIED');
    assert.equal(finalWork.find(item => item.requirementKey === 'absence-policies').status, 'SATISFIED');
  } finally {
    f.close();
  }
});
