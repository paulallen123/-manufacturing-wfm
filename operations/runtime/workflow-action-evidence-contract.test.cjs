'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  CONTRACT_VERSION,
  validateSourceActionEvidence,
  acceptSourceActionEvidence,
  produceTimeReviewActionEvidence
}=require('./workflow-action-evidence-contract.cjs');

function base(overrides={}){
  return {
    workflow:'time-review',
    sourceId:'team-a',
    reasonCode:'TIME_EXCEPTION_OPEN',
    observedAt:'2026-09-19T10:00:00.000Z',
    route:'time-review',
    authorityRequired:'Manager decision required',
    title:'Team A · 2 exceptions need review',
    whyNow:'The source workflow reports unresolved time evidence.',
    freshness:{
      state:'current',
      policyRef:'time-review-evidence-sla-v1',
      validUntil:'2026-09-19T10:05:00.000Z'
    },
    confirmation:{state:'action_required'},
    ...overrides
  };
}

const freshnessEnvelope={timeZone:'Europe/London',asOf:'2026-09-19T10:02:00.000Z',maxAgeMs:300000};

function timeReviewReport(overrides={}){
  return {
    generatedAt:'2026-09-19T10:00:00.000Z',
    authorityRequired:'Manager time-review decision',
    teams:[
      {
        id:'team-a',
        issues:[
          {
            id:'issue-1',
            status:'open',
            reasonCode:'MISSED_CLOCK_OUT',
            title:'Alex · missed clock-out'
          }
        ]
      }
    ],
    ...overrides
  };
}

test('accepts explicit source-owned current action evidence',()=>{
  const result=validateSourceActionEvidence(base());
  assert.equal(result.ok,true);
  assert.equal(result.value.contractVersion,CONTRACT_VERSION);
  assert.equal(result.value.freshness.state,'current');
  assert.equal(result.value.confirmation.state,'action_required');
});

test('observation timestamp alone cannot become freshness',()=>{
  const input=base();
  delete input.freshness;
  const result=validateSourceActionEvidence(input);
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('FRESHNESS_CONTRACT_REQUIRED'));
  assert.equal(result.value,null);
});

test('current freshness requires a source policy and explicit validity boundary',()=>{
  const noPolicy=validateSourceActionEvidence(base({freshness:{state:'current',validUntil:'2026-09-19T10:05:00.000Z'}}));
  assert.equal(noPolicy.ok,false);
  assert.ok(noPolicy.errors.includes('FRESHNESS_POLICY_REQUIRED'));

  const noBoundary=validateSourceActionEvidence(base({freshness:{state:'current',policyRef:'time-review-evidence-sla-v1'}}));
  assert.equal(noBoundary.ok,false);
  assert.ok(noBoundary.errors.includes('CURRENT_VALID_UNTIL_REQUIRED'));
});

test('unknown freshness is valid and remains neutral without an invented expiry',()=>{
  const result=validateSourceActionEvidence(base({freshness:{state:'unknown'}}));
  assert.equal(result.ok,true);
  assert.equal(result.value.freshness.state,'unknown');
  assert.equal(result.value.freshness.validUntil,null);
});

test('contract never converts confirming source to needs verification from wall clock',()=>{
  const result=validateSourceActionEvidence(base({
    confirmation:{
      state:'confirming_source',
      decisionId:'decision-17',
      slaExpiresAt:'2020-01-01T00:00:00.000Z',
      slaExpired:false
    }
  }));
  assert.equal(result.ok,true);
  assert.equal(result.value.confirmation.state,'confirming_source');
  assert.equal(result.value.confirmation.slaExpired,false);
});

test('needs verification requires explicit source-owned SLA expiry state',()=>{
  const missing=validateSourceActionEvidence(base({
    confirmation:{
      state:'needs_verification',
      decisionId:'decision-18',
      slaExpiresAt:'2026-09-19T10:02:00.000Z'
    }
  }));
  assert.equal(missing.ok,false);
  assert.ok(missing.errors.includes('SOURCE_SLA_EXPIRY_REQUIRED'));

  const explicit=validateSourceActionEvidence(base({
    confirmation:{
      state:'needs_verification',
      decisionId:'decision-18',
      slaExpiresAt:'2026-09-19T10:02:00.000Z',
      slaExpired:true
    }
  }));
  assert.equal(explicit.ok,true);
  assert.equal(explicit.value.confirmation.state,'needs_verification');
});

