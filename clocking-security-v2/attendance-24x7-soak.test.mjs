import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';

const DAY=Date.parse('2026-09-18T00:00:00Z');
const SHIFT=8*60*60_000;

function makeSite(site,workersPerShift=150){
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:48*60*60_000});
  const coverage=new AttendanceCoverageAssurance({engine,startGraceMs:300_000,endGraceMs:300_000});
  const supervisor=new AttendanceSourceSupervisor({heartbeatSlaMs:60_000,lagWarningMs:10_000});
  for(const sourceId of ['door','wifi']){
    engine.registerSource({tenant:'acme',sourceId:`${site}-${sourceId}`,site,type:sourceId});
    supervisor.register({tenant:'acme',sourceId:`${site}-${sourceId}`,provider:sourceId,site,supportsBackfill:true,nowMs:DAY});
  }
  const employees=[];
  for(let i=0;i<workersPerShift;i++){
    const employee=`${site}-e${i+1}`; employees.push(employee);
    engine.registerPerson({tenant:'acme',employee,sites:[site]});
    coverage.setCoveragePlan({tenant:'acme',site,employee,routes:[
      {domain:'physical_access',sourceId:`${site}-door`,role:'anchor_in'},
      {domain:'physical_access',sourceId:`${site}-door`,role:'departure_anchor'},
      {domain:'network_auth',sourceId:`${site}-wifi`,role:'corroborator'}
    ]});
  }
  return {engine,coverage,supervisor,certifier:new AttendanceClaimCertifier({coverage}),employees};
}
function ingestShift({engine,site,employees,start,end,skipOut=null}){
  for(let i=0;i<employees.length;i++){
    const e=employees[i],j=i%1000;
    engine.ingest({tenant:'acme',sourceId:`${site}-door`,eventId:`${site}-d-in-${start}-${i}`,employee:e,kind:'access_entry',observedAt:new Date(start+j).toISOString(),receivedAtMs:start+60_000});
    engine.ingest({tenant:'acme',sourceId:`${site}-wifi`,eventId:`${site}-w-in-${start}-${i}`,employee:e,kind:'wifi_authenticated',observedAt:new Date(start+j+5000).toISOString(),receivedAtMs:start+60_000});
    if(e!==skipOut){
      engine.ingest({tenant:'acme',sourceId:`${site}-door`,eventId:`${site}-d-out-${start}-${i}`,employee:e,kind:'access_exit',observedAt:new Date(end-j).toISOString(),receivedAtMs:end+60_000});
      engine.ingest({tenant:'acme',sourceId:`${site}-wifi`,eventId:`${site}-w-out-${start}-${i}`,employee:e,kind:'wifi_disconnected',observedAt:new Date(end-j-5000).toISOString(),receivedAtMs:end+60_000});
    }
  }
}
function startWindow(supervisor,site,shiftId,start){
  for(const s of ['door','wifi']){
    const sourceId=`${site}-${s}`;
    supervisor.startCertificationWindow({tenant:'acme',sourceId,windowId:shiftId,startMs:start});
    supervisor.heartbeat({tenant:'acme',sourceId,atMs:start+1000});
  }
}
function health(supervisor,site,now){
  return ['door','wifi'].map(s=>supervisor.status({tenant:'acme',sourceId:`${site}-${s}`,nowMs:now}));
}

test('three sites x three shifts complete 24h with every worker accounted and certifiable',()=>{
  for(const site of ['s1','s2','s3']){
    const x=makeSite(site,150);
    for(let shiftNo=0;shiftNo<3;shiftNo++){
      const start=DAY+shiftNo*SHIFT,end=start+SHIFT,shiftId=`${site}-shift-${shiftNo+1}`;
      x.coverage.registerShift({tenant:'acme',site,shiftId,startAt:start,endAt:end,assignments:x.employees.map(employee=>({employee}))});
      startWindow(x.supervisor,site,shiftId,start);
      ingestShift({engine:x.engine,site,employees:x.employees,start,end});
      for(const s of ['door','wifi']) x.supervisor.heartbeat({tenant:'acme',sourceId:`${site}-${s}`,atMs:end+300_000});
      const r=x.certifier.certifyShift({tenant:'acme',site,shiftId,nowMs:end+301_000,expectedSourceIds:[`${site}-door`,`${site}-wifi`],sourceHealth:health(x.supervisor,site,end+301_000)});
      assert.equal(r.claimLevel,'PASSIVE_AND_VERIFIED_100',`${site} shift ${shiftNo+1}`);
      assert.equal(r.metrics.verifiedCompletenessPct,100);
      assert.equal(r.metrics.automaticCapturePct,100);
    }
  }
});

