import test from 'node:test';
import assert from 'node:assert/strict';
import {connectorById} from './connector-registry.mjs';
import {compileUniversalConnectorContract} from './universal-connector-contract.mjs';
import {buildSafeConnectionTest} from './connection-test-plan.mjs';
import {buildNetSuiteWorkerSuiteQLRead} from './provider-read-requests.mjs';
import {executeProviderRead} from './provider-read-executor.mjs';

const NOW=Date.parse('2026-10-03T21:30:00.000Z');

function contract(){
  return compileUniversalConnectorContract(connectorById('oracle-netsuite'),{
    tenantId:'northstar-demo',
    connectionId:'netsuite-sandbox'
  });
}
function readPlan(){
  const c=contract();
  const ref='secret://tenant/northstar/netsuite';
  const cp=buildSafeConnectionTest({
    providerKey:'oracle-netsuite',
    sourceInstanceId:'acct-sandbox-1',
    wfmTenantId:'northstar-demo',
    connectionId:'netsuite-sandbox',
    endpointHost:'1234567-sb1.suitetalk.api.netsuite.com',
    environment:'sandbox',
    adapter:'http-json',
    authMethod:'oauth2',
    credentialRef:ref,
    capabilities:['metadata','read'],
    requestedSemanticScopes:['vector.read']
  });
  const evidence={
    configurationFingerprint:cp.configurationFingerprint,
    providerKey:cp.configuration.providerKey,
    sourceInstanceId:cp.configuration.sourceInstanceId,
    wfmTenantId:cp.configuration.wfmTenantId,
    connectionId:cp.configuration.connectionId,
    endpointHost:cp.configuration.endpointHost,
    environment:cp.configuration.environment,
    readOnly:true,
    rawCredentialObserved:false,
    employeeOrPayrollDataObserved:false,
    latencyMs:30,
    observedAt:'2026-10-03T21:29:00.000Z',
    steps:cp.steps.map(step=>({id:step.id,status:'PASS'}))
  };
  return {
    contract:c,
    plan:buildNetSuiteWorkerSuiteQLRead({
      contract:c,
      connectionPlan:cp,
      connectionEvidence:evidence,
      credentialRef:ref,
      limit:100,
      offset:0,
      nowMs:NOW
    }),
    ref
  };
}
function twoTickClock(start=NOW,delta=40){
  const values=[start,start+delta];
  return ()=>values.length?values.shift():start+delta;
}

test('provider-neutral executor performs fixed NetSuite read without exposing credential material',async()=>{
  const {contract:c,plan,ref}=readPlan();
  const secret='VERY_SECRET_TOKEN_VALUE';
  let observed;
  const result=await executeProviderRead({
    plan,
    contract:c,
    credentialAuthorizer:async request=>{
      assert.equal(request.credentialRef,ref);
      assert.equal(request.providerId,'oracle-netsuite');
      assert.equal(request.connectionId,'netsuite-sandbox');
      assert.equal(request.endpointHost,'1234567-sb1.suitetalk.api.netsuite.com');
      return {authorization:`Bearer ${secret}`};
    },
    fetchImpl:async(url,options)=>{
      observed={url,options};
      return new Response(JSON.stringify({
        count:1,offset:0,totalResults:1,hasMore:false,
        items:[{id:'42',entityid:'EMP42',firstname:'Ada',lastname:'Lovelace',email:'ada@example.test',isinactive:'F'}]
      }),{status:200,headers:{'content-type':'application/json'}});
    },
    clock:twoTickClock()
  });
  assert.equal(observed.options.method,'POST');
  assert.equal(observed.options.redirect,'error');
  assert.equal(observed.options.headers.authorization,`Bearer ${secret}`);
  assert.equal(JSON.parse(observed.options.body).q,'SELECT id, entityid, firstname, lastname, email, isinactive FROM employee ORDER BY id');
  assert.equal(result.data.items[0].id,'42');
  assert.equal(result.receipt.httpStatus,200);
  assert.equal(result.receipt.readOnly,true);
  assert.equal(result.receipt.checkpointAdvanceAllowed,false);
  assert.equal(result.receipt.latencyMs,40);
  const publicResult=JSON.stringify(result);
  assert.equal(publicResult.includes(secret),false);
  assert.equal(publicResult.includes(ref),false);
});

