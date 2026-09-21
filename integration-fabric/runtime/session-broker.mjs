function positiveSafeInteger(value,name,defaultValue){
  const number=value===undefined?defaultValue:Number(value);
  if(!Number.isSafeInteger(number)||number<=0) throw new TypeError(`${name} must be a positive safe integer`);
  return number;
}

function nonNegativeSafeInteger(value,name,defaultValue){
  const number=value===undefined?defaultValue:Number(value);
  if(!Number.isSafeInteger(number)||number<0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return number;
}

function scopeName(value){
  const text=String(value??'').normalize('NFC').trim();
  if(!text) throw new TypeError('scopeNamespace is required');
  if(text.includes('\0')) throw new TypeError('scopeNamespace contains NUL');
  return text;
}

function statusOf(error){
  const status=Number(error?.status);
  return Number.isInteger(status)?status:null;
}

function safeExecutorError(error,phase,overrideCode=null){
  const internal=typeof error?.code==='string'&&error.code.startsWith('WFM_SESSION_');
  const message=internal?String(error.message):(phase==='login'?'session login failed':'session read failed');
  const safe=new Error(message);
  const status=statusOf(error);
  if(status!==null) safe.status=status;
  safe.code=overrideCode||(internal?error.code:(phase==='login'?'WFM_SESSION_LOGIN_FAILED':'WFM_SESSION_READ_FAILED'));
  return safe;
}

function closedError(){
  const error=new Error('session scope was closed or replaced');
  error.code='WFM_SESSION_SCOPE_CLOSED';
  return error;
}

function resultError(message,code='WFM_SESSION_RESULT_INVALID'){
  const error=new Error(message);
  error.code=code;
  return error;
}

function cloneSafeResult(value,token,path='result',state={seen:new WeakSet(),nodes:0},depth=0){
  state.nodes++;
  if(state.nodes>100_000||depth>100) throw resultError('session result exceeds structural safety limits');
  if(value===null||typeof value==='boolean') return value;
  if(typeof value==='number'){
    if(!Number.isFinite(value)) throw resultError('session result contains a non-finite number');
    return value;
  }
  if(typeof value==='string'){
    if(value.includes(token)) throw resultError(`session secret attempted to leave trusted executor at ${path}`,'WFM_SESSION_SECRET_EGRESS');
    return value;
  }
  if(!value||typeof value!=='object') throw resultError(`session result contains unsupported data at ${path}`);
  if(state.seen.has(value)) throw resultError('session result contains a cycle');
  state.seen.add(value);

  if(Array.isArray(value)){
    const ownKeys=Reflect.ownKeys(value);
    if(ownKeys.some(key=>typeof key!=='string'||(key!=='length'&&!/^\d+$/.test(key)))) throw resultError('session result array contains unsupported properties');
    if(Object.keys(value).length!==value.length) throw resultError('session result array contains holes or hidden values');
    const copy=value.map((child,index)=>cloneSafeResult(child,token,`${path}[${index}]`,state,depth+1));
    return Object.freeze(copy);
  }

  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype&&prototype!==null) throw resultError(`session result must be plain JSON data at ${path}`);
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(value).some(key=>typeof key!=='string')) throw resultError('session result contains symbol properties');
  const copy={};
  for(const [key,descriptor] of Object.entries(descriptors)){
    if(!descriptor.enumerable||!('value' in descriptor)||descriptor.get||descriptor.set) throw resultError(`session result contains hidden or executable data at ${path}.${key}`);
    if(key.includes(token)) throw resultError(`session secret attempted to leave trusted executor at ${path}`,'WFM_SESSION_SECRET_EGRESS');
    copy[key]=cloneSafeResult(descriptor.value,token,`${path}.${key}`,state,depth+1);
  }
  return Object.freeze(copy);
}

function validateLoginResult(value,now){
  if(!value||typeof value!=='object'||Array.isArray(value)||(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)) throw new Error('login executor must return a plain session result object');
  const keys=Reflect.ownKeys(value);
  if(keys.length!==2||!keys.includes('token')||!keys.includes('expiresAt')) throw new Error('login executor must return only token and expiresAt');
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(!('value' in descriptors.token)||!('value' in descriptors.expiresAt)) throw new Error('login executor session fields must be inert data');
  const token=descriptors.token.value;
  if(typeof token!=='string') throw new Error('login executor returned an invalid session token');
  if(!token||token.length>65_536||/[\r\n\0]/.test(token)) throw new Error('login executor returned an invalid session token');
  const expiresAt=descriptors.expiresAt.value;
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now) throw new Error('login executor returned an invalid or expired expiry');
  return {token,expiresAt};
}

