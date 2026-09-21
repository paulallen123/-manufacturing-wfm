import crypto from 'node:crypto';

function required(value,name){
  const text=String(value??'').normalize('NFC').trim();
  if(!text) throw new TypeError(`${name} is required`);
  if(text.includes('\0')) throw new TypeError(`${name} contains NUL`);
  return text;
}

function unique(values,name){
  if(!Array.isArray(values)) throw new TypeError(`${name} must be an array`);
  return [...new Set(values.map(value=>required(value,name)))];
}

function cookieNames(values,name){
  const names=unique(values,name);
  for(const value of names){
    if(!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value)) throw new TypeError(`${name} contains an invalid cookie name`);
  }
  return names;
}

function deepFreeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value)) return value;
  for(const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function checkedEndpoint(endpointUrl,apiVersion){
  const url=new URL(required(endpointUrl,'endpointUrl'));
  if(url.protocol!=='https:') throw new TypeError('session endpoint requires HTTPS');
  if(url.username||url.password) throw new TypeError('session endpoint must not contain credentials');
  if(url.search||url.hash) throw new TypeError('session endpoint must not contain query or fragment');
  const basePath=url.pathname.replace(/\/+$/,'');
  if(!basePath||!basePath.endsWith(`/${apiVersion}`)) throw new TypeError('session endpoint base path must end with the declared API version');
  return {origin:url.origin.toLowerCase(),basePath};
}

function sessionScopeNamespace(material){
  const digest=crypto.createHash('sha256').update(JSON.stringify(material),'utf8').digest('hex');
  return `session:v1:${digest}`;
}

function positiveSafeInteger(value,name,defaultValue){
  const number=value===undefined?defaultValue:Number(value);
  if(!Number.isSafeInteger(number)||number<=0) throw new TypeError(`${name} must be a positive safe integer`);
  return number;
}

export function createSessionReadPolicy({
  providerId,wfmTenantId,connectionId,endpointUrl,company,principalId,credentialRevision,apiVersion,
  sessionCookieNames=[],affinityCookieNames=[],allowedResources=[],deniedResources=[],
  allowedQueryParameters=[],
  maxPages,maxBytesPerPage,maxElapsedMs
}={}){
  const version=required(apiVersion,'apiVersion');
  const endpoint=checkedEndpoint(endpointUrl,version);
  const scope={
    providerId:required(providerId,'providerId'),
    wfmTenantId:required(wfmTenantId,'wfmTenantId'),
    connectionId:required(connectionId,'connectionId'),
    endpointOrigin:endpoint.origin,
    endpointBasePath:endpoint.basePath,
    company:required(company,'company'),
    principalId:required(principalId,'principalId'),
    credentialRevision:required(credentialRevision,'credentialRevision'),
    apiVersion:version
  };
  const sessionNames=cookieNames(sessionCookieNames,'sessionCookieNames');
  if(sessionNames.length===0) throw new TypeError('at least one session cookie name is required');
  const affinityNames=cookieNames(affinityCookieNames,'affinityCookieNames');
  const overlap=sessionNames.filter(name=>affinityNames.includes(name));
  if(overlap.length) throw new TypeError(`cookie cannot be both session credential and affinity hint: ${overlap.join(', ')}`);
  const allowed=unique(allowedResources,'allowedResources');
  if(allowed.length===0) throw new TypeError('at least one allowed resource is required');
  const denied=unique(deniedResources,'deniedResources');
  const allowedQueries=unique(allowedQueryParameters,'allowedQueryParameters');
  const cookieSemantics=Object.fromEntries([
    ...sessionNames.map(name=>[name,'credential-secret']),
    ...affinityNames.map(name=>[name,'routing-hint-only'])
  ]);
  return deepFreeze({
    schemaVersion:1,
    ...scope,
    sessionScopeNamespace:sessionScopeNamespace(scope),
    sessionCookieNames:sessionNames,
    affinityCookieNames:affinityNames,
    cookieSemantics,
    allowedResources:allowed,
    deniedResources:denied,
    allowedQueryParameters:allowedQueries,
    allowedMethods:['GET','HEAD'],
    readBudget:{
      maxPages:positiveSafeInteger(maxPages,'maxPages',10_000),
      maxBytesPerPage:positiveSafeInteger(maxBytesPerPage,'maxBytesPerPage',10_000_000),
      maxElapsedMs:positiveSafeInteger(maxElapsedMs,'maxElapsedMs',900_000)
    },
    affinityMayEstablishAuthentication:false,
    affinityMayEstablishCompleteness:false,
    sessionSecretsAllowedInEvidence:false,
    sessionReuseAcrossScopeAllowed:false
  });
}

function assertPolicy(policy){
  if(!policy||policy.schemaVersion!==1||!policy.sessionScopeNamespace) throw new TypeError('invalid session read policy');
}

function assertQueryAuthority(policy,url){
  const seen=new Set();
  for(const [key] of url.searchParams){
    if(seen.has(key)) throw new Error(`duplicate query parameter is not permitted: ${key}`);
    seen.add(key);
    if(!policy.allowedQueryParameters.includes(key)) throw new Error(`query parameter is not allowlisted: ${key}`);
  }
  const top=url.searchParams.get('$top');
  if(top!==null&&(!/^\d+$/.test(top)||BigInt(top)<=0n)) throw new Error('page size must be a positive integer');
  const skip=url.searchParams.get('$skip');
  if(skip!==null&&!/^\d+$/.test(skip)) throw new Error('$skip must be an unsigned integer');
  const token=url.searchParams.get('$skiptoken');
  if(token!==null&&!token.trim()) throw new Error('$skiptoken must not be empty');
  if(skip!==null&&token!==null) throw new Error('only one pagination cursor is permitted');
}

function parseAuthorizedUrl(policy,requestUrl){
  const url=new URL(required(requestUrl,'requestUrl'));
  if(url.username||url.password) throw new Error('session read URL must not contain credentials');
  if(url.protocol!=='https:') throw new Error('session read requires HTTPS');
  if(url.hash) throw new Error('session read URL must not contain a fragment');
  if(url.origin.toLowerCase()!==policy.endpointOrigin) throw new Error('session read origin does not match exact endpoint authority');
  const prefix=`${policy.endpointBasePath}/`;
  if(!url.pathname.startsWith(prefix)) throw new Error('session read path is outside the authorised API base path or version');
  const tail=url.pathname.slice(prefix.length);
  if(!tail||tail.includes('..')) throw new Error('session read resource path is invalid');
  const resource=decodeURIComponent(tail.split('/')[0]).replace(/\(.*/,'');
  if(policy.deniedResources.includes(resource)) throw new Error(`session resource is explicitly denied: ${resource}`);
  if(!policy.allowedResources.includes(resource)) throw new Error(`session resource is not allowlisted: ${resource}`);
  assertQueryAuthority(policy,url);
  return {url,resource};
}

export function authorizeSessionRead({policy,requestUrl,method='GET',operationClass='read'}={}){
  assertPolicy(policy);
  const verb=required(method,'method').toUpperCase();
  if(!policy.allowedMethods.includes(verb)) throw new Error('session authority permits GET or HEAD reads only');
  if(operationClass!=='read') throw new Error('session authority requires a read operation class');
  const {url,resource}=parseAuthorizedUrl(policy,requestUrl);
  return deepFreeze({
    authorised:true,
    method:verb,
    resource,
    requestOrigin:url.origin.toLowerCase(),
    sessionScopeNamespace:policy.sessionScopeNamespace,
    checkpointAdvanceAllowed:false
  });
}

function canonicalUrl(value,base){
  const url=new URL(value,base);
  const entries=[...url.searchParams.entries()].sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv));
  const params=new URLSearchParams(entries);
  return `${url.origin.toLowerCase()}${url.pathname}${params.size?`?${params.toString()}`:''}`;
}

