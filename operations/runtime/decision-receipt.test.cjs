'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDecisionReceipt}=require('./decision-receipt.cjs');

const episode={
  contractVersion:'VECTOR_DECISION_EPISODE_V1',episodeId:'ep-1',tenant:'alpha',site:'tamworth',decisionType:'absence-recovery',triggerId:'absence-9',triggeredAt:'2026-09-23T04:42:00.000Z',contextRevision:'rev-7',mode:'HUMAN_APPROVAL',sourceEvidence:['absence:9','demand:line4'],
  recommendation:{optionId:'redeploy',reason:'RANKED',authorityRequired:'HUMAN_APPROVAL_REQUIRED',executionPermitted:false,ranking:[{optionId:'redeploy',score:0.91},{optionId:'do-nothing',score:0.1}]},
  options:[
    {id:'do-nothing',label:'Do nothing',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.1,prediction:{labourCost:0,delayMinutes:180},evidenceRefs:['demand:line4'],reasonCodes:['BASELINE']},
    {id:'redeploy',label:'Redeploy qualified operator',feasible:true,policyAllowed:true,hardConstraintsPassed:true,uncertainty:0.05,prediction:{labourCost:91,delayMinutes:0},evidenceRefs:['skill:p2'],reasonCodes:['QUALIFIED','REST_OK']}
  ],
  selection:{optionId:'redeploy',selectedAt:'2026-09-23T04:47:00.000Z',actorRef:'manager:1',authorityDecision:'HUMAN_APPROVED',executionPermitted:true},
  outcome:{observedAt:'2026-09-23T08:30:00.000Z',evidenceRefs:['output:line4'],actual:{labourCost:89,delayMinutes:0},predictionError:{labourCost:-2,delayMinutes:0},notes:'Shift recovered'}
};

test('receipt is a read-only projection and preserves authority boundary',()=>{
  const receipt=createDecisionReceipt({episode});
  assert.equal(receipt.contractVersion,'VECTOR_DECISION_RECEIPT_V1');
  assert.equal(receipt.status,'OUTCOME_RECORDED');
  assert.equal(receipt.recommendation.executionPermitted,false);
  assert.equal(receipt.grantsExecutionAuthority,false);
  assert.equal(receipt.selection.executionPermitted,true);
  assert.equal(receipt.options.find(x=>x.id==='redeploy').score,0.91);
  assert.match(receipt.claimBoundary,/No realised financial saving/);
});

test('realised financial proof upgrades receipt status without inventing value',()=>{
  const proof={recordType:'vector-decision-outcome-proof',episodeId:'ep-1',tenant:'alpha',classification:'REALISED_FINANCIAL',metric:'labourCost',proofDigest:'proof-1',realisedFinancialOutcome:true,verifiedOperationalOutcome:true,currency:'GBP',claimBoundary:'Evidence bound.'};
  const receipt=createDecisionReceipt({episode,outcomeProofs:[proof]});
  assert.equal(receipt.status,'REALISED_VALUE_VERIFIED');
  assert.equal(receipt.outcomeProofs.length,1);
  assert.match(receipt.claimBoundary,/only where/);
});

test('proof from another tenant is ignored',()=>{
  const receipt=createDecisionReceipt({episode,outcomeProofs:[{recordType:'vector-decision-outcome-proof',episodeId:'ep-1',tenant:'beta'}]});
  assert.equal(receipt.outcomeProofs.length,0);
});
