const HIGH_RISK_METHOD = /^(?:create|write|unlink|copy|generate|revoke|set_|action_|button_|toggle_|reset_|install|uninstall|upgrade|confirm|cancel|post|pay|assign|approve|refuse)/i;
const CREDENTIAL_FIELD = /(?:^|[_-])(?:password|passwd|secret|token|api[_-]?key|authorization|credential)(?:$|[_-])/i;

function nonEmpty(value,name){
  const v=String(value??'').trim();
  if(!v) throw new TypeError(`${name} is required`);
  return v;
}

function isoMs(value,name){
  const ms=new Date(value).getTime();
  if(!Number.isFinite(ms)) throw new TypeError(`${name} must be an ISO-8601 timestamp`);
  return ms;
}

function pairKey(model,method){return `${model}:${method}`;}

export function createRpcReadPolicy({
  provider,
  allowedPairs=[],
  transportMethods=['POST'],
  transactionModel='per-call',
  singleCallConsistentMethods=['search_read'],
  credentialLikeFieldPattern=CREDENTIAL_FIELD
}={}){
  const providerId=nonEmpty(provider,'provider');
  if(!Array.isArray(allowedPairs)||allowedPairs.length===0) throw new TypeError('allowedPairs must contain at least one exact model/method pair');
  const pairs=new Map();
  for(const raw of allowedPairs){
    const model=nonEmpty(raw?.model,'allowedPairs.model');
    const method=nonEmpty(raw?.method,'allowedPairs.method');
    if(model.includes('*')||method.includes('*')) throw new TypeError('wildcard RPC allowlists are not permitted');
    if(raw.operationClass!=='read') throw new TypeError(`RPC pair ${model}:${method} must be explicitly classified as read`);
    if(HIGH_RISK_METHOD.test(method)) throw new TypeError(`high-risk RPC method cannot enter read allowlist: ${model}:${method}`);
    pairs.set(pairKey(model,method),{model,method,operationClass:'read'});
  }
  const transports=[...new Set(transportMethods.map(x=>nonEmpty(x,'transportMethods').toUpperCase()))];
  if(transports.length===0) throw new TypeError('transportMethods cannot be empty');
  const consistentMethods=[...new Set(singleCallConsistentMethods.map(String))];
  const pattern=credentialLikeFieldPattern instanceof RegExp
    ? new RegExp(credentialLikeFieldPattern.source,credentialLikeFieldPattern.flags.replace(/[gy]/g,''))
    : CREDENTIAL_FIELD;
  return Object.freeze({
    provider:providerId,
    allowedPairs:Object.freeze([...pairs.values()].map(pair=>Object.freeze({...pair}))),
    allowedPairKeys:Object.freeze([...pairs.keys()]),
    transportMethods:Object.freeze(transports),
    transactionModel,
    singleCallConsistentMethods:Object.freeze(consistentMethods),
    credentialLikeFieldPattern:pattern
  });
}

export function authorizeRpcRead({policy,model,method,httpMethod='POST',fields=[]}={}){
  if(!Array.isArray(policy?.allowedPairKeys)) throw new TypeError('policy is required');
  const m=nonEmpty(model,'model');
  const fn=nonEmpty(method,'method');
  const transport=nonEmpty(httpMethod,'httpMethod').toUpperCase();
  if(!policy.transportMethods.includes(transport)) throw new Error(`RPC transport ${transport} is not allowlisted for ${policy.provider}`);
  if(HIGH_RISK_METHOD.test(fn)) throw new Error(`RPC mutation/control method denied: ${m}:${fn}`);
  if(!policy.allowedPairKeys.includes(pairKey(m,fn))) throw new Error(`RPC model/method not allowlisted: ${m}:${fn}`);
  const requestedFields=[...(fields||[])].map(String);
  const blocked=requestedFields.filter(field=>policy.credentialLikeFieldPattern.test(field));
  if(blocked.length) throw new Error(`credential-like fields are not allowed in generic RPC reads: ${blocked.join(', ')}`);
  return {
    provider:policy.provider,
    model:m,
    method:fn,
    httpMethod:transport,
    operationClass:'read',
    singleCallTransactionConsistent:policy.singleCallConsistentMethods.includes(fn),
    transportVerbConfersWriteAuthority:false
  };
}

export function assessRpcReadBatch({policy,calls,maxSkewMs=5000}={}){
  if(!Array.isArray(calls)||calls.length===0) throw new TypeError('calls must contain at least one RPC read');
  const threshold=Number(maxSkewMs);
  if(!Number.isFinite(threshold)||threshold<0) throw new TypeError('maxSkewMs must be a non-negative finite number');
  const reviewed=calls.map((call,index)=>{
    const auth=authorizeRpcRead({policy,...call});
    const startedAtMs=isoMs(call.startedAt,`calls[${index}].startedAt`);
    const completedAtMs=isoMs(call.completedAt,`calls[${index}].completedAt`);
    if(completedAtMs<startedAtMs) throw new TypeError(`calls[${index}] completion precedes start`);
    return {...auth,startedAtMs,completedAtMs,partial:call.partial===true,transactionId:call.transactionId?String(call.transactionId):null};
  });
  const windowStartMs=Math.min(...reviewed.map(x=>x.startedAtMs));
  const windowEndMs=Math.max(...reviewed.map(x=>x.completedAtMs));
  const skewMs=windowEndMs-windowStartMs;
  const sameTransaction=reviewed.length===1 || (
    policy.transactionModel==='shared' && reviewed.every(x=>x.transactionId) && new Set(reviewed.map(x=>x.transactionId)).size===1
  );
  const partial=reviewed.some(x=>x.partial);
  const bounded=!partial && skewMs<=threshold;
  return {
    provider:policy.provider,
    callCount:reviewed.length,
    transactionModel:policy.transactionModel,
    atomicAcrossCalls:sameTransaction,
    observationWindow:{start:new Date(windowStartMs).toISOString(),end:new Date(windowEndMs).toISOString(),skewMs,maxSkewMs:threshold},
    partial,
    consistency:partial?'partial-read-set':sameTransaction?'transaction-consistent':bounded?'bounded-observation-window':'skew-exceeded',
    safeForAtomicJoin:sameTransaction&&!partial,
    safeForBoundedTemporalJoin:bounded,
    requiresProvenanceWindow:!sameTransaction,
    recommendation:!sameTransaction&&policy.transactionModel==='per-call'
      ?'prefer-provider-single-call-method-or-preserve-observation-window-and-reconcile'
      :'preserve-transaction-and-source-watermark'
  };
}