function queryContract(url){
  return [...url.searchParams.entries()]
    .filter(([key])=>key!=='$skip'&&key!=='$skiptoken')
    .sort(([ak,av],[bk,bv])=>ak.localeCompare(bk)||av.localeCompare(bv));
}

function assertSingleParameter(url,name){
  const values=url.searchParams.getAll(name);
  if(values.length>1) throw new Error(`next link contains duplicate ${name} parameters`);
  return values[0]??null;
}

export function validateSessionNextLink({policy,currentRequestUrl,nextLink,seenNextLinks=[],pageNumber=1,pageBytes=0,elapsedMs=0}={}){
  assertPolicy(policy);
  const current=parseAuthorizedUrl(policy,currentRequestUrl);
  const nextUrl=new URL(required(nextLink,'nextLink'),current.url);
  const next=authorizeSessionRead({policy,requestUrl:nextUrl.href});
  if(next.resource!==current.resource) throw new Error('next link changed resource');
  if(nextUrl.pathname!==current.url.pathname) throw new Error('next link changed exact entity path');

  const page=Number(pageNumber),bytes=Number(pageBytes),elapsed=Number(elapsedMs);
  if(!Number.isSafeInteger(page)||page<=0||page>policy.readBudget.maxPages) throw new Error('next link exceeded page budget');
  if(!Number.isSafeInteger(bytes)||bytes<0||bytes>policy.readBudget.maxBytesPerPage) throw new Error('next link exceeded byte budget');
  if(!Number.isSafeInteger(elapsed)||elapsed<0||elapsed>policy.readBudget.maxElapsedMs) throw new Error('next link exceeded elapsed-time budget');

  const top=assertSingleParameter(nextUrl,'$top');
  if(top!==null&&(!/^\d+$/.test(top)||BigInt(top)<=0n)) throw new Error('next link page size must be a positive integer');
  if(JSON.stringify(queryContract(current.url))!==JSON.stringify(queryContract(nextUrl))){
    throw new Error('next link changed query semantics');
  }

  const skip=assertSingleParameter(nextUrl,'$skip');
  const token=assertSingleParameter(nextUrl,'$skiptoken');
  if((skip===null)===(token===null)) throw new Error('next link must contain exactly one bounded cursor');
  let cursorKind;
  let cursorValue;
  if(skip!==null){
    if(!/^\d+$/.test(skip)) throw new Error('next link $skip cursor must be an unsigned integer');
    const currentSkip=current.url.searchParams.get('$skip');
    if(currentSkip!==null&&(/^\d+$/.test(currentSkip))&&BigInt(skip)<=BigInt(currentSkip)) throw new Error('next link cursor did not advance');
    cursorKind='skip'; cursorValue=skip;
  }else{
    if(!token.trim()) throw new Error('next link $skiptoken cursor is empty');
    cursorKind='skiptoken'; cursorValue=token;
  }

  const canonical=canonicalUrl(nextUrl.href);
  const seen=new Set((seenNextLinks||[]).map(value=>canonicalUrl(value,current.url)));
  if(canonical===canonicalUrl(current.url.href)||seen.has(canonical)) throw new Error('next link loop or repeated cursor detected');
  return deepFreeze({
    authorised:true,
    nextUrl:canonical,
    resource:next.resource,
    cursorKind,
    cursorValue,
    sessionScopeNamespace:policy.sessionScopeNamespace,
    checkpointAdvanceAllowed:false
  });
}

