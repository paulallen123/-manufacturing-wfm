import test from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';

const T=Date.parse('2026-09-18T06:00:00Z');
const coverage={
 preflight(){return {releaseTargetMet:true,automaticCoveragePct:100,partial:[],uncovered:[]};},
 evaluateShift(){return {rows:[{employee:'e1',status:'complete'}],totalScheduled:1,payrollReady:true,unresolved:0,unexpectedCount:0,unmappedSignalCount:0};}
};
function supervisor(){
 const s=new AttendanceSourceSupervisor({heartbeatSlaMs:10_000});
 for(const sourceId of ['door','wifi']){
  s.register({tenant:'acme',sourceId,provider:sourceId,site:'s1',supportsBackfill:true,nowMs:T});
  s.startCertificationWindow({tenant:'acme',sourceId,windowId:'shift1',startMs:T});
  s.heartbeat({tenant:'acme',sourceId,atMs:T+1000});
 }
 return s;
}
function health(s,now){return ['door','wifi'].map(sourceId=>s.status({tenant:'acme',sourceId,nowMs:now}));}

test('sequence gap revokes 100% certificate until reconciliation completes',()=>{
 const s=supervisor(); const c=new AttendanceClaimCertifier({coverage});
 assert.equal(c.certifyShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T+2000,expectedSourceIds:['door','wifi'],sourceHealth:health(s,T+2000)}).claimLevel,'PASSIVE_AND_VERIFIED_100');
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'w1',observedAt:new Date(T+2100).toISOString(),receivedAtMs:T+2200,sequence:10});
 s.event({tenant:'acme',sourceId:'wifi',providerEventId:'w2',observedAt:new Date(T+2300).toISOString(),receivedAtMs:T+2400,sequence:12});
 let r=c.certifyShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T+2500,expectedSourceIds:['door','wifi'],sourceHealth:health(s,T+2500)});
 assert.equal(r.claimLevel,'NOT_CERTIFIED');
 const [job]=s.pendingRecovery({tenant:'acme',sourceId:'wifi'}); s.completeRecovery({jobId:job.jobId});
 r=c.certifyShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T+2500,expectedSourceIds:['door','wifi'],sourceHealth:health(s,T+2500)});
 assert.equal(r.claimLevel,'PASSIVE_AND_VERIFIED_100');
});

test('stale evidence feed revokes live and period 100% certification',()=>{
 const s=supervisor(); const c=new AttendanceClaimCertifier({coverage});
 const r=c.certifyShift({tenant:'acme',site:'s1',shiftId:'shift1',nowMs:T+20_000,expectedSourceIds:['door','wifi'],sourceHealth:health(s,T+20_000)});
 assert.equal(r.claimLevel,'NOT_CERTIFIED');
 assert.equal(r.blockers.some(x=>x.code==='SOURCE_NOT_HEALTHY'),true);
});
