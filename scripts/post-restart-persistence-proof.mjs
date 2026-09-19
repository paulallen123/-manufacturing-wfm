// Triggered only in the DEVELOPMENT proof harness; the frozen release candidate remains untouched.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const password=process.env.WFM_STAGING_PASSWORD;
const expectedRelease='0.6.76-hosted-staging-rc1';
const approvedLeaveId='r-1789837975727-27';
const correctionId='AC-eafd7cc414994d2b7b1b759fafb2d64f';
assert.ok(targetBase.includes('.railway.internal'));
assert.ok(browserOrigin.startsWith('https://'));
assert.ok(password&&password.length>=20);
const target=new URL(targetBase), browserHost=new URL(browserOrigin).host;
const hostedHeaders={host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https'};

async function request(path,init={}){
  const method=init.method||'GET',headers={...(init.headers||{})},body=init.body==null?null:String(init.body);
  if(body!=null) headers['content-length']=Buffer.byteLength(body);
  const transport=target.protocol==='https:'?httpsRequest:httpRequest;
  const result=await new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);if(body!=null)req.write(body);req.end();});
  let parsed=null;try{parsed=result.text?JSON.parse(result.text):null}catch{parsed=result.text}
  return {status:result.res.statusCode||0,body:parsed,text:result.text,headers:result.res.headers};
}
function cookieFrom(r){const v=r.headers['set-cookie'],a=Array.isArray(v)?v:(v?[v]:[]);return a[0]?a[0].split(';',1)[0]:'';}
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`${email} login failed ${r.status}`);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>10||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const requestsOf=b=>findNamed(b,'requests',Array.isArray)||[];
function containsString(node,needle,depth=0,seen=new Set()){if(depth>12||node==null)return false;if(typeof node==='string')return node.includes(needle);if(typeof node!=='object'||seen.has(node))return false;seen.add(node);return Object.values(node).some(v=>containsString(v,needle,depth+1,seen));}
let fatal=null;
try{
  const health=await request('/api/health',{headers:hostedHeaders});
  assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);
  console.log(`HEALTH_PASS ${health.body.release}`);

  const employee=await login('maya@northstar.example');
  const reviewer=await login('superuser@northstar.example');
  const manager=await login('manager@northstar.example');
  const isolation=await login('other@isolation.example');
  console.log('POST_RESTART_AUTH_PASS four roles');

  const employeeBoot=await authed(employee,'/api/bootstrap');
  const reviewerBoot=await authed(reviewer,'/api/bootstrap');
  const isolationBoot=await authed(isolation,'/api/bootstrap');
  assert.equal(employeeBoot.status,200);assert.equal(reviewerBoot.status,200);assert.equal(isolationBoot.status,200);
  assert.equal(findNamed(employeeBoot.body,'actor',v=>v&&typeof v==='object')?.tenant,'northstar-demo');
  assert.equal(findNamed(isolationBoot.body,'actor',v=>v&&typeof v==='object')?.tenant,'isolation-test');

  const leaveEmployee=requestsOf(employeeBoot.body).find(r=>r.id===approvedLeaveId);
  const leaveReviewer=requestsOf(reviewerBoot.body).find(r=>r.id===approvedLeaveId);
  assert.ok(leaveEmployee&&leaveReviewer,'approved leave missing after restart');
  assert.equal(leaveEmployee.status,'approved');assert.equal(leaveReviewer.status,'approved');
  assert.ok(!requestsOf(isolationBoot.body).some(r=>r.id===approvedLeaveId),'approved leave leaked cross-tenant after restart');
  console.log(`POST_RESTART_LEAVE_PERSISTENCE_PASS ${approvedLeaveId}`);
  console.log('POST_RESTART_LEAVE_ISOLATION_PASS');

  const correction=await authed(employee,'/api/attendance-corrections');
  assert.equal(correction.status,200);
  const persisted=Array.isArray(correction.body?.requests)?correction.body.requests.find(r=>r.id===correctionId):null;
  assert.ok(persisted,'rejected correction missing after restart');
  assert.equal(persisted.status,'rejected');assert.equal(persisted.revision,2);assert.equal(persisted.outcome?.applied,false);
  const history=Array.isArray(persisted.history)?persisted.history.map(h=>h.type):[];
  assert.ok(history.includes('attendance-correction-submitted'));assert.ok(history.includes('attendance-correction-reject'));
  console.log(`POST_RESTART_CORRECTION_PERSISTENCE_PASS ${correctionId}`);

  const otherCorrection=await authed(isolation,'/api/attendance-corrections');
  if(otherCorrection.status===200){assert.ok(!(otherCorrection.body?.requests||[]).some(r=>r.id===correctionId),'correction leaked cross-tenant after restart');console.log('POST_RESTART_CORRECTION_ISOLATION_PASS');}
  else console.log(`POST_RESTART_CORRECTION_ISOLATION_BOUNDARY ${otherCorrection.status}`);

  const devices=await authed(reviewer,'/api/kiosk/devices');
  assert.equal(devices.status,200);
  const revoked=(devices.body?.devices||[]).filter(d=>d.status==='revoked'&&String(d.name||'').startsWith('Private proof kiosk '));
  assert.ok(revoked.length>0,'no prior revoked private proof kiosk persisted after restart');
  assert.ok(revoked.every(d=>!Object.prototype.hasOwnProperty.call(d,'secret')),'device secret exposed after restart');
  console.log(`POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_PASS count=${revoked.length}`);

  const personal=await authed(employee,'/api/personal');
  const timeReview=await authed(manager,'/api/time-review');
  assert.equal(personal.status,200);assert.equal(timeReview.status,200);
  const eventObserved=containsString(personal.body,'private-proof-in-')||containsString(personal.body,'private-proof-out-')||containsString(timeReview.body,'private-proof-in-')||containsString(timeReview.body,'private-proof-out-');
  console.log(eventObserved?'POST_RESTART_CLOCK_EVENT_IDENTIFIER_OBSERVED':'POST_RESTART_CLOCK_EVENT_IDENTIFIER_NOT_EXPOSED');
  console.log('POST_RESTART_PERSISTENCE_PROOF=PASS leave+correction+kiosk-revocation');
  console.log('claim_boundary=read-only private synthetic post-restart proof; frozen candidate unmodified; no employee communications/payments');
}catch(e){fatal=e;console.error(`POST_RESTART_PERSISTENCE_FATAL ${e.message}`);}
createServer((req,res)=>{res.statusCode=fatal?503:200;res.setHeader('content-type','text/plain');res.end(fatal?'contained-after-failure\n':'proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
