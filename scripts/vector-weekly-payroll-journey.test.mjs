import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  nextWeeklyAction,
  verifyPayrollReady,
  verifyReleasedPayroll,
  buildSyntheticWorkedResolution
} from './vector-weekly-payroll-journey.mjs';

const team = (overrides={}) => ({
  id:'s1', name:'CNC', status:'reviewing', revision:4, canSign:false,
  issues:[], categories:[], employees:[], records:[], blockers:[], ...overrides
});
const report = teams => ({period:'2026-09-07',teams});

test('resolves the first open issue before any verification or signing',()=>{
  const t=team({issues:[{id:'i1',type:'adjustment',status:'open',row:'r1',employee:'e1',proposed:{clockOut:'2026-09-09T13:30:00.000Z'},evidence:'Synthetic fixture correction'}],records:[{id:'r1',date:'2026-09-09',raw:{clockIn:'2026-09-09T05:00:00.000Z',clockOut:'2026-09-09T13:00:00.000Z'}}],categories:[{id:'adjustments',confirmed:false,open:1}],employees:[{id:'e1',checked:false}]});
  const action=nextWeeklyAction(report([t]));
  assert.deepEqual(action,{type:'resolve-issue',team:'s1',issue:'i1',issueType:'adjustment',reason:'Synthetic fixture correction',decision:'accept'});
});

test('missing and sync issues use only the fixed fictional fixture worked-time evidence',()=>{
  const action=buildSyntheticWorkedResolution({id:'i2',type:'missing',status:'open',row:'r2',employee:'e2'}, {id:'r2',date:'2026-09-10'});
  assert.deepEqual(action,{type:'resolve-issue',team:null,issue:'i2',issueType:'missing',reason:'Synthetic fixture verification only: explicitly supplied fictional attendance evidence; no customer approval.',outcome:'worked',clockIn:'2026-09-10T06:00',clockOut:'2026-09-10T14:00',breakStart:'2026-09-10T10:00',breakEnd:'2026-09-10T10:30',breaksConfirmed:true});
});

test('unknown issue types fail closed instead of inventing an action',()=>{
  const t=team({issues:[{id:'i9',type:'mystery',status:'open',row:'r9',employee:'e1'}],records:[{id:'r9',date:'2026-09-09'}]});
  assert.throws(()=>nextWeeklyAction(report([t])),/UNSUPPORTED_WEEKLY_ISSUE_TYPE/);
});

test('after issues, unchecked categories come before employees',()=>{
  const t=team({categories:[{id:'clocking',confirmed:true,open:0},{id:'holiday',confirmed:false,open:0}],employees:[{id:'e1',checked:false}]});
  assert.deepEqual(nextWeeklyAction(report([t])),{type:'check-category',team:'s1',category:'holiday'});
});

test('after categories, unchecked employees are verified one at a time',()=>{
  const t=team({categories:[{id:'clocking',confirmed:true,open:0}],employees:[{id:'e1',checked:true},{id:'e2',checked:false}]});
  assert.deepEqual(nextWeeklyAction(report([t])),{type:'check-employee',team:'s1',employee:'e2'});
});

test('a fully reviewed signable team gets exactly one sign action',()=>{
  const t=team({canSign:true,categories:[{id:'clocking',confirmed:true,open:0}],employees:[{id:'e1',checked:true}]});
  assert.deepEqual(nextWeeklyAction(report([t])),{type:'sign-team',team:'s1'});
});

test('signed teams are skipped and the next incomplete team is selected',()=>{
  const signed=team({id:'s1',status:'signed'});
  const open=team({id:'s2',categories:[{id:'clocking',confirmed:false,open:0}]});
  assert.deepEqual(nextWeeklyAction(report([signed,open])),{type:'check-category',team:'s2',category:'clocking'});
});

test('stale, returned or blocked teams never get silently signed',()=>{
  for(const status of ['stale','returned']) assert.throws(()=>nextWeeklyAction(report([team({status,canSign:true})])),/WEEKLY_TEAM_NOT_SAFE_TO_AUTOMATE/);
  assert.throws(()=>nextWeeklyAction(report([team({blockers:[{code:'hold'}],canSign:true})])),/WEEKLY_TEAM_BLOCKED/);
});

test('all signed teams reach the payroll handoff terminal',()=>{
  assert.deepEqual(nextWeeklyAction(report([team({id:'s1',status:'signed'}),team({id:'s2',status:'signed'})])),{type:'ready-for-payroll'});
});

test('empty or malformed reports fail closed',()=>{
  for(const value of [null,{}, {teams:[]}, {teams:'bad'}]) assert.throws(()=>nextWeeklyAction(value),/WEEKLY_REPORT_INVALID/);
});

test('payroll readiness requires all teams signed, zero blockers, reconciliation and real rows',()=>{
  const ready={teams:[{id:'s1',status:'signed'}],blockers:[],canRelease:true,reconciliation:{ok:true},lines:[{payrollId:'p1'}],totals:{employees:1,workedMinutes:480}};
  assert.equal(verifyPayrollReady(ready),true);
  for(const bad of [
    {...ready,teams:[{id:'s1',status:'reviewing'}]},
    {...ready,blockers:['hold']},
    {...ready,canRelease:false},
    {...ready,reconciliation:{ok:false}},
    {...ready,lines:[]},
    {...ready,totals:{employees:0,workedMinutes:0}}
  ]) assert.throws(()=>verifyPayrollReady(bad),/PAYROLL_NOT_READY/);
});

test('released payroll must appear as the exact saved batch with bounded counts and checksum',()=>{
  const before={batches:[]};
  const result={id:'batch-1',status:'released'};
  const after={batches:[{id:'batch-1',status:'released',employeeCount:2,rowCount:3,checksum:'a'.repeat(64)}]};
  assert.deepEqual(verifyReleasedPayroll(before,after,result),after.batches[0]);
  assert.throws(()=>verifyReleasedPayroll(before,{batches:[]},result),/PAYROLL_RELEASE_NOT_SAVED/);
  assert.throws(()=>verifyReleasedPayroll(before,{batches:[{id:'batch-1',status:'released',employeeCount:2,rowCount:0,checksum:'a'.repeat(64)}]},result),/PAYROLL_RELEASE_INVALID/);
  assert.throws(()=>verifyReleasedPayroll({batches:[{id:'batch-1',status:'released'}]},after,result),/PAYROLL_RELEASE_ID_REUSED/);
});

test('browser journey source must mutate through visible Vector controls, not direct command POSTs',()=>{
  const source=fs.readFileSync(new URL('./vector-weekly-payroll-browser-journey.mjs',import.meta.url),'utf8');
  assert.match(source,/button\[data-vector-workflow=/);
  assert.match(source,/waitForResponse/);
  assert.doesNotMatch(source,/fetch\(['"]\/api\/command['"]/);
  assert.doesNotMatch(source,/request\(['"]\/api\/command['"]/);
  assert.match(source,/MAX_WEEKLY_ACTIONS/);
});
