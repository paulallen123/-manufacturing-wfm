'use strict';
// Test-only shape adapter. All scheduling behavior remains exact r25 nextRetryDecision.
const {nextRetryDecision}=require('./historical-transport-runtime-policy.cjs');
exports.proofRetryDecision=(review,failure,state,now)=>{
  const r=nextRetryDecision(review,failure,{attempt:state.completedAttempts-1,firstFailureAt:state.firstFailureAt,operationKey:state.operationKey},now);
  return Object.freeze({...r,nextAttempt:r.attempt+1});
};