test('confirming source cannot claim the source SLA is already expired',()=>{
  const result=validateSourceActionEvidence(base({
    confirmation:{
      state:'confirming_source',
      decisionId:'decision-19',
      slaExpiresAt:'2026-09-19T10:02:00.000Z',
      slaExpired:true
    }
  }));
  assert.equal(result.ok,false);
  assert.ok(result.errors.includes('CONFIRMING_SOURCE_CANNOT_BE_EXPIRED'));
});

test('resolved state requires authoritative confirmation evidence',()=>{
  const missing=validateSourceActionEvidence(base({
    confirmation:{state:'resolved',decisionId:'decision-20'}
  }));
  assert.equal(missing.ok,false);
  assert.ok(missing.errors.includes('RESOLUTION_EVIDENCE_REQUIRED'));

  const resolved=validateSourceActionEvidence(base({
    confirmation:{
      state:'resolved',
      decisionId:'decision-20',
      confirmedAt:'2026-09-19T10:03:00.000Z',
      auditRef:'absence:a-22:approved'
    }
  }));
  assert.equal(resolved.ok,true);
  assert.equal(resolved.value.confirmation.state,'resolved');
});

test('consequence is admitted only with explicit verified source evidence',()=>{
  const invented=validateSourceActionEvidence(base({consequence:{summary:'£2,400 payroll impact'}}));
  assert.equal(invented.ok,false);
  assert.ok(invented.errors.includes('VERIFIED_CONSEQUENCE_REQUIRED'));

  const verified=validateSourceActionEvidence(base({
    consequence:{summary:'£2,400 payroll impact',verified:true,evidenceRef:'payroll-report:week-38'}
  }));
  assert.equal(verified.ok,true);
  assert.equal(verified.value.consequence.verified,true);
});

test('unsupported source workflow fails closed',()=>{
  assert.equal(acceptSourceActionEvidence(base({workflow:'today'})),null);
});

test('Time Review producer emits only scoped open structured source issues',()=>{
  const report=timeReviewReport({
    teams:[
      {id:'team-a',issues:[
        {id:'issue-1',status:'open',reasonCode:'MISSED_CLOCK_OUT',title:'Alex · missed clock-out'},
        {id:'issue-closed',status:'resolved',reasonCode:'MISSED_CLOCK_IN'}
      ]},
      {id:'team-b',issues:[
        {id:'issue-2',status:'open',reasonCode:'UNPAID_BREAK_EXCEPTION'}
      ]}
    ]
  });
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a'],freshnessEnvelope});
  assert.equal(rows.length,1);
  assert.equal(rows[0].sourceId,'issue-1');
  assert.equal(rows[0].reasonCode,'MISSED_CLOCK_OUT');
  assert.equal(rows[0].freshness.state,'current');
  assert.equal(rows[0].confirmation.state,'action_required');
});

test('Time Review producer normalizes only the sealed authoritative adjustment shape',()=>{
  const report=timeReviewReport({
    teams:[{
      id:'team-a',
      issues:[{
        id:'issue-adjustment-1',
        status:'open',
        type:'adjustment',
        row:'row-17',
        sourceFingerprint:'sha256:fixture-source',
        proposed:{clockOut:'2026-09-19T17:05:00.000Z'},
        message:'Manager proposed a five-minute correction.'
      }]
    }]
  });
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a'],freshnessEnvelope});
  assert.equal(rows.length,1);
  assert.equal(rows[0].sourceId,'issue-adjustment-1');
  assert.equal(rows[0].reasonCode,'TIME_REVIEW_ADJUSTMENT');
  assert.equal(rows[0].title,'Manager proposed a five-minute correction.');
  assert.equal(rows[0].freshness.state,'current');
  assert.equal(rows[0].confirmation.state,'action_required');

  const missingFingerprint=timeReviewReport({
    teams:[{id:'team-a',issues:[{
      id:'issue-adjustment-2',status:'open',type:'adjustment',row:'row-18',proposed:{clockOut:'2026-09-19T17:05:00.000Z'}
    }]}]
  });
  assert.deepEqual(produceTimeReviewActionEvidence(missingFingerprint,{allowedTeamIds:['team-a']}),[]);
});

