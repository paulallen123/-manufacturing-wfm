#!/usr/bin/env node
import assert from 'node:assert/strict';
import {evaluateConsumptionProof,nextRealWorldSimulation} from './point-of-consumption-proof.mjs';

const base={
  expectedIdentity:'VECTOR_DEMO_V1',
  evidence:{
    sourceBound:true,
    buildAdmitted:true,
    runtimeStarted:true,
    internalHealth:true,
    publicHttpStatus:200,
    applicationIdentity:'VECTOR_DEMO_V1',
    userActionSucceeded:true,
    downstreamOutcomeVerified:true,
    recoveryVerified:true
  }
};

const green=evaluateConsumptionProof(base);
assert.equal(green.status,'PROVEN_AT_CONSUMPTION');
assert.equal(green.claimAllowed,true);
assert.equal(nextRealWorldSimulation(green).action,'ATTACK_RECOVERY_AND_DRIFT');

const falseGreen=evaluateConsumptionProof({...base,evidence:{...base.evidence,publicHttpStatus:502}});
assert.equal(falseGreen.claimAllowed,false);
assert.equal(falseGreen.nextRequired,'PUBLIC_INGRESS_VERIFIED');
assert.match(falseGreen.failureReason,/public ingress/i);

const wrongApp=evaluateConsumptionProof({...base,evidence:{...base.evidence,applicationIdentity:'SOME_OTHER_APP'}});
assert.equal(wrongApp.nextRequired,'APPLICATION_IDENTITY_VERIFIED');

const brokenButton=evaluateConsumptionProof({...base,evidence:{...base.evidence,userActionSucceeded:false}});
assert.equal(brokenButton.nextRequired,'USER_ACTION_VERIFIED');

const noOutcome=evaluateConsumptionProof({...base,evidence:{...base.evidence,downstreamOutcomeVerified:false}});
assert.equal(noOutcome.nextRequired,'DOWNSTREAM_OUTCOME_VERIFIED');

const recovery=evaluateConsumptionProof({...base,requireRecovery:true,evidence:{...base.evidence,recoveryVerified:false}});
assert.equal(recovery.nextRequired,'RECOVERY_VERIFIED');
assert.equal(recovery.shareableProof,false);

console.log('VECTOR_POINT_OF_CONSUMPTION_PROOF=PASS cases=6');
