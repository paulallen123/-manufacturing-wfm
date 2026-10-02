'use strict';

const { createHash } = require('node:crypto');
const { types: { isProxy } } = require('node:util');

// r25 transport ceilings. This module schedules only; it never executes or authorizes a read.
const TRANSPORTS = Object.freeze(Object.fromEntries([
  ['api',5,300000,250,15000,false],
  ['webhook',8,600000,250,30000,true],
  ['queue-stream',10,900000,250,30000,true],
  ['secure-file',6,900000,1000,60000,true],
  ['read-only-db',4,180000,500,10000,false],
  ['identity',4,180000,500,10000,false],
  ['on-prem-agent',10,1800000,1000,60000,true],
  ['ipaas',8,900000,500,30000,true]
].map(([name,maxAttempts,maxElapsedMs,baseDelayMs,maxDelayMs,duplicateSensitive])=>
  [name,Object.freeze({maxAttempts,maxElapsedMs,baseDelayMs,maxDelayMs,duplicateSensitive})])));
const RETRYABLE = new Set(['timeout','connection-reset','temporarily-unavailable','rate-limited','provider-busy','network-unreachable','dns-temporary','tls-temporary']);
const TERMINAL = new Set(['wrong-target','permission-denied','invalid-scope','schema-mismatch','bad-request','write-attempt','credential-missing','unsupported-operation']);
const REAUTH = new Set(['auth-expired','auth-revoked','invalid-credential']);
const RETRY_STATUS = new Set([408,425,429,500,502,503,504]);
const TERMINAL_STATUS = new Set([400,403,404,405,409,410,422]);
const ALIASES = Object.freeze({
  'provider-timeout':'timeout', 'provider-unavailable':'temporarily-unavailable',
  'provider-temporarily-unavailable':'temporarily-unavailable',
  'provider-rate-limited':'rate-limited', 'provider-network-unreachable':'network-unreachable'
});

