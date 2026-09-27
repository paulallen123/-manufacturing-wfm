import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import http from 'node:http';

const origin=(process.env.TARGET_ORIGIN||'').replace(/\/$/,'');
const password=process.env.TARGET_PASSWORD||'';
const expectedSha=process.env.EXPECTED_CANDIDATE_SHA||'';
const deploymentId=process.env.EXPECTED_DEPLOYMENT_ID||'';
const protectedOrigins=new Set([
 'https://vector-customer-ready-candidate-production.up.railway.app',
 'https://vector-2000-convergence-admission-production.up.railway.app'
]);
const result={schemaVersion:1,scope:'hosted fixture HTTP security',target:origin,expectedCandidateSha:expectedSha,expectedDeploymentId:deploymentId,runnerSha:process.env.RAILWAY_GIT_COMMIT_SHA||null,startedAt:new Date().toISOString(),status:'UNPROVEN',assertions:[],releaseBinding:'UNPROVEN',limitations:['Target deployment identity is supplied from Railway metadata; response source SHA is independently required to match the sealed build.','Unknown database roles and revoked physical devices are not exercised by this hosted suite.']};
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cookies=[];
async function request(path,{cookie,headers={},...init}={}){
 const response=await fetch(origin+path,{...init,headers:{accept:'application/json',...(cookie?{cookie}:{}),...headers},redirect:'manual',signal:AbortSignal.timeout(15000)});
 const text=await response.text();let body=null;try{body=JSON.parse(text)}catch{}
 return {status:response.status,body,headers:response.headers};
}
async function check(name,fn){
 try{const evidence=await fn();result.assertions.push({name,status:'PASS',evidence});}
 catch(e){result.assertions.push({name,status:'FAIL',error:String(e.message).replaceAll(password||'\u0000','[redacted]').slice(0,300)});}
}
async function login(email){
 const x=await request('/api/login',{method:'POST',headers:{'content-type':'application/json',origin,referer:origin+'/'},body:JSON.stringify({email,password})});
 assert.equal(x.status,200,'fixture login status');const raw=x.headers.get('set-cookie')||'';
 assert.match(raw,/HttpOnly/i);assert.match(raw,/Secure/i);assert.match(raw,/SameSite=Strict/i);
 const cookie=raw.split(';',1)[0];assert.match(cookie,/^wfm_session=.+/);cookies.push(cookie);return cookie;
}
const post=(cookie,body,extra={})=>({method:'POST',cookie,headers:{'content-type':'application/json',origin,...extra},body:typeof body==='string'?body:JSON.stringify(body)});
async function expectStatus(path,options,expected){const x=await request(path,options);assert.equal(x.status,expected,`${path} expected ${expected}, observed ${x.status}`);return{path,httpStatus:x.status,responseDigest:hash(x.body),traceId:x.headers.get('x-correlation-id')};}
function londonLocalMinute(value){
 const d=new Date(value);assert.ok(Number.isFinite(d.getTime()),'attendance timestamp invalid');
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');
}
async function ensurePrimaryCorrection(managerCookie){
 const managerInitial=await request('/api/attendance-corrections',{cookie:managerCookie});
 assert.equal(managerInitial.status,200,'manager correction dashboard required');
 const existing=Array.isArray(managerInitial.body?.requests)?managerInitial.body.requests:[];
 if(existing.length) return {id:String(existing[0].id),created:false,status:String(existing[0].status||'')};

 const openStatuses=new Set(['submitted','information_required','awaiting_approval','payroll_review_required']);
 const candidates=[['maya@northstar.example','e0'],['leah@northstar.example','e32'],['quality@northstar.example','e16'],['leeds-employee@northstar.example','e24']];
 let chosen=null;
 for(const [email,personId] of candidates){
  const cookie=await login(email);
  const dash=await request('/api/attendance-corrections',{cookie});
  if(dash.status!==200) continue;
  const blocked=new Set((Array.isArray(dash.body?.requests)?dash.body.requests:[]).filter(q=>q.employee===personId&&openStatuses.has(q.status)).map(q=>q.record));
  const record=(Array.isArray(dash.body?.records)?dash.body.records:[]).find(r=>r.employee===personId&&r.effective?.clockIn&&r.effective?.clockOut&&!blocked.has(r.id));
  if(record){chosen={cookie,dash:dash.body,record};break;}
 }
 assert.ok(chosen,'safe fixture attendance record required');
 const body={
  version:chosen.dash.version,
  command:'correction-submit',
  payload:{
   period:chosen.record.period,
   record:chosen.record.id,
   clockIn:londonLocalMinute(chosen.record.effective.clockIn),
   clockOut:londonLocalMinute(chosen.record.effective.clockOut),
   note:'Security verifier isolation fixture; requested times intentionally preserve source attendance.'
  },
  idempotencyKey:'security-isolation-submit-'+deploymentId
 };
 const submitted=await request('/api/attendance-corrections/command',post(chosen.cookie,body));
 assert.equal(submitted.status,200,'security fixture correction submit');
 const id=String(submitted.body?.result?.id||'');assert.match(id,/^AC-[a-f0-9]{32}$/i,'security fixture correction id');
 const managerDash=await request('/api/attendance-corrections',{cookie:managerCookie});
 assert.equal(managerDash.status,200,'manager correction dashboard after submit');
 const visible=(Array.isArray(managerDash.body?.requests)?managerDash.body.requests:[]).find(q=>String(q.id)===id);
 assert.ok(visible,'manager must see security fixture correction');
 const review={
  version:managerDash.body.version,
  command:'correction-review',
  payload:{id,revision:visible.revision,decision:'reject',note:'Security isolation fixture rejected by design; source attendance remains unchanged.'},
  idempotencyKey:'security-isolation-review-'+deploymentId
 };
 const rejected=await request('/api/attendance-corrections/command',post(managerCookie,review));
 assert.equal(rejected.status,200,'security fixture correction rejection');
 assert.equal(rejected.body?.result?.status,'rejected','security fixture must close without attendance mutation');
 return {id,created:true,status:'rejected'};
}
async function main(){
 assert.equal(protectedOrigins.has(origin),true,'protected target origin required');
 assert.ok(password.length>=20,'existing target credential required');
 assert.match(expectedSha,/^[a-f0-9]{40}$/,'exact candidate SHA required');
 assert.match(deploymentId,/^[a-f0-9-]{36}$/,'observed target deployment required');
 result.configured=true;
 await check('fixture_target_boundary',async()=>{const x=await request('/api/health');assert.equal(x.status,200);assert.equal(x.body.release,'0.6.76-hosted-staging-rc1');assert.equal(x.body.fixtureOnly,true);assert.equal(x.body.productionApproved,false);assert.equal(x.headers.get('x-wfm-source-sha'),expectedSha,'target source SHA mismatch');assert.equal(x.headers.get('x-wfm-source-binding'),'build-file-matched','target source binding is not build-derived');assert.equal(x.headers.get('x-wfm-fixture-only'),'true','target fixture boundary header mismatch');result.releaseBinding='SOURCE_BOUND';return{...x.body,sourceSha:x.headers.get('x-wfm-source-sha'),sourceBinding:x.headers.get('x-wfm-source-binding')};});
 for(const path of ['/api/bootstrap','/api/attendance-corrections','/api/operations/autopilot/status'])await check('unauthenticated_denied:'+path,()=>expectStatus(path,{},401));
 await check('forged_authority_headers_denied',()=>expectStatus('/api/operations/autopilot/status',{headers:{'x-user-role':'admin','x-tenant-id':'northstar-demo','x-user-id':'m1'}},401));
 await check('invalid_session_denied',()=>expectStatus('/api/operations/autopilot/status',{cookie:'wfm_session=invalid-security-proof-session'},401));
 let manager,employee,other;
 await check('manager_secure_login',async()=>{manager=await login('manager@northstar.example');return {role:'manager',tenant:'northstar-demo'};});
 await check('employee_secure_login',async()=>{employee=await login('maya@northstar.example');return {role:'employee',tenant:'northstar-demo'};});
 await check('other_tenant_secure_login',async()=>{other=await login('other@isolation.example');return {role:'manager',tenant:'isolation-test'};});
 assert.ok(manager&&employee&&other,'authenticated prerequisites unavailable');
 await check('manager_payroll_denied',()=>expectStatus('/api/payroll-run',{cookie:manager},403));
 await check('employee_autopilot_denied',()=>expectStatus('/api/operations/autopilot/status',{cookie:employee},403));
 const before={};
 for(const [name,cookie,tenant,foreign] of [['primary',manager,'northstar-demo','isolation-test'],['other',other,'isolation-test','northstar-demo']]){
  await check(name+'_tenant_identity',async()=>{const x=await request('/api/bootstrap',{cookie});assert.equal(x.status,200);assert.equal(x.body.actor.tenant,tenant);return {tenant,stateDigest:hash(x.body.state)};});
  await check(name+'_tenant_header_query_spoof_ignored',async()=>{const x=await request('/api/bootstrap?tenant='+foreign,{cookie,headers:{'x-tenant-id':foreign,'x-user-role':'admin'}});assert.equal(x.status,200);assert.equal(x.body.actor.tenant,tenant);assert.equal(x.body.actor.role,'manager');return{tenant,role:x.body.actor.role};});
  before[name]=await request('/api/operations/autopilot/status',{cookie});assert.equal(before[name].status,200);
 }
 const body={permitId:'proof-nonexistent-permit-no-mutation',contextRevision:'proof'};
 for(const [name,options,status] of [
  ['invalid_origin',post(manager,body,{origin:'https://untrusted.invalid'}),403],
  ['null_origin',post(manager,body,{origin:'null'}),403],
  ['missing_origin',{method:'POST',cookie:manager,headers:{'content-type':'application/json'},body:JSON.stringify(body)},403],
  ['wrong_content_type',post(manager,body,{'content-type':'text/plain'}),415],
  ['malformed_json',post(manager,'{invalid'),400],
  ['unknown_permit',post(manager,body),404],
  ['employee_execution',post(employee,body),403],
  ['oversized_json',post(manager,JSON.stringify({padding:'x'.repeat(131073)})),413]
 ])await check('autopilot_'+name,()=>expectStatus('/api/operations/autopilot/execute',options,status));
 await check('cross_origin_login_denied',()=>expectStatus('/api/login',post(null,{email:'nobody@example.invalid',password:'invalid'},{origin:'https://untrusted.invalid'}),403));
 await check('tenant_state_not_mutated_by_ingress_attacks',async()=>{const evidence={};for(const [name,cookie] of [['primary',manager],['other',other]]){const after=await request('/api/operations/autopilot/status',{cookie});assert.equal(after.status,200);assert.deepEqual(after.body,before[name].body);evidence[name]={before:hash(before[name].body),after:hash(after.body)};}return evidence;});
 await check('cross_tenant_correction_read_denied',async()=>{const fixture=await ensurePrimaryCorrection(manager);const a=await request('/api/attendance-corrections',{cookie:manager}),b=await request('/api/attendance-corrections',{cookie:other});assert.equal(a.status,200);assert.equal(b.status,200);const primary=Array.isArray(a.body?.requests)?a.body.requests:[],foreign=Array.isArray(b.body?.requests)?b.body.requests:[];const sample=primary.find(x=>String(x?.id||'')===fixture.id);assert.ok(sample,'primary fixture correction readback required');const ids=new Set(foreign.map(x=>String(x?.id||'')).filter(Boolean));assert.equal(ids.has(fixture.id),false,'primary tenant correction leaked into foreign tenant response');return{correctionId:fixture.id,fixtureCreated:fixture.created,fixtureStatus:fixture.status,primaryCount:primary.length,foreignCount:foreign.length,primaryDigest:hash(sample)};});
 await check('logout_revokes_autopilot_access',async()=>{await expectStatus('/api/logout',post(manager,{}),200);return expectStatus('/api/operations/autopilot/status',{cookie:manager},401);});
 result.status=result.assertions.some(x=>x.status==='FAIL')?'FAIL':result.assertions.length?'PASS':'UNPROVEN';
}
try{await main();}catch(e){result.status=result.configured?'FAIL':'BLOCKED';result.error=String(e.message).replaceAll(password||'\u0000','[redacted]').slice(0,300);}
finally{for(const cookie of cookies){try{await request('/api/logout',post(cookie,{}));}catch{}}}
result.finishedAt=new Date().toISOString();result.passed=result.assertions.filter(x=>x.status==='PASS').length;result.failed=result.assertions.filter(x=>x.status==='FAIL').length;
console.log('VECTOR_SECURITY_ASSERTIONS='+JSON.stringify(result));
if(process.env.PORT){http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:result.status==='PASS'?200:503,{'content-type':'application/json'});res.end(JSON.stringify(req.url==='/health'?{runner:'ready',assertionStatus:result.status}:result));}).listen(Number(process.env.PORT),'0.0.0.0');}
else process.exitCode=result.status==='PASS'?0:1;
