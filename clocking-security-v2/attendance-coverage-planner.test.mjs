import test from 'node:test';
import assert from 'node:assert/strict';
import { planAutomaticAttendanceCoverage, applyAutomaticCoveragePlan } from './attendance-coverage-planner.mjs';

test('door entry/exit plus enterprise Wi-Fi yields a full automatic route',()=>{
 const r=planAutomaticAttendanceCoverage({
  workers:[{employee:'e1'}],
  discoveries:[
   {employee:'e1',sourceId:'door',domain:'physical_access',identityStrength:'assigned_badge',presenceQuality:'site_bound',supportsIn:true,supportsOut:true},
   {employee:'e1',sourceId:'wifi',domain:'network_auth',identityStrength:'user_8021x',presenceQuality:'site_bound',supportsIn:false,supportsOut:false,corroborates:true}
  ]
 });
 assert.equal(r.releaseTargetMet,true); assert.equal(r.automaticCoveragePct,100);
 assert.equal(r.plans[0].routes.some(x=>x.role==='anchor_in'),true);
 assert.equal(r.plans[0].routes.some(x=>x.role==='departure_anchor'),true);
 assert.equal(r.plans[0].routes.some(x=>x.role==='corroborator'),true);
});

test('existing authoritative T&A alone can cover the worker',()=>{
 const r=planAutomaticAttendanceCoverage({workers:[{employee:'e1'}],discoveries:[
  {employee:'e1',sourceId:'taa',domain:'legacy_taa',identityStrength:'exact_person',presenceQuality:'site_bound',supportsIn:true,supportsOut:true,authoritative:true}
 ]});
 assert.equal(r.releaseTargetMet,true); assert.equal(r.plans[0].basis,'authoritative_existing_source');
});

test('cloud SSO identity-only signal cannot masquerade as physical presence coverage',()=>{
 const r=planAutomaticAttendanceCoverage({workers:[{employee:'e1'}],discoveries:[
  {employee:'e1',sourceId:'sso',domain:'identity',identityStrength:'exact_person',presenceQuality:'identity_only',supportsIn:true,supportsOut:true}
 ]});
 assert.equal(r.releaseTargetMet,false); assert.deepEqual(r.gaps[0].missing,['IN_ANCHOR','OUT_ANCHOR','NO_STRONG_PERSON_BOUND_SIGNAL']);
});

test('shared credential is rejected from automatic coverage',()=>{
 const r=planAutomaticAttendanceCoverage({workers:[{employee:'e1'}],discoveries:[
  {employee:'e1',sourceId:'wifi',domain:'network_auth',identityStrength:'shared_psk',presenceQuality:'site_bound',supportsIn:true,supportsOut:true}
 ]});
 assert.equal(r.automaticReady,0); assert.equal(r.gaps[0].missing.includes('NO_STRONG_PERSON_BOUND_SIGNAL'),true);
});

test('one uncovered worker out of 2000 fails site release target and identifies exact person',()=>{
 const workers=Array.from({length:2000},(_,i)=>({employee:`e${i+1}`}));
 const discoveries=[];
 for(let i=1;i<=1999;i++){
  discoveries.push({employee:`e${i}`,sourceId:'door',domain:'physical_access',identityStrength:'assigned_badge',presenceQuality:'site_bound',supportsIn:true,supportsOut:true});
  discoveries.push({employee:`e${i}`,sourceId:'wifi',domain:'network_auth',identityStrength:'user_8021x',presenceQuality:'site_bound',corroborates:true});
 }
 const r=planAutomaticAttendanceCoverage({workers,discoveries});
 assert.equal(r.releaseTargetMet,false); assert.equal(r.automaticReady,1999); assert.equal(r.gaps.length,1); assert.equal(r.gaps[0].employee,'e2000');
});

test('planner output applies directly to coverage assurance without manual configuration',()=>{
 const calls=[];
 const coverage={setCoveragePlan(x){calls.push(x);}};
 const plan=planAutomaticAttendanceCoverage({workers:[{employee:'e1'}],discoveries:[
  {employee:'e1',sourceId:'door',domain:'physical_access',identityStrength:'assigned_badge',presenceQuality:'site_bound',supportsIn:true,supportsOut:true},
  {employee:'e1',sourceId:'wifi',domain:'network_auth',identityStrength:'managed_device_certificate',presenceQuality:'site_bound',corroborates:true}
 ]});
 const a=applyAutomaticCoveragePlan({coverage,tenant:'acme',site:'s1',plan});
 assert.deepEqual(a,{applied:1,gaps:0}); assert.equal(calls.length,1); assert.equal(calls[0].fallback,null);
});