function record(value) {
  if(!value || typeof value!=='object' || isProxy(value) || Array.isArray(value)) throw new TypeError('record');
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype && prototype!==null) throw new TypeError('prototype');
  const result=Object.create(null);
  for(const key of Reflect.ownKeys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(typeof key!=='string' || !descriptor || !Object.hasOwn(descriptor,'value')) throw new TypeError('descriptor');
    result[key]=descriptor.value;
  }
  return result;
}
const integer = value => typeof value==='number' && Number.isSafeInteger(value);
const timestamp = value => integer(value) && value>0 && value<=8640000000000000;
function disposition(action,reason,extra={}) {
  return Object.freeze({action,reason,retryable:action==='RETRY',exhausted:action==='QUARANTINE',...extra});
}
function policyFor(review) {
  if(typeof review.transport!=='string' || !Object.hasOwn(TRANSPORTS,review.transport) ||
     typeof review.reviewedDigest!=='string' || !/^[a-f0-9]{64}$/.test(review.reviewedDigest)) throw new TypeError('review');
  const policy={...TRANSPORTS[review.transport]};
  if(Object.hasOwn(review,'retryPolicy')) {
    const limits=record(review.retryPolicy);
    for(const key of Object.keys(limits)) {
      if(!['maxAttempts','maxElapsedMs'].includes(key) || !integer(limits[key]) || limits[key]<=0 || limits[key]>policy[key]) throw new TypeError('limit');
      policy[key]=limits[key];
    }
  }
  return policy;
}
function classify(failure) {
  const codes=[];
  for(const key of ['code','failureClass']) if(Object.hasOwn(failure,key)) {
    const raw=failure[key];
    if(typeof raw!=='string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(raw)) throw new TypeError('code');
    codes.push(Object.hasOwn(ALIASES,raw)?ALIASES[raw]:raw);
  }
  const statuses=[];
  for(const key of ['status','statusCode','httpStatus']) if(Object.hasOwn(failure,key)) {
    const value=failure[key];
    if(!integer(value) || value<100 || value>599) throw new TypeError('status');
    statuses.push(value);
  }
  if(new Set(statuses).size>1) throw new TypeError('conflicting status');
  const status=statuses[0];
  const auth=codes.find(code=>REAUTH.has(code));
  if(auth || status===401) return {action:'REAUTHORIZE',reason:auth || 'auth-expired'};
  const terminal=codes.find(code=>TERMINAL.has(code));
  if(terminal || TERMINAL_STATUS.has(status)) return {action:'BLOCK',reason:terminal || 'terminal-provider-status'};
  const transient=codes.find(code=>RETRYABLE.has(code));
  if(transient || RETRY_STATUS.has(status)) return {action:'RETRY',reason:transient || 'transient-provider-status'};
  return {action:'BLOCK',reason:'unknown-failure'};
}
function retryHint(failure,now) {
  const hints=[0];
  if(Object.hasOwn(failure,'retryAfterMs')) {
    const value=failure.retryAfterMs;
    if(typeof value!=='number' || !Number.isFinite(value) || value<0 || !Number.isSafeInteger(Math.ceil(value))) throw new TypeError('hint');
    hints.push(Math.ceil(value));
  }
  if(Object.hasOwn(failure,'retryAfter')) {
    const value=failure.retryAfter;
    let delay;
    if(typeof value==='number' && Number.isFinite(value) && value>=0) delay=Math.ceil(value*1000);
    else if(typeof value==='string' && value.length<=80 && /^\d+(?:\.\d+)?$/.test(value)) delay=Math.ceil(Number(value)*1000);
    else if(typeof value==='string' && /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
      const at=Date.parse(value);
      if(!Number.isFinite(at) || new Date(at).toUTCString()!==value) throw new TypeError('date hint');
      delay=Math.max(0,at-now);
    } else throw new TypeError('hint');
    if(!integer(delay) || delay<0) throw new TypeError('hint size');
    hints.push(delay);
  }
  return Math.max(...hints);
}

/**
 * Evaluate timing for an already admitted read-proof operation. Caller retains all
 * admission, durable state, stable-key and execution authority. RETRY is no proof.
 * completedAttempts includes the first failed provider attempt; firstFailureAt
 * must be the immutable canonical durable anchor. No wall-clock or I/O is read.
 */
function proofRetryDecision(reviewInput,failureInput,stateInput,now) {
  let review,failure,state,policy;
  try {
    if(!timestamp(now)) throw new TypeError('clock');
    review=record(reviewInput); failure=record(failureInput); state=record(stateInput); policy=policyFor(review);
    if(!integer(state.completedAttempts) || state.completedAttempts<1 || state.completedAttempts>=Number.MAX_SAFE_INTEGER ||
       !timestamp(state.firstFailureAt) || state.firstFailureAt>now) throw new TypeError('state');
    if(Object.hasOwn(state,'authorizationExpiresAt') && !timestamp(state.authorizationExpiresAt)) throw new TypeError('expiry');
    if(Object.hasOwn(state,'operationKey') && state.operationKey!==undefined &&
       (typeof state.operationKey!=='string' || !/^[A-Za-z0-9._:-]{1,200}$/.test(state.operationKey))) throw new TypeError('key');
  } catch {
    return disposition('BLOCK','invalid-retry-input');
  }
  if(state.operation!=='read-proof') return disposition('BLOCK','operation-not-replayable');
  if(state.authorizationValid!==true) return disposition('BLOCK','current-read-authorization-required');
  if(state.authorizationExpiresAt!==undefined && state.authorizationExpiresAt<=now) return disposition('REAUTHORIZE','auth-expired');
  let classification;
  try { classification=classify(failure); } catch { return disposition('BLOCK','invalid-failure-classification'); }
  if(classification.action!=='RETRY') return disposition(classification.action,classification.reason);
  if(policy.duplicateSensitive && !state.operationKey) return disposition('BLOCK','idempotency-key-required-before-retry');
  const elapsed=now-state.firstFailureAt;
  const metadata={nextAttempt:state.completedAttempts+1,firstFailureAt:state.firstFailureAt};
  if(state.completedAttempts>=policy.maxAttempts || elapsed>=policy.maxElapsedMs) return disposition('QUARANTINE','retry-budget-exhausted',metadata);
  let providerDelay;
  try { providerDelay=retryHint(failure,now); } catch { return disposition('BLOCK','invalid-retry-hint'); }
  const retryIndex=state.completedAttempts;
  const base=Math.min(policy.maxDelayMs,policy.baseDelayMs*2**(retryIndex-1));
  const spread=Math.max(25,Math.floor(base/5));
  const material=review.reviewedDigest+':'+(state.operationKey || '')+':'+retryIndex;
  const jitter=parseInt(createHash('sha256').update(material).digest('hex').slice(0,8),16)%(spread+1);
  const retryAfterMs=Math.max(base+jitter,providerDelay);
  if(retryAfterMs>policy.maxElapsedMs-elapsed || !timestamp(now+retryAfterMs)) return disposition('QUARANTINE','retry-window-would-be-exceeded',metadata);
  if(state.authorizationExpiresAt!==undefined && now+retryAfterMs>=state.authorizationExpiresAt) return disposition('REAUTHORIZE','authorization-expires-before-retry');
  return disposition('RETRY',classification.reason,{...metadata,retryAfterMs,nextAttemptAt:new Date(now+retryAfterMs).toISOString()});
}

module.exports=Object.freeze({proofRetryDecision});
