import test from 'node:test';
import assert from 'node:assert/strict';
import { planAutomaticAttendanceCoverage } from './attendance-coverage-planner.mjs';
import { AttendanceCoverageAssurance } from './attendance-coverage-assurance.mjs';

const T=Date.parse('2026-09-20T10:00:00Z');

test('planner cannot treat two domains from one logical source as independent automatic coverage',()=>{
  const result=planAutomaticAttendanceCoverage({
    workers:[{employee:'e1'}],
    discoveries:[
      {employee:'e1',sourceId:'mux',domain:'physical_access',identityStrength:'exact_person',presenceQuality:'site_bound',supportsIn:true,supportsOut:true},
      {employee:'e1',sourceId:'mux',domain:'network_auth',identityStrength:'exact_person',presenceQuality:'site_bound',corroborates:true}
    ]
  });
  assert.equal(result.releaseTargetMet,false);
  assert.equal(result.automaticReady,0);
  assert.deepEqual(result.gaps[0].missing,['INDEPENDENT_SOURCE']);
});

test('coverage preflight cannot green a manually configured one-source multi-domain route',()=>{
  const coverage=new AttendanceCoverageAssurance({engine:{}});
  coverage.registerShift({
    tenant:'acme',site:'s1',shiftId:'day',
    startAt:new Date(T).toISOString(),
    endAt:new Date(T+8*60*60_000).toISOString(),
    assignments:[{employee:'e1'}]
  });
  coverage.setCoveragePlan({
    tenant:'acme',site:'s1',employee:'e1',
    routes:[
      {domain:'physical_access',sourceId:'mux',role:'anchor_in'},
      {domain:'physical_access',sourceId:'mux',role:'departure_anchor'},
      {domain:'network_auth',sourceId:'mux',role:'corroborator'}
    ]
  });
  const result=coverage.preflight({tenant:'acme',site:'s1',shiftId:'day'});
  assert.equal(result.releaseTargetMet,false);
  assert.equal(result.automaticReady,0);
  assert.equal(result.rows[0].inReady,false);
  assert.equal(result.rows[0].outReady,false);
  assert.deepEqual(result.rows[0].sourceIds,['mux']);
});

test('two genuinely distinct sources across independent domains remain automatic-ready',()=>{
  const result=planAutomaticAttendanceCoverage({
    workers:[{employee:'e1'}],
    discoveries:[
      {employee:'e1',sourceId:'door',domain:'physical_access',identityStrength:'assigned_badge',presenceQuality:'site_bound',supportsIn:true,supportsOut:true},
      {employee:'e1',sourceId:'wifi',domain:'network_auth',identityStrength:'user_8021x',presenceQuality:'site_bound',corroborates:true}
    ]
  });
  assert.equal(result.releaseTargetMet,true);
  assert.equal(result.automaticReady,1);
  assert.equal(new Set(result.plans[0].routes.map(r=>r.sourceId)).size,2);
});
