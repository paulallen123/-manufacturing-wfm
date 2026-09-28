'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const origin = String(process.env.WFM_ORIGIN || '').replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD || '';
const expectedSha = process.env.EXPECTED_CANDIDATE_SHA || '';
const email = 'manager@northstar.example';
const scope = JSON.parse(process.env.VECTOR_SCOPE_JSON || '{}');
const receipt = {
  schemaVersion: 1,
  scope: 'fixture configuration scope submission + persistence proof',
  customerReady: false,
  productionApproved: false,
  fixtureOnly: true,
  status: 'RUNNING',
  target: origin,
  expectedCandidateSha: expectedSha,
  startedAt: new Date().toISOString(),
  assertions: []
};

const server = http.createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  if (req.url === '/health') return res.end(JSON.stringify({status:'ok', proofStatus:receipt.status}));
  res.statusCode=404; res.end(JSON.stringify({error:'not found'}));
});
server.listen(Number(process.env.PORT||3000),'0.0.0.0');

function assert(name, ok, evidence={}) {
  receipt.assertions.push({name,status:ok?'PASS':'FAIL',evidence});
  if (!ok) {
    const e = new Error(name);
    e.evidence = evidence;
    throw e;
  }
}
function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const first = values[0] || '';
  return first.split(';',1)[0];
}
async function request(path, init={}) {
  return fetch(origin + path, {...init, signal: AbortSignal.timeout(15000)});
}
async function login() {
  const response = await request('/api/login', {
    method:'POST',
    headers:{'content-type':'application/json','origin':origin,'referer':origin+'/'},
    body:JSON.stringify({email,password})
  });
  assert('manager_login_http_200', response.status===200, {http:response.status});
  const cookie = cookieFrom(response);
  assert('manager_session_cookie_returned', Boolean(cookie));
  return cookie;
}
async function authedJson(cookie,path,init={}) {
  const response = await request(path,{
    ...init,
    headers:{accept:'application/json','content-type':'application/json',cookie,referer:origin+'/',...(init.headers||{})}
  });
  const text = await response.text();
  let json={};
  try{json=JSON.parse(text)}catch{}
  return {response,json};
}
function sameList(a,b){return JSON.stringify([...(a||[])])===JSON.stringify([...(b||[])]);}
function scopeMatches(actual, expected) {
  if (!actual || typeof actual!=='object') return false;
  return actual.companyName===expected.companyName &&
    actual.employeeCount===expected.employeeCount &&
    sameList(actual.countries,expected.countries) &&
    sameList(actual.sites,expected.sites) &&
    actual.hcmSystem===expected.hcmSystem &&
    sameList(actual.sourceSystems,expected.sourceSystems) &&
    actual.notes===expected.notes;
}

(async()=>{
  assert('origin_is_expected_proof_candidate', origin==='https://vector-customer-ready-candidate-production.up.railway.app', {origin});
  assert('staging_password_available_to_executor', password.length>=20);
  assert('scope_is_explicit_fixture', scope.companyName==='Northstar Manufacturing - SYNTHETIC PROOF ONLY' && /SYNTHETIC PROOF ONLY/.test(scope.notes||''));
  const healthResponse = await request('/api/health');
  assert('health_http_200', healthResponse.status===200,{http:healthResponse.status});
  const health = await healthResponse.json();
  const observedSha = health.sourceSha || health.candidateSha || health.gitSha || health.source?.sha || null;
  assert('health_fixture_only', health.fixtureOnly===true,{fixtureOnly:health.fixtureOnly});
  assert('health_production_not_approved', health.productionApproved===false,{productionApproved:health.productionApproved});
  assert('candidate_sha_bound', observedSha===expectedSha,{observedSha,expectedSha});

  const cookie = await login();
  const before = await authedJson(cookie,'/api/implementation/autonomous/status');
  assert('implementation_status_http_200',before.response.status===200,{http:before.response.status});
  assert('manager_tenant_is_northstar_demo', before.json.tenant==='northstar-demo' || !before.json.tenant, {tenant:before.json.tenant||null});

  const scopeBefore = await authedJson(cookie,'/api/implementation/autonomous/scope');
  assert('scope_get_http_200',scopeBefore.response.status===200,{http:scopeBefore.response.status});
  const existing = scopeBefore.json.scope || before.json.customerScope || null;
  if (existing) {
    assert('existing_scope_is_same_fixture_before_update', scopeMatches(existing,scope), {companyName:existing.companyName,fixture:/SYNTHETIC PROOF ONLY/.test(existing.notes||'')});
  } else {
    const submit = await authedJson(cookie,'/api/implementation/autonomous/scope',{
      method:'POST',
      body:JSON.stringify(scope)
    });
    assert('scope_submit_http_201_or_200',[200,201].includes(submit.response.status),{http:submit.response.status});
  }

  const readback = await authedJson(cookie,'/api/implementation/autonomous/scope');
  assert('scope_readback_http_200',readback.response.status===200,{http:readback.response.status});
  assert('scope_readback_matches_fixture',scopeMatches(readback.json.scope,scope),{runId:readback.json.runId||null,scopeCaptured:readback.json.scopeCaptured});

  const statusAfter = await authedJson(cookie,'/api/implementation/autonomous/status');
  assert('status_after_http_200',statusAfter.response.status===200,{http:statusAfter.response.status});
  assert('scope_captured_after_submission',statusAfter.json.scopeCaptured===true,{scopeCaptured:statusAfter.json.scopeCaptured});
  const configReq=(statusAfter.json.requirements||[]).find(x=>x.key==='configuration-scope');
  assert('configuration_scope_requirement_satisfied',configReq?.satisfied===true,{status:configReq?.status||null,source:configReq?.source||null});

  const freshCookie = await login();
  const fresh = await authedJson(freshCookie,'/api/implementation/autonomous/scope');
  assert('fresh_session_scope_http_200',fresh.response.status===200,{http:fresh.response.status});
  assert('fresh_session_scope_matches_fixture',scopeMatches(fresh.json.scope,scope),{runId:fresh.json.runId||null});

  receipt.status='PASS';
  receipt.result={
    runId:fresh.json.runId||readback.json.runId||null,
    scopeCaptured:true,
    completedRequirements:Number(statusAfter.json.completedRequirements||0),
    totalRequirements:Number(statusAfter.json.totalRequirements||0),
    configurationScopeStatus:configReq?.status||null,
    note:'Configuration data loaded as synthetic fixture input only. This does not prove genuine customer/provider acceptance or close unrelated release gates.'
  };
})().catch(error=>{
  receipt.status='FAIL';
  receipt.error={message:String(error?.message||error),evidence:error?.evidence||null};
  process.exitCode=1;
}).finally(()=>{
  receipt.finishedAt=new Date().toISOString();
  receipt.scriptDigest=crypto.createHash('sha256').update(process.env.APPLY_SCOPE_SCRIPT_SOURCE||'').digest('hex');
  console.log('VECTOR_SCOPE_CONFIGURATION_PROOF='+JSON.stringify(receipt));
  setTimeout(()=>server.close(()=>process.exit(process.exitCode||0)),500).unref();
});