export function createSessionBroker({
  scopeAuthorizer,
  requestAuthorizer,
  loginExecutor,
  readExecutor,
  now=()=>Date.now(),
  maxScopes=1000,
  maxActivePerScope=1000,
  idleTtlMs=900_000,
  expirySafetyMs=0
}={}){
  if(typeof scopeAuthorizer!=='function') throw new TypeError('trusted scopeAuthorizer is required');
  if(typeof requestAuthorizer!=='function') throw new TypeError('trusted requestAuthorizer is required');
  if(typeof loginExecutor!=='function') throw new TypeError('trusted loginExecutor is required');
  if(typeof readExecutor!=='function') throw new TypeError('trusted readExecutor is required');
  if(typeof now!=='function') throw new TypeError('now must be a function');
  const scopeLimit=positiveSafeInteger(maxScopes,'maxScopes',1000);
  const activeLimit=positiveSafeInteger(maxActivePerScope,'maxActivePerScope',1000);
  const ttl=positiveSafeInteger(idleTtlMs,'idleTtlMs',900_000);
  const safety=nonNegativeSafeInteger(expirySafetyMs,'expirySafetyMs',0);
  const scopes=new Map();
  let epochSequence=0;
  let attemptSequence=0;

  function authorizeScope(scopeNamespace){
    if(scopeAuthorizer({scopeNamespace})!==true){
      const error=new Error(`session scope is not authorised: ${scopeNamespace}`);
      error.code='WFM_SESSION_SCOPE_UNAUTHORISED';
      throw error;
    }
  }

  function authorizeRequest(scopeNamespace,request){
    authorizeScope(scopeNamespace);
    if(requestAuthorizer({scopeNamespace,request})!==true){
      const error=new Error('session request is not authorised');
      error.code='WFM_SESSION_REQUEST_UNAUTHORISED';
      throw error;
    }
  }

  function currentTime(){
    const value=Number(now());
    if(!Number.isSafeInteger(value)||value<0) throw new Error('clock returned an invalid time');
    return value;
  }

  function idle(state){return state.activeLeases===0&&!state.refreshPromise;}

  function dispose(state){
    state.closed=true;
    state.token=null;
    state.expiresAt=0;
    state.failedRefresh=null;
  }

  function pruneIdle(){
    const time=currentTime();
    for(const [name,state] of scopes){
      if(idle(state)&&time-state.lastUsed>=ttl){dispose(state);scopes.delete(name);}
    }
  }

  function makeRoom(){
    pruneIdle();
    if(scopes.size<scopeLimit) return;
    const candidates=[...scopes.values()].filter(idle).sort((a,b)=>a.lastUsed-b.lastUsed||a.epoch-b.epoch);
    const victim=candidates[0];
    if(!victim){
      const error=new Error('session broker capacity is occupied by active leases');
      error.code='WFM_SESSION_BROKER_CAPACITY';
      throw error;
    }
    dispose(victim);
    scopes.delete(victim.scopeNamespace);
  }

  function stateFor(scopeNamespace){
    const name=scopeName(scopeNamespace);
    authorizeScope(name);
    const existing=scopes.get(name);
    if(existing&&!existing.closed) return existing;
    makeRoom();
    const state={
      scopeNamespace:name,
      epoch:++epochSequence,
      generation:0,
      token:null,
      expiresAt:0,
      refreshPromise:null,
      refreshAttemptId:null,
      failedRefresh:null,
      activeLeases:0,
      lastUsed:currentTime(),
      closed:false
    };
    scopes.set(name,state);
    return state;
  }

  function valid(state){
    return !state.closed&&typeof state.token==='string'&&state.token.length>0&&state.expiresAt-safety>currentTime();
  }

  function acquire(state){
    if(state.closed||scopes.get(state.scopeNamespace)!==state) throw closedError();
    if(state.activeLeases>=activeLimit){
      const error=new Error('session scope active-request limit reached');
      error.code='WFM_SESSION_SCOPE_BUSY';
      throw error;
    }
    state.activeLeases++;
    state.lastUsed=currentTime();
  }

  function release(state){
    state.activeLeases=Math.max(0,state.activeLeases-1);
    state.lastUsed=currentTime();
  }

  async function refreshState(state,{force=false,expectedGeneration=state.generation,refreshRequired=false}={}){
    authorizeScope(state.scopeNamespace);
    if(state.closed||scopes.get(state.scopeNamespace)!==state) throw closedError();
    if(state.refreshPromise) return state.refreshPromise;
    if(!force&&state.generation!==expectedGeneration&&valid(state)) return {generation:state.generation};
    if(!force&&state.failedRefresh?.expectedGeneration===expectedGeneration){
      throw safeExecutorError(state.failedRefresh.error,'login');
    }
    if(!force&&!refreshRequired&&valid(state)) return {generation:state.generation};
    if(force) state.failedRefresh=null;

    const capturedEpoch=state.epoch;
    const capturedGeneration=state.generation;
    const attemptId=++attemptSequence;
    state.refreshAttemptId=attemptId;
    const promise=(async()=>{
      let raw;
      try{
        raw=await loginExecutor({
          scopeNamespace:state.scopeNamespace,
          previousGeneration:capturedGeneration,
          attemptId
        });
      }catch(error){
        throw safeExecutorError(error,'login');
      }
      authorizeScope(state.scopeNamespace);
      const login=validateLoginResult(raw,currentTime());
      if(state.closed||scopes.get(state.scopeNamespace)!==state||state.epoch!==capturedEpoch||state.refreshAttemptId!==attemptId){
        throw closedError();
      }
      state.generation=capturedGeneration+1;
      state.token=login.token;
      state.expiresAt=login.expiresAt;
      state.failedRefresh=null;
      state.lastUsed=currentTime();
      return {generation:state.generation};
    })().catch(error=>{
      const safe=safeExecutorError(error,'login');
      if(!state.closed&&scopes.get(state.scopeNamespace)===state&&state.epoch===capturedEpoch&&state.generation===capturedGeneration){
        state.failedRefresh={expectedGeneration:capturedGeneration,error:safe};
      }
      throw safe;
    }).finally(()=>{
      if(state.refreshAttemptId===attemptId){state.refreshPromise=null;state.refreshAttemptId=null;}
    });
    state.refreshPromise=promise;
    return promise;
  }

  async function ensureSession(state){
    if(!valid(state)) await refreshState(state,{expectedGeneration:state.generation});
    if(!valid(state)) throw new Error('session refresh did not establish a valid session');
    return {generation:state.generation,token:state.token};
  }

  async function invokeRead(state,request,snapshot,recoveryAttempt){
    try{
      const value=await readExecutor({
        scopeNamespace:state.scopeNamespace,
        token:snapshot.token,
        generation:snapshot.generation,
        recoveryAttempt,
        request
      });
      return cloneSafeResult(value,snapshot.token);
    }catch(error){
      throw safeExecutorError(error,'read');
    }
  }

  async function execute({scopeNamespace,request}={}){
    const state=stateFor(scopeNamespace);
    acquire(state);
    try{
      authorizeRequest(state.scopeNamespace,request);
      const generationBeforeEnsure=state.generation;
      const priorContinuityExists=generationBeforeEnsure>0;
      const first=await ensureSession(state);
      const proactiveRecovery=priorContinuityExists&&first.generation!==generationBeforeEnsure;
      authorizeRequest(state.scopeNamespace,request);
      try{
        const value=await invokeRead(state,request,first,0);
        return Object.freeze({value,generation:first.generation,recoveryPerformed:proactiveRecovery,reconciliationRequired:proactiveRecovery});
      }catch(error){
        if(statusOf(error)!==401) throw error;
      }

      if(state.closed||scopes.get(state.scopeNamespace)!==state) throw closedError();
      authorizeRequest(state.scopeNamespace,request);
      let recovery;
      if(state.generation!==first.generation&&valid(state)) recovery={generation:state.generation,token:state.token};
      else{
        await refreshState(state,{expectedGeneration:first.generation,refreshRequired:true});
        recovery=await ensureSession(state);
      }
      authorizeRequest(state.scopeNamespace,request);
      try{
        const value=await invokeRead(state,request,recovery,1);
        return Object.freeze({value,generation:recovery.generation,recoveryPerformed:true,reconciliationRequired:true});
      }catch(error){
        if(statusOf(error)===401) throw safeExecutorError(error,'read','WFM_SESSION_REAUTH_EXHAUSTED');
        throw error;
      }
    }finally{
      release(state);
    }
  }

  async function rotate({scopeNamespace}={}){
    const state=stateFor(scopeNamespace);
    acquire(state);
    try{
      await refreshState(state,{force:true,expectedGeneration:state.generation});
      return Object.freeze({scopeNamespace:state.scopeNamespace,generation:state.generation});
    }finally{
      release(state);
    }
  }

  function close({scopeNamespace,force=false}={}){
    const name=scopeName(scopeNamespace);
    const state=scopes.get(name);
    if(!state) return false;
    if(!force&&!idle(state)) return false;
    dispose(state);
    scopes.delete(name);
    return true;
  }

  function diagnostics(){
    pruneIdle();
    const safe=[...scopes.values()].map(state=>Object.freeze({
      scopeNamespace:state.scopeNamespace,
      epoch:state.epoch,
      generation:state.generation,
      hasSession:valid(state),
      expiresAt:state.expiresAt||null,
      activeLeases:state.activeLeases,
      refreshInFlight:Boolean(state.refreshPromise),
      refreshBlockedByFailure:Boolean(state.failedRefresh)
    }));
    return Object.freeze({scopeCount:safe.length,maxScopes:scopeLimit,scopes:Object.freeze(safe)});
  }

  return Object.freeze({execute,rotate,close,diagnostics});
}
