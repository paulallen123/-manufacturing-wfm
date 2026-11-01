const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');

const runtime=path.resolve(process.env.WFM_RUNTIME||'');
assert.ok(process.env.WFM_RUNTIME,'WFM_RUNTIME is required.');
const W=require(path.join(runtime,'public/core.js'));
const E=require(path.join(runtime,'public/engine.js'));
const C=require(path.join(runtime,'public/cost-engine.js'));
const P=require(path.join(runtime,'public/payroll-control.js'));
const R=require(path.join(runtime,'public/work-rules.js'));

const seed=()=>R.decorate(P.decorate(C.decorate(E.decorate(W.seed()))));
const manager={personId:'m1',email:'manager@northstar.example',role:'manager',permissions:[]};
const supervisor={personId:'s1',email:'supervisor@northstar.example',role:'supervisor',permissions:[]};
const director={personId:'d1',email:'superuser@northstar.example',role:'director',permissions:[]};
const payroll={personId:'pay1',email:'payroll@northstar.example',role:'payroll_admin',permissions:['payroll.view','payroll.export','payroll.reopen']};
const reason='Synthetic current-scope and lifecycle integrity evidence.';
const amendment=(p,overrides={})=>({
  period:p.id,
  team:'s1',
  revision:p.reviews.s1.revision,
  record:'wr-e0-2026-09-07',
  clockIn:'2026-09-07T06:00',
  clockOut:'2026-09-07T14:30',
  breaksConfirmed:true,
  reason,
  ...overrides
});
const session={id:'SYNTHETIC-PERSONAL-1',person:'e0',start:'2026-09-07T05:00:00.000Z',end:'2026-09-07T13:30:00.000Z',breaks:[]};
const linkPayload=p=>({period:p.id,employee:'e0',sessionId:session.id});
const expectStatus=(fn,status,message)=>assert.throws(fn,error=>error?.status===status&&(!message||error.message.includes(message)));

test('former manager cannot propose a correction after employee scope changes',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  state.staff.find(employee=>employee.id==='e0').manager='s4';
  const before=P.canonical(state);
  assert.equal(E.allowedPeople(state,manager).some(employee=>employee.id==='e0'),false);
  expectStatus(()=>P.changeRecord(state,manager,amendment(p)),403,'Current reporting access');
  assert.equal(P.canonical(state),before,'Rejected proposal must not mutate source, review or audit state.');
});

test('former reviewer cannot accept a pending correction after employee scope changes',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  const proposed=P.changeRecord(state,manager,amendment(p));
  state.staff.find(employee=>employee.id==='e0').manager='s4';
  const before=P.canonical(state);
  assert.equal(E.allowedPeople(state,supervisor).some(employee=>employee.id==='e0'),false);
  expectStatus(()=>P.resolveIssue(state,supervisor,{
    period:p.id,team:'s1',revision:p.reviews.s1.revision,issue:proposed.id,
    checked:true,decision:'accept',reason
  }),403,'Current reporting access');
  assert.equal(P.canonical(state),before,'Rejected approval must leave the pending issue and evidence unchanged.');
});

test('current director scope can still approve the transferred employee correction',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  const proposed=P.changeRecord(state,manager,amendment(p));
  state.staff.find(employee=>employee.id==='e0').manager='s4';
  assert.equal(E.allowedPeople(state,director).some(employee=>employee.id==='e0'),true);
  const result=P.resolveIssue(state,director,{
    period:p.id,team:'s1',revision:p.reviews.s1.revision,issue:proposed.id,
    checked:true,decision:'accept',reason
  });
  assert.equal(result.status,'resolved');
  assert.equal(p.records.find(record=>record.id==='wr-e0-2026-09-07').correction.clockOut,'2026-09-07T13:30:00.000Z');
});

test('cross-period attendance overlap is rejected before approval',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  state.payrollControl.periods.push({
    id:'2026-09-14',
    records:[{
      id:'wr-e0-2026-09-14',employee:'e0',team:'s1',date:'2026-09-14',sourceVersion:1,correction:null,
      raw:{kind:'worked',clockIn:E.resolveLondon('2026-09-14T06:00'),clockOut:E.resolveLondon('2026-09-14T14:00'),breaks:[],breaksConfirmed:true,pendingSync:false,absenceMinutes:0}
    }]
  });
  const proposed=P.changeRecord(state,manager,amendment(p,{
    record:'wr-e0-2026-09-13',clockIn:'2026-09-13T23:00',clockOut:'2026-09-14T07:00'
  }));
  const before=P.canonical(state);
  expectStatus(()=>P.resolveIssue(state,director,{
    period:p.id,team:'s1',revision:p.reviews.s1.revision,issue:proposed.id,
    checked:true,decision:'accept',reason
  }),409,'overlap another attendance record');
  assert.equal(P.canonical(state),before,'Cross-period overlap rejection must leave both periods unchanged.');
});

