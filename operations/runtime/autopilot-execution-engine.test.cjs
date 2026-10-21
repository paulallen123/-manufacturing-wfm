'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{createDecisionEpisode}=require('./decision-episode.cjs'),{createAutopilotExecutionEngine,safePlan}=require('./autopilot-execution-engine.cjs');
function ep(){return createDecisionEpisode({tenant:'A',site:'S1',decisionType:'absence-recovery',triggerId:'a1',triggeredAt:'2026-09-22T09:00:00Z',contextRevision:'r7',mode:'SHADOW',sourceEvidence:['a','b'],objective:{labourCost:1,planAttainmentPct:1,uncertaintyPenalty:.1},options:[{id:'do-nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:500,planAttainmentPct:80}},{id:'overtime',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:.1,prediction:{labourCost:300,planAttainmentPct:95}}]});}
function setup(adapter){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,PRIMARY KEY(tenant,episode_id));CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');const e=ep();db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run('A',e.episodeId,e.decisionType,JSON.stringify(e),new Date().toISOString());db.close();return{dir,e,engine:createAutopilotExecutionEngine({dbPath,lifecycleAdapter:adapter})};}
function plan(){return{adapter:'workforce-lifecycle',reversible:true,action:{eventKey:'ot',kind:'OVERTIME_OVERRIDE',employeeId:'E1',effectiveAt:'2026-09-22T12:00:00Z',payload:{minutes:60}},rollback:{eventKey:'rb',reason:'restore'}};}
test('rejects nonstring operational identifiers and rollback reason before issuing a permit',()=>{
 const changes=[
  p=>{p.adapter=['workforce-lifecycle'];},
  p=>{p.action.kind=['OVERTIME_OVERRIDE'];},
  p=>{p.action.employeeId={id:'E1'};},
  p=>{p.action.effectiveAt=new Date('2026-09-22T12:00:00Z');},
  p=>{p.action.eventKey=['ot'];},
  p=>{p.action.eventKey=null;},
  p=>{p.rollback.eventKey=['rb'];},
  p=>{p.rollback.reason={text:'restore'};}
 ];
 const s=setup({});try{
  for(const change of changes){
   const p=plan();change(p);
   assert.throws(()=>safePlan(p),/string|unsupported/i);
   assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:p}),/string|unsupported/i);
  }
  const db=new DatabaseSync(path.join(s.dir,'x.db'));
  assert.equal(db.prepare('SELECT count(*) AS n FROM vector_autopilot_permits').get().n,0);
  db.close();
 }finally{s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});}
});
test('cold-starts on a fresh database without pre-created decision tables',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ap-cold-')),dbPath=path.join(dir,'x.db'),db=new DatabaseSync(dbPath);db.exec('CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');db.close();const engine=createAutopilotExecutionEngine({dbPath,lifecycleAdapter:{}});const verify=new DatabaseSync(dbPath);const row=verify.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vector_decision_episodes'").get();assert.equal(row?.name,'vector_decision_episodes');verify.close();engine.close();fs.rmSync(dir,{recursive:true,force:true});});
test('requires current context and reversible plan',()=>{const s=setup({});assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'old',plan:plan()}),/context changed/i);assert.throws(()=>s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:{...plan(),reversible:false}}),/reversible/);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('executes verifies and is idempotent',async()=>{const m=new Map(),a={applyTrustedEvent({eventKey}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'}),r2=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'VERIFIED');assert.equal(r2.idempotent,true);s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});
test('failed verification rolls back or contains',async()=>{const m=new Map();let fail=true;const a={applyTrustedEvent({eventKey,event}){const x={event:{id:'wf-'+eventKey,eventKey,status:'ACCEPTED'},decision:{status:'ACCEPTED',reasonCode:'OK'}};m.set(eventKey,x.event);return x;},getTrustedEvent({eventKey}){if(eventKey==='ot'&&fail){fail=false;return null;}return m.get(eventKey)||null;}};const s=setup(a),p=s.engine.issueHumanPermit({tenant:'A',episodeId:s.e.episodeId,optionId:'overtime',actorRef:'m',contextRevision:'r7',plan:plan()}),r=await s.engine.executePermit({tenant:'A',permitId:p.permitId,currentContextRevision:'r7'});assert.equal(r.state,'ROLLED_BACK');s.engine.close();fs.rmSync(s.dir,{recursive:true,force:true});});

// PR453 containment cases, corrected to require honest unknown-outcome handling.
// Kept in this existing image-admitted suite so the release gate cannot omit them.
{
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDecisionEpisode } = require('./decision-episode.cjs');
const { createAutopilotExecutionEngine } = require('./autopilot-execution-engine.cjs');

function setup(adapter) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vector-ap-containment-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE vector_decision_episodes(tenant TEXT,episode_id TEXT,decision_type TEXT,episode_json TEXT,created_at TEXT,PRIMARY KEY(tenant,episode_id));'+
    'CREATE TABLE users(email TEXT PRIMARY KEY,tenant TEXT,role TEXT);'+
    'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,email TEXT,expires INTEGER);');
  const episode = createDecisionEpisode({ tenant: 'synthetic-tenant', site: 'synthetic-site',
    decisionType: 'absence-recovery', triggerId: 'synthetic-trigger',
    triggeredAt: '2026-10-13T10:00:00Z', contextRevision: 'r1', mode: 'SHADOW',
    sourceEvidence: ['synthetic-evidence'], objective: { labourCost: 1 },
    options: [{ id: 'do-nothing', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: 0, prediction: { labourCost: 2 } },
    { id: 'overtime', feasible: true, policyAllowed: true, hardConstraintsPassed: true,
      uncertainty: 0, prediction: { labourCost: 1 } }] });
  db.prepare('INSERT INTO vector_decision_episodes VALUES(?,?,?,?,?)').run(
    episode.tenant, episode.episodeId, episode.decisionType, JSON.stringify(episode), new Date().toISOString());
  db.close();
  const engine = createAutopilotExecutionEngine({ dbPath, lifecycleAdapter: adapter });
  const permit = engine.issueHumanPermit({ tenant: episode.tenant, episodeId: episode.episodeId,
    optionId: 'overtime', actorRef: 'synthetic-manager', contextRevision: 'r1',
    plan: { adapter: 'workforce-lifecycle', reversible: true,
      action: { eventKey: 'synthetic-action', kind: 'OVERTIME_OVERRIDE', employeeId: 'synthetic-worker',
        effectiveAt: '2026-10-13T12:00:00Z', payload: { minutes: 30 } },
      rollback: { eventKey: 'synthetic-rollback', reason: 'synthetic compensation' } } });
  return { dir, dbPath, engine, permit, tenant: episode.tenant,
    close() { engine.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('failed apply requires reconciliation when trusted readback is unavailable and stays idempotent', async () => {
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) { calls.push(eventKey); throw new Error('synthetic adapter outage'); },
    getTrustedEvent() { calls.push('read:synthetic-action'); throw new Error('synthetic readback outage'); } });
  try {
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const first = await sample.engine.executePermit(args);
    const retry = await sample.engine.executePermit(args);
    assert.equal(first.state, 'RECONCILIATION_REQUIRED');
    assert.equal(first.detail.reason, 'APPLY_OUTCOME_UNKNOWN');
    assert.equal(first.detail.externalState, 'UNKNOWN');
    assert.equal(retry.idempotent, true);
    assert.equal(retry.state, 'RECONCILIATION_REQUIRED');
    assert.deepEqual(calls, ['synthetic-action', 'read:synthetic-action']);
    assert.deepEqual(sample.engine.statusForTenant(sample.tenant).map(x => x.state),
      ['RECONCILIATION_REQUIRED', 'VERIFY_FAILED', 'PREPARED']);
  } finally { sample.close(); }
});

test('failed compensating rollback requires reconciliation and never claims containment', async () => {
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) {
    calls.push(eventKey);
    if (eventKey === 'synthetic-rollback') throw new Error('synthetic rollback outage');
    return { event: { id: 'wf-action' }, decision: { status: 'ACCEPTED' } };
  }, getTrustedEvent({ eventKey }) { calls.push(`read:${eventKey}`); return null; } });
  try {
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const first = await sample.engine.executePermit(args);
    const retry = await sample.engine.executePermit(args);
    assert.equal(first.state, 'RECONCILIATION_REQUIRED');
    assert.equal(first.detail.reason, 'ROLLBACK_UNCONFIRMED');
    assert.equal(retry.idempotent, true);
    assert.equal(retry.state, 'RECONCILIATION_REQUIRED');
    assert.deepEqual(calls, ['synthetic-action', 'read:synthetic-action', 'synthetic-rollback']);
    assert.deepEqual(sample.engine.statusForTenant(sample.tenant).map(x => x.state),
      ['RECONCILIATION_REQUIRED', 'VERIFY_FAILED', 'APPLIED', 'PREPARED']);
  } finally { sample.close(); }
});

