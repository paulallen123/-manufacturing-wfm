// Test-only shape adapter; all plan/movement behavior is exact published PR216.
import {evaluateControlledEnvironmentPlan} from './88185a0e94f5df15e32841fc227cfededbde27d8/frontier/controlled-environment-flow/controlled-environment-flow.mjs';
import {buildInterventionTransitionLedger} from './88185a0e94f5df15e32841fc227cfededbde27d8/frontier/controlled-environment-flow/intervention-transition-ledger.mjs';
export const assessControlledEnvironmentPlan=input=>evaluateControlledEnvironmentPlan(input);
export const projectControlledEnvironmentMovement=input=>{
  const r=buildInterventionTransitionLedger(input);
  return {...r,status:r.status==='ledger_ready'?'movement_ready':r.status};
};
