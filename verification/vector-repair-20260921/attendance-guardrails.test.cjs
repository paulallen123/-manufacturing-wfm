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