test('Time Review producer fails closed without explicit source scope or required authority fields',()=>{
  const report=timeReviewReport();
  assert.deepEqual(produceTimeReviewActionEvidence(report),[]);

  const noId=timeReviewReport({teams:[{id:'team-a',issues:[{status:'open',reasonCode:'MISSED_CLOCK_OUT'}]}]});
  assert.deepEqual(produceTimeReviewActionEvidence(noId,{allowedTeamIds:['team-a'],freshnessEnvelope}),[]);

  const noReason=timeReviewReport({teams:[{id:'team-a',issues:[{id:'issue-1',status:'open'}]}]});
  assert.deepEqual(produceTimeReviewActionEvidence(noReason,{allowedTeamIds:['team-a'],freshnessEnvelope}),[]);

  const noAuthority=timeReviewReport({authorityRequired:null});
  assert.deepEqual(produceTimeReviewActionEvidence(noAuthority,{allowedTeamIds:['team-a'],freshnessEnvelope}),[]);

  const noObservation=timeReviewReport({generatedAt:null});
  assert.deepEqual(produceTimeReviewActionEvidence(noObservation,{allowedTeamIds:['team-a'],freshnessEnvelope}),[]);
});

test('Time Review producer ignores source-supplied freshness and derives it only from the trusted tenant-calendar envelope',()=>{
  const report=timeReviewReport({
    freshness:{
      state:'current',
      policyRef:'untrusted-source-claim',
      validUntil:'2099-01-01T00:00:00.000Z'
    }
  });
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a'],freshnessEnvelope});
  assert.equal(rows.length,1);
  assert.equal(rows[0].freshness.state,'current');
  assert.equal(rows[0].freshness.policyRef,'server-authoritative-tenant-calendar');
  assert.equal(rows[0].freshness.validUntil,'2026-09-19T10:05:00.000Z');
});


test('Time Review producer classifies observations older than the trusted envelope maximum age as stale',()=>{
  const report=timeReviewReport({generatedAt:'2026-09-19T09:00:00.000Z'});
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a'],freshnessEnvelope});
  assert.equal(rows.length,1);
  assert.equal(rows[0].freshness.state,'stale');
  assert.equal(rows[0].freshness.policyRef,'server-authoritative-tenant-calendar');
  assert.equal(rows[0].freshness.validUntil,null);
});

test('Time Review producer suppresses lifecycle fields absent from the sealed source protocol',()=>{
  const report=timeReviewReport({
    teams:[{
      id:'team-a',
      issues:[{
        id:'issue-1',
        status:'open',
        reasonCode:'MISSED_CLOCK_OUT',
        confirmation:{
          state:'confirming_source',
          decisionId:'decision-1',
          slaExpiresAt:'2020-01-01T00:00:00.000Z',
          slaExpired:false
        }
      }]
    }]
  });
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a'],freshnessEnvelope});
  assert.deepEqual(rows,[]);
});

const {produceAbsenceActionEvidence,produceWeeklySignoffActionEvidence}=require('./workflow-action-evidence-contract.cjs');
const scope={tenant:'alpha',personId:'m1',role:'manager',allowedTeamIds:['team-a'],period:'2026-09-07',freshnessEnvelope};
function signedReport(){return {period:'2026-09-07',teams:[{id:'team-a',period:'2026-09-07',revision:3,status:'signed',signature:{by:'m1',revision:3,at:'2026-09-19T10:00:00.000Z'}}],audit:[{id:'pa-7',type:'team-signed',period:'2026-09-07',team:'team-a',revision:3,actor:'m1',at:'2026-09-19T10:00:00.001Z'}]};}