test('post-write throw reads authoritative action and preserves readback evidence without claiming action success', async () => {
  const persisted = new Map();
  const calls = [];
  const sample = setup({ applyTrustedEvent({ eventKey }) {
    calls.push(eventKey);
    persisted.set(eventKey, { id: 'wf-action', status: 'ACCEPTED' });
    throw new Error('synthetic response lost after lifecycle insert');
  }, getTrustedEvent({ eventKey }) { calls.push(`read:${eventKey}`); return persisted.get(eventKey); } });
  try {
    const result = await sample.engine.executePermit({ tenant: sample.tenant,
      permitId: sample.permit.permitId, currentContextRevision: 'r1' });
    assert.equal(result.state, 'RECONCILIATION_REQUIRED');
    assert.equal(result.detail.reason, 'APPLY_OUTCOME_UNKNOWN');
    assert.equal(result.detail.externalState, 'UNKNOWN');
    assert.equal(result.detail.observedEventId, 'wf-action');
    assert.equal(persisted.get('synthetic-action').status, 'ACCEPTED');
    assert.deepEqual(calls, ['synthetic-action', 'read:synthetic-action']);
    assert.equal(persisted.has('synthetic-rollback'), false);
    sample.engine.close();
    const reopened = createAutopilotExecutionEngine({ dbPath: sample.dbPath, lifecycleAdapter: { applyTrustedEvent() { throw new Error('must never repeat unknown execution'); } } });
    try {
      const retry = await reopened.executePermit({ tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' });
      assert.equal(retry.state, 'RECONCILIATION_REQUIRED');
      assert.equal(retry.idempotent, true);
      assert.equal(retry.detail.externalState, 'UNKNOWN');
    } finally { reopened.close(); }
  } finally { sample.close(); }
});

for (const thrown of [null, undefined]) {
  test(`non-Error apply throw ${String(thrown)} persists unknown outcome and cannot replay`, async () => {
    let applies = 0;
    const sample = setup({ applyTrustedEvent() { applies++; throw thrown; }, getTrustedEvent() { return null; } });
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    try {
      const result = await sample.engine.executePermit(args);
      assert.equal(result.state, 'RECONCILIATION_REQUIRED');
      sample.engine.close();
      const reopened = createAutopilotExecutionEngine({ dbPath: sample.dbPath, lifecycleAdapter: { applyTrustedEvent() { applies++; throw thrown; } } });
      try {
        const retry = await reopened.executePermit(args);
        assert.equal(retry.state, 'RECONCILIATION_REQUIRED');
        assert.equal(retry.idempotent, true);
        assert.equal(applies, 1);
      } finally { reopened.close(); }
    } finally { sample.close(); }
  });
}

test('non-Error rollback throw persists reconciliation state without repeating mutation', async () => {
  let applies = 0;
  const sample = setup({ applyTrustedEvent({ eventKey }) {
    applies++;
    if (eventKey === 'synthetic-rollback') throw null;
    return { event: { id: 'wf-action' }, decision: { status: 'ACCEPTED' } };
  }, getTrustedEvent() { return null; } });
  try {
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const first = await sample.engine.executePermit(args);
    const retry = await sample.engine.executePermit(args);
    assert.equal(first.state, 'RECONCILIATION_REQUIRED');
    assert.equal(first.detail.reason, 'ROLLBACK_UNCONFIRMED');
    assert.equal(retry.idempotent, true);
    assert.equal(applies, 2);
  } finally { sample.close(); }
});

for (const interruptedState of ['PREPARED', 'APPLIED']) {
  test(`worker death at ${interruptedState} cannot repeat a possibly applied write`, async () => {
    const sample = setup({});
    const args = { tenant: sample.tenant, permitId: sample.permit.permitId, currentContextRevision: 'r1' };
    const marker = path.join(sample.dir, 'external-write-count.txt');
    sample.engine.close();
    const script = `
      const fs = require('node:fs');
      const { createAutopilotExecutionEngine } = require(${JSON.stringify(require.resolve('./autopilot-execution-engine.cjs'))});
      const engine = createAutopilotExecutionEngine({ dbPath: ${JSON.stringify(sample.dbPath)}, lifecycleAdapter: {
        applyTrustedEvent() {
          fs.appendFileSync(${JSON.stringify(marker)}, 'write\\n');
          if (${JSON.stringify(interruptedState)} === 'PREPARED') process.exit(19);
          return { event: { id: 'persisted-event' }, decision: { status: 'ACCEPTED' } };
        },
        getTrustedEvent() { process.exit(19); }
      } });
      engine.executePermit(${JSON.stringify(args)}).catch(() => process.exit(20));
    `;
    const child = require('node:child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(child.status, 19, child.stderr);
    let repeatWrites = 0;
    const reopened = createAutopilotExecutionEngine({ dbPath: sample.dbPath, lifecycleAdapter: {
      applyTrustedEvent() { repeatWrites++; fs.appendFileSync(marker, 'write\n'); return { event: { id: 'repeated-event' }, decision: { status: 'ACCEPTED' } }; },
      getTrustedEvent() { return { id: 'repeated-event', status: 'ACCEPTED' }; }
    } });
    try {
      assert.equal(reopened.statusForTenant(sample.tenant)[0].state, interruptedState);
      const result = await reopened.executePermit(args);
      const retry = await reopened.executePermit(args);
      assert.equal(repeatWrites, 0, 'reopening must not dispatch another write');
      assert.equal(result.state, 'RECONCILIATION_REQUIRED');
      assert.equal(result.detail.reason, 'INTERRUPTED_EXECUTION');
      assert.equal(result.detail.externalState, 'UNKNOWN');
      assert.equal(result.detail.interruptedState, interruptedState);
      assert.equal(retry.state, 'RECONCILIATION_REQUIRED');
      assert.equal(retry.idempotent, true);
      assert.equal(repeatWrites, 0);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'write\n');
    } finally { reopened.close(); sample.close(); }
  });
}
}
