import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';

const T=Date.parse('2026-09-20T00:00:00Z');

function setup(){
  const s=new AttendanceSourceSupervisor({heartbeatSlaMs:60_000,lagWarningMs:10_000,authRefreshLeadMs:60_000});
  s.register({tenant:'acme',sourceId:'wifi',provider:'radius',site:'s1',supportsBackfill:true,nowMs:T});
  s.startCertificationWindow({tenant:'acme',sourceId:'wifi',windowId:'shift1',startMs:T});
  s.heartbeat({tenant:'acme',sourceId:'wifi',atMs:T+1_000});
  s.event({tenant:'acme',sourceId:'wifi',providerEventId:'before-disconnect',observedAt:new Date(T+2_000).toISOString(),receivedAtMs:T+2_100,sequence:10});
  s.disconnected({tenant:'acme',sourceId:'wifi',atMs:T+3_000});
  s.reconnected({tenant:'acme',sourceId:'wifi',atMs:T+8_000});
  return s;
}

test('reconnect recovery cannot be completed without bounded provider reconciliation proof',()=>{
  const s=setup();
  const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'});
  assert.equal(job.reason,'RECONNECT_RECONCILIATION');
  assert.equal(s.completeRecovery({jobId:job.jobId}),false);
  assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+8_001}).periodCoverageComplete,false);

  assert.equal(s.completeRecovery({jobId:job.jobId,reconciliationProof:{
    proofId:'radius-backfill-short',coverageFromMs:T+2_500,coverageToMs:T+8_000,completedAtMs:T+8_100
  }}),false);

  assert.equal(s.completeRecovery({jobId:job.jobId,reconciliationProof:{
    proofId:'radius-backfill-exact',coverageFromMs:T+2_000,coverageToMs:T+8_000,completedAtMs:T+8_100
  }}),true);
  assert.equal(s.status({tenant:'acme',sourceId:'wifi',nowMs:T+8_101}).periodCoverageComplete,true);
});

test('reconnect reconciliation proof must cover the entire recorded outage window',()=>{
  const s=setup();
  const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'});
  const tooEarly={proofId:'radius-backfill-early',coverageFromMs:T+2_000,coverageToMs:T+7_999,completedAtMs:T+8_100};
  const impossibleCompletion={proofId:'radius-backfill-time',coverageFromMs:T+2_000,coverageToMs:T+8_000,completedAtMs:T+7_999};
  assert.equal(s.completeRecovery({jobId:job.jobId,reconciliationProof:tooEarly}),false);
  assert.equal(s.completeRecovery({jobId:job.jobId,reconciliationProof:impossibleCompletion}),false);
  assert.equal(s.pendingRecovery({tenant:'acme',sourceId:'wifi'}).length,1);
});

test('persisted state cannot forge a completed reconnect reconciliation without proof',()=>{
  const s=setup();
  const state=s.exportState();
  state.recovery[0].status='complete';
  delete state.recovery[0].reconciliationProof;
  const restored=new AttendanceSourceSupervisor({heartbeatSlaMs:60_000,lagWarningMs:10_000,authRefreshLeadMs:60_000});
  assert.throws(()=>restored.restoreState(state),/Invalid persisted reconnect reconciliation evidence/);
});