test('Absence uses canonical request scope and reports absent observation/decision/audit/SLA without inventing a lifecycle',()=>{
  const report={state:{staff:[{id:'e1',manager:'team-a'}],requests:[{id:'leave-1',employee:'e1',date:'2026-09-20',status:'pending',title:'URGENT 500 days overdue'}],audit:[]}};
  const result=produceAbsenceActionEvidence(report,{...scope,period:null});
  assert.deepEqual(result.items,[]);assert.equal(result.unavailable.length,1);
  assert.ok(result.unavailable[0].missingFields.includes('observedAt'));
  report.state.requests[0]={...report.state.requests[0],status:'approved',reviewedAt:'2026-09-19T10:00:00.000Z',reviewedBy:'m1',confirmation:{state:'resolved',decisionId:'click'}};
  report.state.audit=[{id:'a1',type:'leave-decision',employee:'e1',by:'m1',at:'2026-09-19T10:00:00.000Z'}];
  const decided=produceAbsenceActionEvidence(report,{...scope,period:null});
  assert.deepEqual(decided.items,[]);assert.ok(decided.unavailable[0].missingFields.includes('requestBoundAudit'));
  assert.ok(decided.unavailable[0].missingFields.includes('decisionId'));
  assert.deepEqual(produceAbsenceActionEvidence(report,{...scope,allowedTeamIds:[]}).items,[]);
  assert.deepEqual(produceAbsenceActionEvidence(report,{...scope,allowedTeamIds:[]}).unavailable,[]);
});

test('Weekly sign-off resolves only a matching persisted signature and team-signed audit event',()=>{
  const out=produceWeeklySignoffActionEvidence(signedReport(),scope);
  assert.equal(out.items.length,1);assert.equal(out.items[0].confirmation.state,'resolved');
  assert.equal(out.items[0].confirmation.decisionId,'pa-7');assert.equal(out.items[0].confirmation.auditRef,'pa-7');
  assert.deepEqual(out.items[0].binding,{workflow:'weekly-signoff',tenant:'alpha',teamId:'team-a',period:'2026-09-07',sourceId:'team-a'});
  assert.equal(out.items[0].authority.rule,'payroll-control.reviewer');
  for(const mutate of [r=>{r.audit=[];},r=>{r.teams[0].status='stale';},r=>{r.audit[0].team='team-b';},r=>{r.audit[0].period='2026-09-14';},
    r=>{r.audit[0].revision=2;},r=>{r.audit[0].actor='m2';},r=>{r.audit[0].type='category-checked';},r=>{r.audit.push({...r.audit[0]});},
    r=>{r.teams[0].workflow='absence';},r=>{r.teams[0].period='2026-09-14';},r=>{r.teams[0].signature.revision=2;},r=>{r.teams[0].signature.at='08:38';}]){
    const report=signedReport();mutate(report);assert.deepEqual(produceWeeklySignoffActionEvidence(report,scope).items,[]);
  }
});

test('Weekly unsigned, stale and partial evidence stays neutral, never derives urgency or lifecycle from copy/counts/request',()=>{
  const r=signedReport();r.teams[0]={id:'team-a',period:r.period,revision:4,status:'draft',employees:[{id:'e1'}],canSign:true,blockers:[],title:'URGENT',confirmation:{state:'decision_sent',decisionId:'request-only'}};r.audit=[];
  const missing=produceWeeklySignoffActionEvidence(r,scope);assert.deepEqual(missing.items,[]);assert.ok(missing.unavailable[0].missingFields.includes('observedAt'));
  r.audit=[{id:'pa-8',type:'category-checked',period:r.period,team:'team-a',revision:4,actor:'m1',at:'2026-09-19T10:00:00.000Z'}];
  const ready=produceWeeklySignoffActionEvidence(r,scope);assert.equal(ready.items[0].confirmation.state,'action_required');assert.equal(ready.items[0].reasonCode,'WEEKLY_SIGNOFF_REQUIRED');
  assert.equal(ready.items[0].confirmation.slaExpiresAt,null);
  r.audit[0].at='2026-09-18T10:00:00.000Z';assert.equal(produceWeeklySignoffActionEvidence(r,scope).items[0].freshness.state,'stale');
  r.partial=true;assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
});

