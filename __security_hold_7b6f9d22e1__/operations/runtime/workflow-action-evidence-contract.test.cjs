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
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a']});
  assert.equal(rows.length,1);
  assert.equal(rows[0].sourceId,'issue-1');
  assert.equal(rows[0].reasonCode,'MISSED_CLOCK_OUT');
  assert.equal(rows[0].freshness.state,'unknown');
  assert.equal(rows[0].confirmation.state,'action_required');
});

test('Time Review producer fails closed without explicit source scope or required authority fields',()=>{
  const report=timeReviewReport();
  assert.deepEqual(produceTimeReviewActionEvidence(report),[]);

  const noId=timeReviewReport({teams:[{id:'team-a',issues:[{status:'open',reasonCode:'MISSED_CLOCK_OUT'}]}]});
  assert.deepEqual(produceTimeReviewActionEvidence(noId,{allowedTeamIds:['team-a']}),[]);

  const noReason=timeReviewReport({teams:[{id:'team-a',issues:[{id:'issue-1',status:'open'}]}]});
  assert.deepEqual(produceTimeReviewActionEvidence(noReason,{allowedTeamIds:['team-a']}),[]);

  const noAuthority=timeReviewReport({authorityRequired:null});
  assert.deepEqual(produceTimeReviewActionEvidence(noAuthority,{allowedTeamIds:['team-a']}),[]);

  const noObservation=timeReviewReport({generatedAt:null});
  assert.deepEqual(produceTimeReviewActionEvidence(noObservation,{allowedTeamIds:['team-a']}),[]);
});

test('Time Review producer passes explicit source freshness without deriving it from generatedAt',()=>{
  const report=timeReviewReport({
    freshness:{
      state:'current',
      policyRef:'time-review-source-sla-v1',
      validUntil:'2026-09-19T10:05:00.000Z'
    }
  });
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a']});
  assert.equal(rows.length,1);
  assert.equal(rows[0].freshness.state,'current');
  assert.equal(rows[0].freshness.policyRef,'time-review-source-sla-v1');
  assert.equal(rows[0].freshness.validUntil,'2026-09-19T10:05:00.000Z');
});

test('Time Review producer preserves explicit confirmation lifecycle and never applies wall-clock expiry',()=>{
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
  const rows=produceTimeReviewActionEvidence(report,{allowedTeamIds:['team-a']});
  assert.equal(rows.length,1);
  assert.equal(rows[0].confirmation.state,'confirming_source');
  assert.equal(rows[0].confirmation.slaExpired,false);
});
