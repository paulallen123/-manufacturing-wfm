#!/usr/bin/env node
import crypto from 'node:crypto';

export async function verifyHostedPublicRuntime({
  origin,
  path='/',
  expectedMarker,
  attempts=8,
  intervalMs=1500,
  timeoutMs=5000,
  allowHttp=false,
  fetchImpl=globalThis.fetch
}={}) {
  if (!origin) throw new Error('origin is required');
  if (!expectedMarker) throw new Error('expectedMarker is required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');

  const url=new URL(path, origin);
  if (!allowHttp && url.protocol !== 'https:') throw new Error('Hosted proof requires HTTPS.');
  const failureMarkers=[
    /Application failed to respond/i,
    /connection refused/i,
    /upstream.*refused/i,
    /railway.*error/i
  ];

  let lastError=null;
  for(let attempt=1; attempt<=attempts; attempt++){
    try{
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      const response=await fetchImpl(url,{method:'GET',redirect:'follow',signal:controller.signal,headers:{'user-agent':'VECTOR-hosted-proof-verifier/1'}});
      clearTimeout(timer);
      const body=await response.text();
      if(response.status < 200 || response.status >= 300) throw new Error('Public ingress returned HTTP '+response.status);
      if(failureMarkers.some(re=>re.test(body))) throw new Error('Public ingress returned an infrastructure failure page');
      if(!body.includes(expectedMarker)) throw new Error('Expected application identity marker not found');
      return Object.freeze({
        state:'HOSTED_PROVEN',
        origin:url.origin,
        path:url.pathname+url.search,
        httpStatus:response.status,
        applicationIdentityMarker:expectedMarker,
        responseDigest:crypto.createHash('sha256').update(body).digest('hex'),
        verifiedAt:new Date().toISOString(),
        attemptsUsed:attempt
      });
    }catch(error){
      lastError=error;
      if(attempt<attempts) await new Promise(resolve=>setTimeout(resolve,intervalMs));
    }
  }
  throw new Error('Hosted public runtime verification failed after '+attempts+' attempts: '+String(lastError?.message||lastError));
}

if(import.meta.url===new URL('file://'+process.argv[1]).href){
  const origin=process.env.VECTOR_PROOF_ORIGIN;
  const expectedMarker=process.env.VECTOR_EXPECTED_MARKER;
  const path=process.env.VECTOR_PROOF_PATH||'/';
  const receipt=await verifyHostedPublicRuntime({origin,path,expectedMarker});
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
