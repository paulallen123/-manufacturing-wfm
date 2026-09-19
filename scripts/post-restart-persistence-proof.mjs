// DEVELOPMENT proof harness only; frozen release candidate remains untouched.
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const password=process.env.WFM_STAGING_PASSWORD;
const expectedRelease='0.6.76-hosted-staging-rc1';
const approvedLeaveId='r-1789837975727-27';
const correctionId='AC-eafd7cc414994d2b7b1b759fafb2d64f';
assert.ok(targetBase.includes('.railway.internal'));assert.ok(browserOrigin.startsWith('https://'));assert.ok(password&&password.length>=20);
const target=new URL(targetBase),browserHost=new URL(browserOrigin).host;
const hostedHeaders={host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https'};
async function request(path,init={}){const method=init.method||'GET',headers={...(init.headers||{})},body=init.body==null?null:String(init.body);if(body!=null)headers['content-length']=Buffer.byteLength(body);const transport=target.protocol==='https:'?httpsRequest:httpRequest;const result=await new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);if(body!=null)req.write(body);req.end();});let parsed=null;try{parsed=result.text?JSON.parse(result.text):null}catch{parsed=result.text}return{status:result.res.statusCode||0,body:parsed,headers:result.res.headers};}
function cookieFrom(r){const v=r.headers['set-cookie'],a=Array.isArray(v)?v:(v?[v]:[]);return a[0]?a[0].split(';',1)[0]:'';}
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`${email} login failed ${r.status}`);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>10||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const requestsOf=b=>findNamed(b,'requests',Array.isArray)||[];
let fatal=null;
try{
 const health=await request('/api/health',{headers:hostedHeaders});assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);console.log(`HEALTH_PASS ${health.body.release}`);
 const employee=await login('maya@northstar.example'),reviewer=await login('superuser@northstar.example'),manager=await login('manager@northstar.example'),isolation=await login('other@isolation.example');console.log('POST_RESTART_AUTH_PASS four roles');
 const employeeBoot=await authed(employee,'/api/bootstrap'),reviewerBoot=await authed(reviewer,'/api/bootstrap'),isolationBoot=await authed(isolation,'/api/bootstrap');
 const employeeActor=findNamed(employeeBoot.body,'actor',v=>v&&typeof v==='object'),isolationActor=findNamed(isolationBoot.body,'actor',v=>v&&typeof v==='object');assert.equal(employeeActor?.tenant,'northstar-demo');assert.equal(isolationActor?.tenant,'isolation-test');console.log('POST_RESTART_TENANT_IDENTITY_PASS');
 const failures=[];
 const leaveEmployee=requestsOf(employeeBoot.body).find(r=>r.id===approvedLeaveId),leaveReviewer=requestsOf(reviewerBoot.body).find(r=>r.id===approvedLeaveId),leaveIsolation=requestsOf(isolationBoot.body).find(r=>r.id===approvedLeaveId);
 if(leaveEmployee?.status==='approved'&&leaveReviewer?.status==='approved'&&!leaveIsolation)console.log('POST_RESTART_LEAVE_PERSISTENCE_PASS');else{failures.push('approved leave missing after restart');console.log('POST_RESTART_LEAVE_PERSISTENCE_FAIL');}
 const correction=await authed(employee,'/api/attendance-corrections');assert.equal(correction.status,200);const persisted=(correction.body?.requests||[]).find(r=>r.id===correctionId);const correctionGood=persisted?.status==='rejected'&&persisted?.revision===2&&persisted?.outcome?.applied===false&&(persisted.history||[]).some(h=>h.type==='attendance-correction-submitted')&&(persisted.history||[]).some(h=>h.type==='attendance-correction-reject');if(correctionGood)console.log('POST_RESTART_CORRECTION_PERSISTENCE_PASS');else{failures.push('rejected correction missing after restart');console.log('POST_RESTART_CORRECTION_PERSISTENCE_FAIL');}
 const otherCorrection=await authed(isolation,'/api/attendance-corrections');if(otherCorrection.status===200&&!(otherCorrection.body?.requests||[]).some(r=>r.id===correctionId))console.log('POST_RESTART_CORRECTION_ISOLATION_PASS');else if(otherCorrection.status===403)console.log('POST_RESTART_CORRECTION_ISOLATION_PASS boundary=403');else{failures.push('correction isolation not proven after restart');console.log('POST_RESTART_CORRECTION_ISOLATION_FAIL');}
 const devices=await authed(reviewer,'/api/kiosk/devices');assert.equal(devices.status,200);const revoked=(devices.body?.devices||[]).filter(d=>d.status==='revoked'&&String(d.name||'').startsWith('Private proof kiosk '));if(revoked.length>0&&revoked.every(d=>!Object.prototype.hasOwnProperty.call(d,'secret')))console.log(`POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_PASS count=${revoked.length}`);else{failures.push('revoked proof kiosk missing after restart');console.log('POST_RESTART_KIOSK_REVOCATION_PERSISTENCE_FAIL');}
 const personal=await authed(employee,'/api/personal'),timeReview=await authed(manager,'/api/time-review');assert.equal(personal.status,200);assert.equal(timeReview.status,200);console.log('POST_RESTART_CORE_SURFACES_PASS personal+time-review');
 if(failures.length)throw new Error(failures.join(' | '));
 console.log('POST_RESTART_PERSISTENCE_PROOF=PASS');
}catch(e){fatal=e;console.error(`POST_RESTART_PERSISTENCE_FATAL ${e.message}`);}
createServer((req,res)=>{res.statusCode=fatal?503:200;res.setHeader('content-type','text/plain');res.end(fatal?'contained-after-failure\n':'proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
