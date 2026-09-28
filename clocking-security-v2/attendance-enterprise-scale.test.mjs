import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { AutomaticAttendanceEvidenceEngine } from './invisible-attendance-engine.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';
import { AttendanceClaimCertifier } from './attendance-certification.mjs';
import { AttendanceSourceSupervisor } from './attendance-source-supervisor.mjs';

const TENANT='enterprise';
const START=Date.parse('2026-09-18T00:00:00Z');
const SHIFT=8*60*60_000;
const SITE_COUNT=50;
const WORKERS_PER_SITE=200;

test('10,000 employees across 50 sites complete three 8h shifts with isolated 100% certification',()=>{
  const engine=new AutomaticAttendanceEvidenceEngine({corroborationWindowMs:120_000,maxOfflineAgeMs:48*60*60_000});
  const coverage=new AttendanceCoverageAssurance({engine,startGraceMs:300_000,endGraceMs:300_000});
  const supervisor=new AttendanceSourceSupervisor({heartbeatSlaMs:60_000,lagWarningMs:10_000});
  const certifier=new AttendanceClaimCertifier({coverage});

  const sites=[];
  for(let s=0;s<SITE_COUNT;s++){
    const site=`site-${String(s+1).padStart(2,'0')}`;
    const door=`${site}-door`,wifi=`${site}-wifi`;
    engine.registerSource({tenant:TENANT,sourceId:door,site,type:'access'});
    engine.registerSource({tenant:TENANT,sourceId:wifi,site,type:'radius'});
    supervisor.register({tenant:TENANT,sourceId:door,provider:'access',site,supportsBackfill:true,nowMs:START});
    supervisor.register({tenant:TENANT,sourceId:wifi,provider:'radius',site,supportsBackfill:true,nowMs:START});
    const employees=[];
    for(let w=0;w<WORKERS_PER_SITE;w++){
      const employee=`${site}-e${String(w+1).padStart(3,'0')}`;
      employees.push(employee);
      engine.registerPerson({tenant:TENANT,employee,sites:[site]});
      coverage.setCoveragePlan({tenant:TENANT,site,employee,routes:[
        {domain:'physical_access',sourceId:door,role:'anchor_in'},
        {domain:'physical_access',sourceId:door,role:'departure_anchor'},
        {domain:'network_auth',sourceId:wifi,role:'corroborator'}
      ]});
    }
    sites.push({site,door,wifi,employees});
  }
  assert.equal(sites.reduce((n,x)=>n+x.employees.length,0),10_000);

  let decisionEngineMs=0,events=0,certifiedWorkerShifts=0;
  for(let shiftNo=0;shiftNo<3;shiftNo++){
    const start=START+shiftNo*SHIFT,end=start+SHIFT;
    for(const x of sites){
      const shiftId=`${x.site}-shift-${shiftNo+1}`;
      coverage.registerShift({tenant:TENANT,site:x.site,shiftId,startAt:start,endAt:end,assignments:x.employees.map(employee=>({employee}))});
      for(const sourceId of [x.door,x.wifi]){
        supervisor.startCertificationWindow({tenant:TENANT,sourceId,windowId:shiftId,startMs:start});
        supervisor.heartbeat({tenant:TENANT,sourceId,atMs:start+1000});
      }

      const t0=performance.now();
      for(let i=0;i<x.employees.length;i++){
        const employee=x.employees[i],j=i%1000;
        engine.ingest({tenant:TENANT,sourceId:x.door,eventId:`${x.site}-d-in-${shiftNo}-${i}`,employee,kind:'access_entry',observedAt:new Date(start+j).toISOString(),receivedAtMs:start+60_000});
        engine.ingest({tenant:TENANT,sourceId:x.wifi,eventId:`${x.site}-w-in-${shiftNo}-${i}`,employee,kind:'wifi_authenticated',observedAt:new Date(start+j+5000).toISOString(),receivedAtMs:start+60_000});
        engine.ingest({tenant:TENANT,sourceId:x.door,eventId:`${x.site}-d-out-${shiftNo}-${i}`,employee,kind:'access_exit',observedAt:new Date(end-j).toISOString(),receivedAtMs:end+60_000});
        engine.ingest({tenant:TENANT,sourceId:x.wifi,eventId:`${x.site}-w-out-${shiftNo}-${i}`,employee,kind:'wifi_disconnected',observedAt:new Date(end-j-5000).toISOString(),receivedAtMs:end+60_000});
        events+=4;
      }
      decisionEngineMs+=performance.now()-t0;

      for(const sourceId of [x.door,x.wifi]) supervisor.heartbeat({tenant:TENANT,sourceId,atMs:end+300_000});
      const sourceHealth=[x.door,x.wifi].map(sourceId=>supervisor.status({tenant:TENANT,sourceId,nowMs:end+301_000}));
      const result=certifier.certifyShift({tenant:TENANT,site:x.site,shiftId,nowMs:end+301_000,expectedSourceIds:[x.door,x.wifi],sourceHealth});
      assert.equal(result.claimLevel,'PASSIVE_AND_VERIFIED_100',`${x.site} shift ${shiftNo+1}`);
      assert.equal(result.metrics.verifiedCompletenessPct,100);
      assert.equal(result.metrics.automaticCapturePct,100);
      certifiedWorkerShifts+=x.employees.length;
    }
  }

  assert.equal(events,120_000);
  assert.equal(certifiedWorkerShifts,30_000);
  assert(Number.isFinite(decisionEngineMs)&&decisionEngineMs>0);
  console.log(JSON.stringify({
    metric:'attendance-decision-engine-synthetic',
    scope:{employees:10_000,sites:50,shifts:3,events},
    decisionEngineMs:Number(decisionEngineMs.toFixed(3)),
    averageDecisionEngineMicros:Number((decisionEngineMs*1000/events).toFixed(3)),
    providerNetworkLatencyIncluded:false
  }));
});
