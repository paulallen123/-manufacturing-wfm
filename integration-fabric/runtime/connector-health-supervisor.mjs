const HEALTH_STATES=new Set(['healthy','degraded','authentication_required','unreachable','unconfigured']);

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} is required`);
  const text=value.normalize('NFC').trim();
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}
function safeTime(value,name='time'){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return n;
}
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
}
function baseBinding({providerId,tenantId,connectionId}){
  return {
    providerId:required(providerId,'providerId'),
    tenantId:required(tenantId,'tenantId'),
    connectionId:required(connectionId,'connectionId')
  };
}
function backoffMs(failures){
  const exp=Math.max(0,Math.min(6,failures-1));
  return Math.min(3_600_000,30_000*(2**exp));
}
const AUTH_CODES=new Set(['WFM_PROVIDER_AUTH_REJECTED','WFM_SESSION_REAUTH_EXHAUSTED','WFM_SESSION_LOGIN_FAILED']);
const CONFIG_CODES=new Set(['WFM_PROVIDER_AUTH_CONFIGURATION_INVALID','WFM_PROVIDER_REQUEST_INVALID','WFM_ACQUISITION_BINDING_MISMATCH','WFM_PROVIDER_CONNECTION_BINDING_MISMATCH']);
const UNREACHABLE_CODES=new Set(['WFM_PROVIDER_READ_TIMEOUT','WFM_PROVIDER_TRANSPORT_ERROR']);
const DEGRADED_CODES=new Set(['WFM_PROVIDER_RATE_LIMITED','WFM_PROVIDER_HTTP_ERROR','WFM_PROVIDER_RESPONSE_INVALID','WFM_PROVIDER_RESPONSE_TOO_LARGE']);

function normalizeFailure(signal){
  const code=required(signal?.code??'WFM_PROVIDER_UNKNOWN_FAILURE','failure code');
  const status=signal?.status===undefined||signal.status===null?null:Number(signal.status);
  const retryable=signal?.retryable===true;
  return {code,status:Number.isInteger(status)?status:null,retryable};
}
function classifyFailure(priorFailures,failure){
  if(AUTH_CODES.has(failure.code)||failure.status===401||failure.status===403) return 'authentication_required';
  if(CONFIG_CODES.has(failure.code)) return 'unconfigured';
  if(UNREACHABLE_CODES.has(failure.code)) return priorFailures+1>=3?'unreachable':'degraded';
  if(DEGRADED_CODES.has(failure.code)||failure.retryable||failure.status===429||failure.status>=500) return 'degraded';
  return 'degraded';
}
function assertState(state){
  if(!state||state.schemaVersion!==1||!state.binding||!HEALTH_STATES.has(state.state)) throw new TypeError('valid connector health state is required');
  return state;
}

export function createConnectorHealthState({
  providerId,tenantId,connectionId,configured=true,nowMs=Date.now()
}={}){
  const now=safeTime(nowMs,'nowMs');
  return freeze({
    schemaVersion:1,
    binding:baseBinding({providerId,tenantId,connectionId}),
    state:configured===true?'degraded':'unconfigured',
    checkedAt:new Date(now).toISOString(),
    latencyMs:null,
    consecutiveFailures:0,
    lastSuccessAt:null,
    lastFailureAt:null,
    lastErrorCode:null,
    retryable:false,
    nextRetryAt:configured===true?now:null,
    recoveryCount:0,
    customerActionRequired:configured!==true,
    reconciliationRequired:false,
    writeRecoveryAllowed:false
  });
}

export function recordConnectorSuccess(state,{latencyMs=0,nowMs=Date.now(),recovered=false}={}){
  assertState(state);
  const now=safeTime(nowMs,'nowMs');
  const latency=Number(latencyMs);
  if(!Number.isSafeInteger(latency)||latency<0) throw new TypeError('latencyMs must be a non-negative safe integer');
  return freeze({
    ...structuredClone(state),
    state:'healthy',
    checkedAt:new Date(now).toISOString(),
    latencyMs:latency,
    consecutiveFailures:0,
    lastSuccessAt:new Date(now).toISOString(),
    lastErrorCode:null,
    retryable:false,
    nextRetryAt:null,
    recoveryCount:state.recoveryCount+(recovered?1:0),
    customerActionRequired:false,
    reconciliationRequired:recovered===true,
    writeRecoveryAllowed:false
  });
}

export function recordConnectorFailure(state,signal,{nowMs=Date.now()}={}){
  assertState(state);
  const now=safeTime(nowMs,'nowMs');
  const failure=normalizeFailure(signal);
  const failures=state.consecutiveFailures+1;
  const nextState=classifyFailure(state.consecutiveFailures,failure);
  const canRetry=failure.retryable||nextState==='unreachable'||DEGRADED_CODES.has(failure.code);
  return freeze({
    ...structuredClone(state),
    state:nextState,
    checkedAt:new Date(now).toISOString(),
    latencyMs:null,
    consecutiveFailures:failures,
    lastFailureAt:new Date(now).toISOString(),
    lastErrorCode:failure.code,
    retryable:canRetry,
    nextRetryAt:canRetry?now+backoffMs(failures):null,
    customerActionRequired:nextState==='authentication_required'||nextState==='unconfigured',
    reconciliationRequired:state.reconciliationRequired,
    writeRecoveryAllowed:false
  });
}

export function planConnectorRecovery(state,{
  managedCredentialRefreshAvailable=false,nowMs=Date.now()
}={}){
  assertState(state);
  const now=safeTime(nowMs,'nowMs');
  if(state.state==='healthy') return freeze({action:'none',automatic:false,reason:'healthy'});
  if(state.state==='unconfigured') return freeze({action:'configure',automatic:false,reason:'configuration-required'});
  if(state.state==='authentication_required'){
    if(managedCredentialRefreshAvailable===true) return freeze({action:'refresh-session-and-probe',automatic:true,reason:'managed-refresh-available'});
    return freeze({action:'reauthorize',automatic:false,reason:'customer-credential-action-required'});
  }
  if(state.nextRetryAt!==null&&now<state.nextRetryAt) return freeze({action:'wait',automatic:true,reason:'bounded-backoff',nextRetryAt:state.nextRetryAt});
  return freeze({action:'read-only-probe',automatic:true,reason:'retry-safe-read'});
}

function failureSignal(error){
  if(error&&typeof error==='object') return {
    code:typeof error.code==='string'?error.code:'WFM_PROVIDER_UNKNOWN_FAILURE',
    status:Number.isInteger(error.status)?error.status:null,
    retryable:error.retryable===true
  };
  return {code:'WFM_PROVIDER_UNKNOWN_FAILURE',status:null,retryable:false};
}

export async function runConnectorRecovery({
  state,managedCredentialRefreshAvailable=false,refreshSession,readOnlyProbe,verifyRecovery,
  nowMs=Date.now()
}={}){
  assertState(state);
  if(typeof readOnlyProbe!=='function') throw new TypeError('readOnlyProbe is required');
  if(typeof verifyRecovery!=='function') throw new TypeError('verifyRecovery is required');
  const plan=planConnectorRecovery(state,{managedCredentialRefreshAvailable,nowMs});
  if(plan.action==='none'||plan.action==='wait'||plan.automatic!==true){
    return freeze({status:'NO_AUTOMATIC_ACTION',plan,state,writeRecoveryPerformed:false});
  }
  if(plan.action==='refresh-session-and-probe'){
    if(typeof refreshSession!=='function') throw new TypeError('refreshSession is required for managed credential recovery');
    try{await refreshSession(freeze({binding:structuredClone(state.binding),reason:state.lastErrorCode}));}
    catch(error){
      const failed=recordConnectorFailure(state,failureSignal(error),{nowMs});
      return freeze({status:'RECOVERY_FAILED',plan,state:failed,writeRecoveryPerformed:false});
    }
  }
  let probe;
  try{
    probe=await readOnlyProbe(freeze({
      binding:structuredClone(state.binding),
      readOnly:true,
      writeAllowed:false,
      destructiveAllowed:false
    }));
  }catch(error){
    const failed=recordConnectorFailure(state,failureSignal(error),{nowMs});
    return freeze({status:'RECOVERY_FAILED',plan,state:failed,writeRecoveryPerformed:false});
  }
  if(!probe||probe.ok!==true||!Number.isSafeInteger(probe.latencyMs)||probe.latencyMs<0){
    const failed=recordConnectorFailure(state,{code:'WFM_CONNECTOR_RECOVERY_PROBE_INVALID',retryable:true},{nowMs});
    return freeze({status:'RECOVERY_FAILED',plan,state:failed,writeRecoveryPerformed:false});
  }
  const verification=freeze({
    binding:structuredClone(state.binding),
    receiptId:required(probe.receiptId,'probe.receiptId'),
    configurationFingerprint:required(probe.configurationFingerprint,'probe.configurationFingerprint'),
    observedAt:required(probe.observedAt,'probe.observedAt'),
    readOnly:true
  });
  if(await verifyRecovery(verification)!==true){
    const failed=recordConnectorFailure(state,{code:'WFM_CONNECTOR_RECOVERY_NOT_VERIFIED',retryable:true},{nowMs});
    return freeze({status:'RECOVERY_FAILED',plan,state:failed,writeRecoveryPerformed:false});
  }
  const healthy=recordConnectorSuccess(state,{latencyMs:probe.latencyMs,nowMs,recovered:true});
  return freeze({
    status:'RECOVERED_VERIFIED',
    plan,
    state:healthy,
    reconciliationRequired:true,
    writeRecoveryPerformed:false
  });
}