test('one missing OUT among 450 worker-shifts is surfaced exactly and prevents certification',()=>{
  const site='s4',x=makeSite(site,150);
  let missingEmployee=null;
  for(let shiftNo=0;shiftNo<3;shiftNo++){
    const start=DAY+shiftNo*SHIFT,end=start+SHIFT,shiftId=`${site}-shift-${shiftNo+1}`;
    x.coverage.registerShift({tenant:'acme',site,shiftId,startAt:start,endAt:end,assignments:x.employees.map(employee=>({employee}))});
    startWindow(x.supervisor,site,shiftId,start);
    if(shiftNo===2) missingEmployee=x.employees.at(-1);
    ingestShift({engine:x.engine,site,employees:x.employees,start,end,skipOut:shiftNo===2?missingEmployee:null});
    for(const s of ['door','wifi']) x.supervisor.heartbeat({tenant:'acme',sourceId:`${site}-${s}`,atMs:end+300_000});
    const r=x.certifier.certifyShift({tenant:'acme',site,shiftId,nowMs:end+301_000,expectedSourceIds:[`${site}-door`,`${site}-wifi`],sourceHealth:health(x.supervisor,site,end+301_000)});
    if(shiftNo<2) assert.equal(r.claimLevel,'PASSIVE_AND_VERIFIED_100');
    else {
      assert.equal(r.claimLevel,'NOT_CERTIFIED');
      const evaluation=x.coverage.evaluateShift({tenant:'acme',site,shiftId,nowMs:end+301_000});
      assert.equal(evaluation.unresolved,1);
      assert.equal(evaluation.rows.find(y=>y.employee===missingEmployee).status,'missing_out');
    }
  }
});

test('feed gap in one site revokes only that site shift until reconciliation completes',()=>{
  const a=makeSite('s5',20),b=makeSite('s6',20);
  for(const [site,x] of [['s5',a],['s6',b]]){
    const start=DAY,end=start+SHIFT,shiftId=`${site}-shift-1`;
    x.coverage.registerShift({tenant:'acme',site,shiftId,startAt:start,endAt:end,assignments:x.employees.map(employee=>({employee}))});
    startWindow(x.supervisor,site,shiftId,start); ingestShift({engine:x.engine,site,employees:x.employees,start,end});
    for(const s of ['door','wifi']) x.supervisor.heartbeat({tenant:'acme',sourceId:`${site}-${s}`,atMs:end+300_000});
  }
  a.supervisor.event({tenant:'acme',sourceId:'s5-wifi',providerEventId:'gap-a',observedAt:new Date(DAY+1000).toISOString(),receivedAtMs:DAY+2000,sequence:10});
  a.supervisor.event({tenant:'acme',sourceId:'s5-wifi',providerEventId:'gap-b',observedAt:new Date(DAY+3000).toISOString(),receivedAtMs:DAY+4000,sequence:12});
  let ra=a.certifier.certifyShift({tenant:'acme',site:'s5',shiftId:'s5-shift-1',nowMs:DAY+SHIFT+301_000,expectedSourceIds:['s5-door','s5-wifi'],sourceHealth:health(a.supervisor,'s5',DAY+SHIFT+301_000)});
  const rb=b.certifier.certifyShift({tenant:'acme',site:'s6',shiftId:'s6-shift-1',nowMs:DAY+SHIFT+301_000,expectedSourceIds:['s6-door','s6-wifi'],sourceHealth:health(b.supervisor,'s6',DAY+SHIFT+301_000)});
  assert.equal(ra.claimLevel,'NOT_CERTIFIED');
  assert.equal(rb.claimLevel,'PASSIVE_AND_VERIFIED_100');
  const [job]=a.supervisor.pendingRecovery({tenant:'acme',sourceId:'s5-wifi'}); a.supervisor.completeRecovery({jobId:job.jobId});
  ra=a.certifier.certifyShift({tenant:'acme',site:'s5',shiftId:'s5-shift-1',nowMs:DAY+SHIFT+301_000,expectedSourceIds:['s5-door','s5-wifi'],sourceHealth:health(a.supervisor,'s5',DAY+SHIFT+301_000)});
  assert.equal(ra.claimLevel,'PASSIVE_AND_VERIFIED_100');
});