test('workflow, tenant, period and duplicate source identity are checked before production',()=>{
  for(const mutate of [r=>{r.workflow='absence';},r=>{r.tenant='bravo';},r=>{r.period='2026-09-14';},r=>{r.teams.push({...r.teams[0]});}]){
    const r=signedReport();mutate(r);assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
  }
});

test('nested audit and signature identity cannot switch workflow, tenant, source, team, period or completeness',()=>{
  for(const layer of ['audit','signature'])for(const fields of [
    {tenant:'bravo'},{tenantId:'bravo'},{workflow:'absence'},{partial:true},{complete:false},{sourceId:'other'},
    {period:'2026-09-14'},{team:'other'}]){
    const report=signedReport();Object.assign(layer==='audit'?report.audit[0]:report.teams[0].signature,fields);
    assert.deepEqual(produceWeeklySignoffActionEvidence(report,scope).items,[],layer+JSON.stringify(fields));
  }
});

test('canonical sealed producers preserve permission and audited sign-off behavior',t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
  const archive=process.env.WFM_EVIDENCE_SEALED_ARCHIVE||path.resolve(__dirname,'../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
  if(!fs.existsSync(archive)){t.skip('Sealed canonical archive unavailable; source integration unrun.');return;}
  assert.equal(createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),'3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vector-evidence-sealed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  execFileSync('tar',['-xzf',archive,'-C',root]);
  const E=require(path.join(root,'public/engine.js')),W=require(path.join(root,'public/core.js')),
    C=require(path.join(root,'public/cost-engine.js')),P=require(path.join(root,'public/payroll-control.js')),R=require(path.join(root,'public/work-rules.js'));
  const state=R.decorate(P.decorate(C.decorate(E.decorate(W.seed()))));
  const actor={tenant:'alpha',personId:'m1',role:'manager',email:'manager@alpha',permissions:[]};
  const scope={...actor,allowedTeamIds:[...E.descendants(state.org,actor.personId)],period:'2026-09-07'};
  const initial=P.reviewDashboard(state,actor,scope.period);
  assert.deepEqual(produceWeeklySignoffActionEvidence(initial,scope).items,[]);
  assert.ok(produceWeeklySignoffActionEvidence(initial,scope).unavailable.every(row=>row.missingFields.includes('observedAt')));
  assert.throws(()=>P.reviewDashboard(state,{...actor,role:'employee'},scope.period));
  assert.throws(()=>P.reviewer(state,actor,P.period(state,scope.period),{id:'s4'}));
  const team=initial.teams.find(row=>row.id==='s3');assert.equal(team.blockers.length,0);
  const payload={period:scope.period,team:team.id,revision:team.revision,checked:true};
  for(const category of P.CATEGORIES)P.acknowledge(state,actor,{...payload,category:category.id});
  for(const employee of team.employees)P.acknowledge(state,actor,{...payload,employee:employee.id});
  const envelope=()=>({...scope,freshnessEnvelope:{timeZone:'Europe/London',asOf:new Date().toISOString(),maxAgeMs:300000}});
  assert.equal(produceWeeklySignoffActionEvidence(P.reviewDashboard(state,actor,scope.period),envelope()).items[0].confirmation.state,'action_required');
  P.sign(state,actor,{...payload,attestation:'confirmed'});
  const signed=P.reviewDashboard(state,actor,scope.period),out=produceWeeklySignoffActionEvidence(signed,envelope());
  assert.equal(out.items.length,1);assert.equal(out.items[0].confirmation.state,'resolved');
  assert.equal(out.items[0].confirmation.decisionId,state.payrollControl.audit.at(-1).id);
  // Actual source data change invalidates the signature through P.stateOf.
  const period=P.period(state,scope.period),row=period.records.find(row=>row.team==='s3');row.sourceVersion++;
  assert.equal(P.reviewDashboard(state,actor,scope.period).teams.find(row=>row.id==='s3').status,'stale');
  assert.deepEqual(produceWeeklySignoffActionEvidence(P.reviewDashboard(state,actor,scope.period),envelope()).items,[]);
  const request=state.requests.find(row=>E.allowedPeople(state,actor).some(person=>person.id===row.employee)&&row.status==='pending');
  R.decideLeave(state,actor,{id:request.id,decision:'declined',reviewed:true,reason:'Isolated fixture decision'});
  const absence=produceAbsenceActionEvidence({state},scope);
  assert.deepEqual(absence.items,[]);
  assert.ok(absence.unavailable.find(row=>row.binding.sourceId===request.id).missingFields.includes('requestBoundAudit'));
  assert.equal(state.audit.at(-1).type,'leave-decision');assert.equal(state.audit.at(-1).requestId,undefined);
});