test('credential authorizer cannot inject transport-control headers',async()=>{
  const {contract:c,plan}=readPlan();
  await assert.rejects(
    ()=>executeProviderRead({
      plan,
      contract:c,
      credentialAuthorizer:async()=>({host:'attacker.example'}),
      fetchImpl:async()=>{throw new Error('must not execute');}
    }),
    error=>error.code==='WFM_PROVIDER_AUTH_CONFIGURATION_INVALID'
  );
});

test('provider auth failure is definitive and does not become a generic retry',async()=>{
  const {contract:c,plan}=readPlan();
  await assert.rejects(
    ()=>executeProviderRead({
      plan,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response(JSON.stringify({error:'denied'}),{status:401})
    }),
    error=>error.code==='WFM_PROVIDER_AUTH_REJECTED'&&error.retryable===false
  );
});

test('rate limits and server errors expose bounded retry semantics',async()=>{
  const {contract:c,plan}=readPlan();
  for(const [status,code] of [[429,'WFM_PROVIDER_RATE_LIMITED'],[503,'WFM_PROVIDER_HTTP_ERROR']]){
    await assert.rejects(
      ()=>executeProviderRead({
        plan,
        contract:c,
        credentialAuthorizer:async()=>({authorization:'Bearer test'}),
        fetchImpl:async()=>new Response('{}',{status})
      }),
      error=>error.code===code&&error.retryable===true
    );
  }
});

test('response body is byte bounded even when Content-Length is absent',async()=>{
  const {contract:c,plan}=readPlan();
  await assert.rejects(
    ()=>executeProviderRead({
      plan,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response(JSON.stringify({payload:'x'.repeat(2000)}),{status:200}),
      maxResponseBytes:128
    }),
    error=>error.code==='WFM_PROVIDER_RESPONSE_TOO_LARGE'
  );
});

test('deadline covers a stalled response body, not only response headers',async()=>{
  const {contract:c,plan}=readPlan();
  const stalled=new ReadableStream({
    start(controller){ controller.enqueue(new TextEncoder().encode('{"x":')); }
  });
  await assert.rejects(
    ()=>executeProviderRead({
      plan,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response(stalled,{status:200}),
      timeoutMs:20
    }),
    error=>error.code==='WFM_PROVIDER_READ_TIMEOUT'&&error.retryable===true
  );
});

test('POST transport cannot be reclassified as a read by a caller',async()=>{
  const {contract:c,plan}=readPlan();
  const tampered=structuredClone(plan);
  tampered.request.readViaPostProven=false;
  await assert.rejects(
    ()=>executeProviderRead({
      plan:tampered,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response('{}',{status:200})
    }),
    error=>error.code==='WFM_PROVIDER_READ_VIA_POST_NOT_PROVEN'
  );
});


test('bounded XML and text responses stay opaque until a deterministic parser admits them',async()=>{
  const {contract:c,plan}=readPlan();
  for(const [format,payload,contentType] of [
    ['xml','<?xml version="1.0"?><root><item>42</item></root>','text/xml'],
    ['text','plain-provider-text','text/plain']
  ]){
    const p=structuredClone(plan);
    p.request.responseFormat=format;
    const result=await executeProviderRead({
      plan:p,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response(payload,{status:200,headers:{'content-type':contentType}}),
      clock:twoTickClock()
    });
    assert.equal(result.data,payload);
    assert.equal(result.receipt.responseFormat,format);
    assert.equal(result.receipt.contentType,contentType);
    assert.equal(result.receipt.readOnly,true);
    assert.equal(result.receipt.checkpointAdvanceAllowed,false);
  }
});

test('unsupported response format fails before provider data is admitted',async()=>{
  const {contract:c,plan}=readPlan();
  const p=structuredClone(plan);
  p.request.responseFormat='binary';
  await assert.rejects(
    ()=>executeProviderRead({
      plan:p,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response('abc',{status:200})
    }),
    error=>error.code==='WFM_PROVIDER_REQUEST_INVALID'
  );
});

test('invalid UTF-8 text fails closed instead of replacement-decoding',async()=>{
  const {contract:c,plan}=readPlan();
  const p=structuredClone(plan);
  p.request.responseFormat='xml';
  const bad=new Uint8Array([0x3c,0x78,0x3e,0xc3,0x28,0x3c,0x2f,0x78,0x3e]);
  await assert.rejects(
    ()=>executeProviderRead({
      plan:p,
      contract:c,
      credentialAuthorizer:async()=>({authorization:'Bearer test'}),
      fetchImpl:async()=>new Response(bad,{status:200,headers:{'content-type':'text/xml'}})
    }),
    error=>error.code==='WFM_PROVIDER_RESPONSE_INVALID'
  );
});