export function sessionFailureDecision({status,reauthAttempts=0,affinityLost=false}={}){
  const code=Number(status);
  if(code===401&&Number(reauthAttempts)===0){
    return deepFreeze({
      action:'reauthenticate-once',
      invalidateSession:true,
      checkpointAdvanceAllowed:false,
      restartPageChainFromCommittedCheckpoint:true,
      requiresOverlapReplay:true
    });
  }
  if(code===401) return deepFreeze({action:'stop-credential-diagnostic',checkpointAdvanceAllowed:false});
  if(code===403) return deepFreeze({action:'stop-permission-diagnostic',checkpointAdvanceAllowed:false});
  if(affinityLost===true){
    return deepFreeze({
      action:'reacquire-affinity-and-replay-uncommitted-page',
      requiresNewCheckpointNamespace:false,
      checkpointAdvanceAllowed:false
    });
  }
  if(code===429||(code>=500&&code<=599)) return deepFreeze({action:'retry-current-session-with-backoff',checkpointAdvanceAllowed:false});
  return deepFreeze({action:'stop-and-diagnose',checkpointAdvanceAllowed:false});
}

export function assessSessionScopeTransition({fromPolicy,toPolicy}={}){
  assertPolicy(fromPolicy); assertPolicy(toPolicy);
  const changed=fromPolicy.sessionScopeNamespace!==toPolicy.sessionScopeNamespace;
  return deepFreeze({
    sessionReuseAllowed:!changed,
    requiresNewCheckpointNamespace:changed,
    requiresReconciliation:changed,
    reason:changed?'session-source-scope-changed':'same-session-source-scope'
  });
}