test('weekly sign-off cannot ask the actor to approve their own payroll record',()=>{
  const r=signedReport();r.teams[0]={id:'team-a',period:r.period,revision:4,status:'draft',employees:[{id:'m1'}],canSign:true};
  r.audit=[{id:'pa-8',type:'category-checked',period:r.period,team:'team-a',revision:4,actor:'m1',at:'2026-09-19T10:00:00.000Z'}];
  const denied=produceWeeklySignoffActionEvidence(r,scope);assert.deepEqual(denied.items,[]);assert.ok(denied.unavailable[0].missingFields.includes('independentReviewer'));
  delete r.teams[0].employees;assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
});


test('Time Review cannot resolve an open issue from click/request confirmation fields without source audit',()=>{
  for(const state of ['decision_sent','confirming_source','needs_verification','resolved']){
    const r=timeReviewReport();r.teams[0].issues[0].confirmation={state,decisionId:'client-click-1',slaExpiresAt:'2026-09-19T10:03:00Z',slaExpired:true,confirmedAt:'2026-09-19T10:00:00Z',auditRef:'invented-reference'};
    assert.deepEqual(produceTimeReviewActionEvidence(r,{allowedTeamIds:['team-a'],freshnessEnvelope}),[]);
  }
});


test('weekly source aliases and partial employee identity cannot grant action authority',()=>{
  for(const fields of [{sourceId:'other'},{teamId:'other'}]){
    const r=signedReport();Object.assign(r.teams[0],fields);assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
  }
  for(const employees of [[null],[{}],[{id:'e1'},{id:'e1'}]]){
    const r=signedReport();r.teams[0]={id:'team-a',period:r.period,revision:4,status:'draft',employees};
    r.audit=[{id:'pa-8',type:'category-checked',period:r.period,team:'team-a',revision:4,actor:'m1',at:'2026-09-19T10:00:00.000Z'}];
    assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
  }
});

test('weekly signature and audit cannot disagree about freshness or temporal order',()=>{
  for(const change of [
    r=>{r.teams[0].signature.at='2025-09-19T10:00:00.000Z';},
    r=>{r.audit[0].at='2027-09-19T10:00:00.000Z';},
    r=>{r.audit[0].at='2026-09-19T09:59:59.000Z';}
  ]){
    const r=signedReport();change(r);const result=produceWeeklySignoffActionEvidence(r,scope);
    assert.deepEqual(result.items,[]);assert.ok(result.unavailable.length>0);
  }
  assert.equal(produceWeeklySignoffActionEvidence(signedReport(),scope).items[0].confirmation.state,'resolved');
});


test('canonical team fields reject contradictory nested teamId aliases without adopting alias-only source shapes',()=>{
  for(const target of ['signature','audit']){
    const r=signedReport();(target==='signature'?r.teams[0].signature:r.audit[0]).teamId='another-team';
    assert.deepEqual(produceWeeklySignoffActionEvidence(r,scope).items,[]);
  }
});


test('coherent durable historical sign-off remains signed evidence with stale observation, without inventing a new SLA',()=>{
  const r=signedReport();r.teams[0].signature.at='2025-09-19T10:00:00.000Z';r.audit[0].at='2025-09-19T10:00:00.001Z';
  const historical=produceWeeklySignoffActionEvidence(r,scope);
  assert.equal(historical.items[0].confirmation.state,'resolved');assert.equal(historical.items[0].freshness.state,'stale');
  assert.equal(historical.items[0].observedAt,r.teams[0].signature.at);
  assert.equal(historical.items[0].confirmation.slaExpiresAt,null);
});
