#!/usr/bin/env node

const ORDER=[
  'SOURCE_BOUND',
  'BUILD_ADMITTED',
  'RUNTIME_STARTED',
  'INTERNAL_HEALTH_VERIFIED',
  'PUBLIC_INGRESS_VERIFIED',
  'APPLICATION_IDENTITY_VERIFIED',
  'USER_ACTION_VERIFIED',
  'DOWNSTREAM_OUTCOME_VERIFIED',
  'RECOVERY_VERIFIED'
];

export function evaluateConsumptionProof(input={}){
  const expectedIdentity=String(input.expectedIdentity||'').trim();
  const evidence=input.evidence||{};
  const requiredRecovery=input.requireRecovery===true;
  const required=[
    ['SOURCE_BOUND',evidence.sourceBound===true,'exact source identity missing'],
    ['BUILD_ADMITTED',evidence.buildAdmitted===true,'exact build admission missing'],
    ['RUNTIME_STARTED',evidence.runtimeStarted===true,'runtime startup not proven'],
    ['INTERNAL_HEALTH_VERIFIED',evidence.internalHealth===true,'internal health not proven'],
    ['PUBLIC_INGRESS_VERIFIED',Number(evidence.publicHttpStatus)>=200&&Number(evidence.publicHttpStatus)<300,'public ingress is not 2xx'],
    ['APPLICATION_IDENTITY_VERIFIED',Boolean(expectedIdentity)&&String(evidence.applicationIdentity||'')===expectedIdentity,'application identity mismatch'],
    ['USER_ACTION_VERIFIED',evidence.userActionSucceeded===true,'intended user action not verified'],
    ['DOWNSTREAM_OUTCOME_VERIFIED',evidence.downstreamOutcomeVerified===true,'downstream/customer outcome not independently verified']
  ];
  if(requiredRecovery) required.push(['RECOVERY_VERIFIED',evidence.recoveryVerified===true,'restart/recovery not verified']);

  const failed=required.find(([,ok])=>!ok);
  const completed=failed ? ORDER.indexOf(failed[0]) : (requiredRecovery?ORDER.indexOf('RECOVERY_VERIFIED'):ORDER.indexOf('DOWNSTREAM_OUTCOME_VERIFIED'));
  const lastVerified=completed<=0?null:ORDER[completed-1];

  return Object.freeze({
    contractVersion:'VECTOR_POINT_OF_CONSUMPTION_PROOF_V1',
    expectedIdentity,
    requiredRecovery,
    status:failed?'UNPROVEN':'PROVEN_AT_CONSUMPTION',
    claimAllowed:!failed,
    shareableProof:!failed,
    lastVerified,
    nextRequired:failed?.[0]||null,
    failureReason:failed?.[2]||null,
    stages:Object.freeze(required.map(([stage,ok,reason])=>Object.freeze({stage,passed:Boolean(ok),reason:ok?null:reason})))
  });
}

export function nextRealWorldSimulation(proof={}){
  if(proof.claimAllowed===true){
    return Object.freeze({
      action:'ATTACK_RECOVERY_AND_DRIFT',
      rationale:'The intended customer outcome passed; now simulate the next failure boundary rather than repeating the happy path.'
    });
  }
  const map={
    SOURCE_BOUND:'bind exact source/release identity',
    BUILD_ADMITTED:'run exact-image admission',
    RUNTIME_STARTED:'start the packaged runtime exactly as hosted',
    INTERNAL_HEALTH_VERIFIED:'probe the in-container health endpoint',
    PUBLIC_INGRESS_VERIFIED:'open the public origin from outside the hosting control plane',
    APPLICATION_IDENTITY_VERIFIED:'verify the expected application identity/content, not just HTTP 200',
    USER_ACTION_VERIFIED:'perform the same tap/click/API action the intended user will perform',
    DOWNSTREAM_OUTCOME_VERIFIED:'read back the downstream system/customer-visible state independently',
    RECOVERY_VERIFIED:'restart/fail the service and repeat the customer outcome'
  };
  return Object.freeze({
    action:'SIMULATE_NEXT_REAL_USER_STEP',
    stage:proof.nextRequired||'UNKNOWN',
    instruction:map[proof.nextRequired]||'preserve evidence and fail closed until the next real-world step is identified'
  });
}