test('legacy unfingerprinted adjustment can be declined without mutating invalid source evidence',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  const issue=p.issues.find(item=>item.type==='adjustment');
  const row=p.records.find(item=>item.id===issue.row);
  delete issue.sourceFingerprint;
  row.raw.pendingSync=true;
  const rawBefore=P.canonical(row.raw),correctionBefore=P.canonical(row.correction);
  const declined=P.resolveIssue(state,director,{
    period:p.id,team:issue.team,revision:p.reviews[issue.team].revision,issue:issue.id,
    checked:true,decision:'decline',reason
  });
  assert.equal(declined.status,'resolved');
  assert.equal(P.canonical(row.raw),rawBefore,'Decline must preserve raw source evidence.');
  assert.equal(P.canonical(row.correction),correctionBefore,'Decline must not write a correction.');
  const fresh=P.changeRecord(state,manager,{
    period:p.id,team:issue.team,revision:p.reviews[issue.team].revision,record:row.id,
    clockIn:row.date+'T06:00',clockOut:row.date+'T14:30',breaksConfirmed:true,reason
  });
  const freshIssue=p.issues.find(item=>item.id===fresh.id);
  assert.ok(freshIssue.sourceFingerprint,'Replacement proposal must bind the current source evidence.');
});

for(const lifecycle of ['signed','stale','released','sent'])test(`Personal clocking cannot mutate a ${lifecycle} weekly/payroll state`,()=>{
  const state=seed(),p=P.period(state,'2026-09-07'),team=p.teams.find(item=>item.id==='s1'),review=p.reviews.s1;
  if(lifecycle==='signed'){
    review.status='signed';
    review.signature={by:'d1',snapshot:P.key(state,p,team)};
  }else if(lifecycle==='stale'){
    review.status='signed';
    review.signature={by:'d1',snapshot:'stale-source-snapshot'};
  }else{
    p.batches.push({id:'B-SYNTHETIC-'+lifecycle,status:lifecycle});
  }
  const before=P.canonical(state);
  expectStatus(()=>P.linkPersonalSession(state,payroll,linkPayload(p),session),409);
  assert.equal(P.canonical(state),before,'A locked Personal-session link must be byte-for-byte state neutral.');
});

test('explicitly returned team can accept a valid Personal clocking link',()=>{
  const state=seed(),p=P.period(state,'2026-09-07');
  p.reviews.s1.status='returned';
  p.reviews.s1.signature=null;
  const result=P.linkPersonalSession(state,payroll,linkPayload(p),session);
  assert.equal(result.status,'pending_review');
  const issue=p.issues.find(item=>item.id===result.issue);
  assert.ok(issue.sourceFingerprint,'New Personal-session adjustment must bind its source evidence.');
  assert.equal(p.personalSessionLinks.find(item=>item.sessionId===session.id).status,'pending_review');
});

