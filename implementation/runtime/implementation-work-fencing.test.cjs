'use strict';
// Synthetic SQLite controller regressions; never contacts VECTOR or any provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createImplementationWorkController } = require('./implementation-work-controller.cjs');
const binding = { candidateSha: 'a'.repeat(40), deploymentId: 'deployment-a' };
const run = { runId: 'run-a', tenant: 'tenant-a' };
const requirements = [{ key: 'safe-test-step', dependsOn: [] }];
function fixture(t, shared = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-fence-test-'));
  const dbPath = path.join(dir, 'state.sqlite');
  let now = 1_000;
  let controller;
  const db = new DatabaseSync(dbPath);
  const open = (identity = binding) => {
    controller?.close();
    controller = createImplementationWorkController({ ...(shared ? {db} : {dbPath}), requirements, clock: () => now,
      leaseMs: 1_000, retryDelayMs: 100, requireCandidateBinding: true, ...identity });
    return controller;
  };
  open();
  const reconcile = (version = 1, blocked = null) => controller.reconcile({ ...run,
    readiness: { requirements: [{ ...requirements[0], satisfied: false, detail: { version } }] },
    blockerFor: () => blocked });
  reconcile();
  t.after(() => { controller.close(); db.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  return { get c() { return controller; }, db, dbPath, open, reconcile,
    advance(ms) { now += ms; },
    claim(ownerId='worker-a') { return controller.claim({ ...run, requirementKey:'safe-test-step', ownerId }); },
    snapshot() { return JSON.stringify({ jobs: db.prepare('SELECT * FROM implementation_work_jobs').all(),
      receipts: db.prepare('SELECT * FROM implementation_work_receipts').all() }); }
  };
}
function resultFor(job, more={}) {
  return { ...run, jobId:job.id, intentDigest:job.intentDigest,
    ownerId:job.ownerId, fence:job.fence, leaseToken:job.leaseToken,
    detail:{ requestId:'effect-a' }, reason:'TEST_BLOCK', error:'TEST_FAILURE', ...more };
}
function refusalIsAtomic(f, fn) {
  const before = f.snapshot();
  assert.throws(fn, /owner|claim|fence|lease|stale|binding|not found|RUNNING/i);
  assert.equal(f.snapshot(), before, 'refusal must leave jobs and receipts unchanged');
}

test('local configuration effect cannot run after its claim expires', t => {
  const f=fixture(t, true); const job=f.claim(); f.advance(1000);
  f.db.exec('CREATE TABLE configuration(value TEXT)');
  assert.equal(typeof f.c.executeLocalEffect,'function');
  refusalIsAtomic(f,()=>f.c.executeLocalEffect(resultFor(job),()=>{
    f.db.prepare('INSERT INTO configuration VALUES(?)').run('unsafe');
    return {configurationDigest:'test'};
  }));
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM configuration').get().n,0);
});
test('local configuration and effect receipt commit or roll back together', t => {
  const f=fixture(t, true); const job=f.claim();
  f.db.exec('CREATE TABLE configuration(value TEXT)');
  f.db.exec("CREATE TRIGGER reject_effect BEFORE INSERT ON implementation_work_receipts BEGIN SELECT RAISE(ABORT,'receipt rejected'); END");
  assert.equal(typeof f.c.executeLocalEffect,'function');
  const effect=()=>{f.db.prepare('INSERT INTO configuration VALUES(?)').run('configured');return {configurationDigest:'test'};};
  assert.throws(()=>f.c.executeLocalEffect(resultFor(job),effect),/receipt rejected/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM configuration').get().n,0);
  assert.equal(f.c.plan(run.runId,run.tenant).jobs[0].status,'RUNNING');
  f.db.exec('DROP TRIGGER reject_effect');
  assert.equal(f.c.executeLocalEffect(resultFor(job),effect).job.status,'AWAITING_EVIDENCE');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM configuration').get().n,1);
  assert.throws(()=>f.c.executeLocalEffect(resultFor(job),effect),/RUNNING/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM configuration').get().n,1);
});

test('claim requires an explicit worker owner', t => {
  const f=fixture(t);
  refusalIsAtomic(f, () => f.c.claim(run));
});
for (const method of ['complete','block','fail']) {
  test(method+' rejects an unclaimed job', t => {
    const f=fixture(t); const job=f.c.plan(run.runId,run.tenant).jobs[0];
    refusalIsAtomic(f,()=>f.c[method](resultFor(job,{ownerId:'worker-a',fence:1,leaseToken:'x'.repeat(64)})));
  });
  test(method+' rejects the wrong worker owner', t => {
    const f=fixture(t); const job=f.claim();
    refusalIsAtomic(f,()=>f.c[method](resultFor(job,{ownerId:'worker-b'})));
  });
  test(method+' rejects a missing claim token', t => {
    const f=fixture(t); const job=f.claim();
    refusalIsAtomic(f,()=>f.c[method](resultFor(job,{leaseToken:undefined})));
  });
  test(method+' rejects at the exact lease-expiry boundary', t => {
    const f=fixture(t); const job=f.claim(); f.advance(1_000);
    refusalIsAtomic(f,()=>f.c[method](resultFor(job)));
  });
  test(method+' rejects the old attempt after another worker reclaims', t => {
    const f=fixture(t); const old=f.claim(); f.advance(1_001); f.reconcile(); const next=f.claim('worker-b');
    assert.equal(next.status,'RUNNING');
    refusalIsAtomic(f,()=>f.c[method](resultFor(old)));
  });
}
test('one live claim blocks a second database connection', t => {
  const f=fixture(t); const first=f.claim();
  assert.equal(first.status,'RUNNING');
  const other=createImplementationWorkController({dbPath:f.dbPath,requirements,clock:()=>1000,requireCandidateBinding:true,...binding});
  try { assert.equal(other.claim({...run,ownerId:'worker-b'}),null); }
  finally { other.close(); }
});
test('claim token is unique, hashed at rest and absent from status views', t => {
  const f=fixture(t); const job=f.claim();
  assert.match(job.leaseToken || '',/^[0-9a-f]{64}$/);
  assert.equal(job.ownerId,'worker-a'); assert.equal(job.fence,1);
  assert.ok(!JSON.stringify(f.c.plan(run.runId,run.tenant)).includes(job.leaseToken));
  assert.ok(!f.snapshot().includes(job.leaseToken));
});
test('current owner records an effect and duplicate receipt is read-only', t => {
  const f=fixture(t); const job=f.claim(); const args=resultFor(job);
  const done=f.c.complete(args);
  assert.equal(done.job.status,'AWAITING_EVIDENCE'); assert.equal(done.replayed,false);
  assert.ok(!JSON.stringify(done).includes(job.leaseToken || 'MISSING_TOKEN'));
  const before=f.snapshot(); f.advance(2_000);
  assert.equal(f.c.complete(args).replayed,true);
  assert.equal(f.snapshot(),before);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM implementation_work_receipts').get().n,1);
});
test('a different completion cannot overwrite an accepted effect', t => {
  const f=fixture(t); const job=f.claim(); f.c.complete(resultFor(job));
  refusalIsAtomic(f,()=>f.c.complete(resultFor(job,{detail:{requestId:'effect-b'}})));
});
test('a wrong owner cannot replay the accepted receipt', t => {
  const f=fixture(t); const job=f.claim(); f.c.complete(resultFor(job));
  refusalIsAtomic(f,()=>f.c.complete(resultFor(job,{ownerId:'worker-b'})));
});
test('fence increases across retries and intent resets', t => {
  const f=fixture(t); const a=f.claim(); f.c.fail(resultFor(a,{retryable:true}));
  f.advance(101); f.reconcile(); const b=f.claim(); assert.ok(b.fence>a.fence);
  f.reconcile(2); const c=f.claim(); assert.ok(c.fence>b.fence);
  assert.notEqual(a.leaseToken,b.leaseToken); assert.notEqual(b.leaseToken,c.leaseToken);
  refusalIsAtomic(f,()=>f.c.complete(resultFor(a)));
});
test('a valid claim survives controller restart without replacement', t => {
  const f=fixture(t); const a=f.claim(); f.open();
  assert.equal(f.c.complete(resultFor(a)).job.status,'AWAITING_EVIDENCE');
});
test('a claim from another deployment fails closed after restart', t => {
  const f=fixture(t); const a=f.claim(); f.open({...binding,deploymentId:'deployment-b'});
  refusalIsAtomic(f,()=>f.c.complete(resultFor(a)));
});
for(const field of ['tenant','runId']) {
  test('result rejects wrong '+field, t => {
    const f=fixture(t); const a=f.claim();
    refusalIsAtomic(f,()=>f.c.complete(resultFor(a,{[field]:'other'})));
  });
}
test('receipt insertion rolls back when state update fails', t => {
  const f=fixture(t); const a=f.claim();
  f.db.exec("CREATE TRIGGER stop_completion BEFORE UPDATE ON implementation_work_jobs WHEN NEW.status='AWAITING_EVIDENCE' BEGIN SELECT RAISE(ABORT,'TEST_STATE_WRITE_FAILURE'); END");
  const before=f.snapshot();
  assert.throws(()=>f.c.complete(resultFor(a)),/TEST_STATE_WRITE_FAILURE/);
  assert.equal(f.snapshot(),before);
});
test('lease expiry cannot turn missing policy authority into runnable work', t => {
  const f=fixture(t); f.claim(); f.advance(1_001);
  const plan=f.reconcile(1,'CUSTOMER_POLICY_AUTHORITY_REQUIRED');
  assert.equal(plan.jobs[0].status,'BLOCKED_RESUMABLE');
  assert.deepEqual(plan.runnable,[]);
});
test('a mismatched fence is rejected even with the correct token', t => {
  const f=fixture(t); const a=f.claim();
  refusalIsAtomic(f,()=>f.c.complete(resultFor(a,{fence:999})));
});
test('expired legacy RUNNING rows without ownership cannot complete', t => {
  const f=fixture(t); const job=f.c.plan(run.runId,run.tenant).jobs[0];
  f.db.prepare("UPDATE implementation_work_jobs SET status='RUNNING',lease_until_ms=10000 WHERE id=?").run(job.id);
  refusalIsAtomic(f,()=>f.c.complete(resultFor(job)));
});

for (const method of ['complete','block','fail']) {
  test(method+' rejects an incorrect token without changing state', t => {
    const f=fixture(t); const job=f.claim();
    refusalIsAtomic(f,()=>f.c[method](resultFor(job,{leaseToken:'0'.repeat(64)})));
  });
}
test('claim owner is mandatory and is not silently truncated', t => {
  const f=fixture(t);
  for(const ownerId of ['', ' ', 'x'.repeat(129), {}, 123]) {
    refusalIsAtomic(f,()=>f.c.claim({...run,ownerId}));
  }
});
test('public owner and fence do not authorize completion without the private token', t => {
  const f=fixture(t); f.claim(); const publicJob=f.c.plan(run.runId,run.tenant).jobs[0];
  refusalIsAtomic(f,()=>f.c.complete(resultFor(publicJob)));
});
test('a revoked policy invalidates even an unexpired claim', t => {
  const f=fixture(t); const a=f.claim();
  assert.equal(f.reconcile(1,'CUSTOMER_POLICY_AUTHORITY_REQUIRED').jobs[0].status,'BLOCKED_RESUMABLE');
  refusalIsAtomic(f,()=>f.c.complete(resultFor(a)));
});
test('a receipt failure preserves the original RUNNING lease', t => {
  const f=fixture(t); const a=f.claim();
  f.db.exec("CREATE TRIGGER stop_receipt BEFORE INSERT ON implementation_work_receipts BEGIN SELECT RAISE(ABORT,'TEST_RECEIPT_FAILURE'); END");
  const before=f.snapshot();
  assert.throws(()=>f.c.complete(resultFor(a)),/TEST_RECEIPT_FAILURE/);
  assert.equal(f.snapshot(),before);
});
test('six concurrent connections return exactly one winning claim', async t => {
  const {Worker}=require('node:worker_threads');
  const f=fixture(t);
  const ready=new Int32Array(new SharedArrayBuffer(8));
  const workers=[];
  const results=Array.from({length:6},(_,i)=>new Promise((resolve,reject)=> {
    const worker=new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {createImplementationWorkController}=require(workerData.modulePath);
      const signal=new Int32Array(workerData.signal);
      const controller=createImplementationWorkController({dbPath:workerData.dbPath,
        requirements:[{key:'safe-test-step',dependsOn:[]}],clock:()=>1000,...workerData.binding});
      Atomics.add(signal,0,1); parentPort.postMessage({ready:true});
      Atomics.wait(signal,1,0);
      const job=controller.claim({runId:'run-a',tenant:'tenant-a',ownerId:'worker-'+workerData.i});
      controller.close();parentPort.postMessage({done:true,job});
    `,{eval:true,workerData:{i,dbPath:f.dbPath,binding,
      modulePath:require.resolve('./implementation-work-controller.cjs'),signal:ready.buffer}});
    workers.push(worker);
    worker.on('message',msg=> {
      if(msg.ready && Atomics.load(ready,0)===6) {Atomics.store(ready,1,1);Atomics.notify(ready,1,6);}
      if(msg.done) resolve(msg.job);
    });
    worker.on('error',reject);
    worker.on('exit',code=>{if(code!==0)reject(new Error('worker exit '+code));});
  }));
  t.after(()=>Promise.all(workers.map(w=>w.terminate())));
  const jobs=await Promise.all(results);
  assert.equal(jobs.filter(Boolean).length,1);
  assert.equal(f.c.plan(run.runId,run.tenant).jobs[0].attempts,1);
});