// V040: post-release adjustment decision input must be validated before mutation.
{
'use strict';
// Disposable pure-domain declarations only. No server, database, provider or export.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=process.env.WFM_RUNTIME;
assert.ok(runtime,'WFM_RUNTIME required');
const createCalendar=require(path.join(runtime,'operations-runtime/tenant-calendar.cjs')).createTenantCalendar;
function domain(browser){
 if(!browser)return require(path.join(runtime,'public/payroll-control.js'));
 const snapshot=createCalendar({env:{},now:()=>Date.parse('2026-11-01T12:00:00Z')}).snapshot();
 const context=vm.createContext({WFMTenantCalendarSnapshot:snapshot});
 for(const name of ['engine.js','cost-engine.js','work-rules.js','payroll-control.js'])vm.runInContext(fs.readFileSync(path.join(runtime,'public',name),'utf8'),context,{filename:name});
 return context.WFMPayroll;
}
const proposer={personId:'fixture-proposer',role:'payroll_admin',permissions:['payroll.view','payroll.reopen']};
const reviewer={personId:'fixture-independent-reviewer',role:'payroll_admin',permissions:['payroll.view','payroll.reopen']};
const explanation='Fictional independent comparison of the recorded correction.';
function pending(P){
 const record={id:'observed-record',employee:'worker',team:'team',date:'2026-09-07',sourceVersion:1,raw:{kind:'worked',clockIn:'2026-09-07T09:00:00Z',clockOut:'2026-09-07T09:30:00Z',breaks:[],breaksConfirmed:true,pendingSync:false,absenceMinutes:0}};
 const period={id:'2026-09-07',start:'2026-09-07',end:'2026-09-13',records:[record],batches:[{id:'synthetic-terminal-batch',status:'released',checksum:'synthetic-checksum'}]};
 const state={staff:[{id:'worker',name:'Fictional worker',manager:'team',site:'Synthetic',payrollId:'SYNTHETIC'}],costing:{employeePolicies:{},rates:{worker:[{effectiveFrom:'2026-09-01',hourlyRate:20,currency:'GBP',basis:'hourly',oncostPercent:0,oncostHourly:0}]},policies:{Synthetic:[{version:'synthetic',effectiveFrom:'2026-09-01',weeklyTiers:[],dailyTiers:[],bankHolidayMultiplier:1,weekendMultiplier:1,nightMultiplier:1,stacking:'highest',region:'england-and-wales',warningPercent:90}]}},payrollControl:{version:1,periods:[period],audit:[],adjustments:[],adjustmentBatches:[]}};
 const result=P.postReleaseAdjustment(state,proposer,{period:period.id,record:record.id,clockIn:record.raw.clockIn,clockOut:'2026-09-07T10:00:00Z',breaks:[],breaksConfirmed:true,reason:explanation});
 assert.equal(result.status,'pending_approval');
 const adjustment=state.payrollControl.adjustments.find(x=>x.id===result.id);
 assert.equal(adjustment.minutesDelta,30);
 assert.equal(adjustment.grossPenceDelta,1000);
 return {state,period,adjustment};
}
function payload(adjustment,changes={}){return {id:adjustment.id,revision:adjustment.revision,checked:true,decision:'approve',reason:explanation,...changes};}
function unchanged(P,state,fn,pattern){const before=P.canonical(state);assert.throws(fn,pattern);assert.equal(P.canonical(state),before,'Refusal must preserve adjustment revision/status, original record/batch and audit.');}
for(const browser of [false,true]){
 const mode=browser?'V040 browser-global':'V040 CommonJS';
 for(const decision of ['approve','decline'])test(`${mode} valid ${decision} records exactly one independent decision`,()=>{
  const P=domain(browser),{state,period,adjustment}=pending(P),original=P.canonical(period),audit=state.payrollControl.audit.length;
  const result=P.approvePostReleaseAdjustment(state,reviewer,payload(adjustment,{decision}));
  assert.equal(result.status,decision==='approve'?'approved':'declined');
  assert.equal(adjustment.revision,2);assert.equal(adjustment.decisionBy,reviewer.personId);assert.equal(adjustment.decisionReason,explanation);
  assert.equal(P.canonical(period),original);assert.equal(state.payrollControl.audit.length,audit+1);
 });
 for(const [name,decision] of [['missing',undefined],['empty',''],['typo','aprove'],['wrong case','APPROVE'],['other verb','reject'],['null',null]])test(`${mode} invalid decision ${name} refuses without mutation`,()=>{
  const P=domain(browser),{state,adjustment}=pending(P);
  unchanged(P,state,()=>P.approvePostReleaseAdjustment(state,reviewer,payload(adjustment,{decision})),/Approve or decline/);
 });
 for(const decision of ['approve','decline'])for(const [name,reason] of [['missing',undefined],['short','too short'],['long','x'.repeat(501)]])test(`${mode} ${decision} with ${name} reason refuses before mutation`,()=>{
  const P=domain(browser),{state,adjustment}=pending(P);
  unchanged(P,state,()=>P.approvePostReleaseAdjustment(state,reviewer,payload(adjustment,{decision,reason})),/12–500/);
 });
 for(const name of ['permission','same proposer','stale revision','source drift','unchecked'])test(`${mode} existing ${name} refusal remains unchanged`,()=>{
  const P=domain(browser),{state,period,adjustment}=pending(P);let actor=reviewer,changes={},pattern;
  if(name==='permission'){actor={...reviewer,permissions:[]};pattern=/Explicit payroll authority/;}
  if(name==='same proposer'){actor=proposer;pattern=/different authorised/;}
  if(name==='stale revision'){changes.revision=0;pattern=/Adjustment changed/;}
  if(name==='source drift'){period.records[0].sourceVersion=2;pattern=/Released evidence changed/;}
  if(name==='unchecked'){changes.checked=false;pattern=/Confirm that/;}
  unchanged(P,state,()=>P.approvePostReleaseAdjustment(state,actor,payload(adjustment,changes)),pattern);
 });
}

}
