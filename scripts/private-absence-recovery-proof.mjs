import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const password=process.env.WFM_STAGING_PASSWORD;
const expectedRelease='0.6.76-hosted-staging-rc1';
assert.ok(targetBase.includes('.railway.internal'));
assert.ok(browserOrigin.startsWith('https://'));
assert.ok(password&&password.length>=20);
const target=new URL(targetBase), browserHost=new URL(browserOrigin).host;
const hostedHeaders={host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https'};
async function request(path,init={}){const method=init.method||'GET',headers={...(init.headers||{})},body=init.body==null?null:String(init.body);if(body!=null)headers['content-length']=Buffer.byteLength(body);const transport=target.protocol==='https:'?httpsRequest:httpRequest;const result=await new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);if(body!=null)req.write(body);req.end();});let parsed=null;try{parsed=result.text?JSON.parse(result.text):null}catch{parsed=result.text}return{status:result.res.statusCode||0,body:parsed,text:result.text,headers:result.res.headers};}
function cookieFrom(r){const v=r.headers['set-cookie'],a=Array.isArray(v)?v:(v?[v]:[]);return a[0]?a[0].split(';',1)[0]:'';}
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`${email} login ${r.status}`);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
async function post(c,path,payload){return request(path,{method:'POST',headers:{...hostedHeaders,cookie:c,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify(payload)});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>7||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const versionOf=b=>findNamed(b,'version',Number.isInteger), requestsOf=b=>findNamed(b,'requests',Array.isArray)||[], actorOf=b=>findNamed(b,'actor',v=>!!v&&typeof v==='object'&&!Array.isArray(v))||{};
async function command(c,version,name,payload){return post(c,'/api/command',{command:name,payload,version});}

const health=await request('/api/health',{headers:hostedHeaders});assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);console.log(`HEALTH_PASS ${health.body.release}`);
const employee=await login('maya@northstar.example'), other=await login('other@isolation.example'), reviewer=await login('superuser@northstar.example');
let employeeState=await authed(employee,'/api/bootstrap'), otherState=await authed(other,'/api/bootstrap'), reviewerState=await authed(reviewer,'/api/bootstrap');
assert.equal(actorOf(employeeState.body)?.tenant,'northstar-demo');assert.equal(actorOf(otherState.body)?.tenant,'isolation-test');assert.equal(actorOf(reviewerState.body)?.tenant,'northstar-demo');
const personId=actorOf(employeeState.body)?.personId;assert.ok(personId);
const pending=requestsOf(employeeState.body).filter(r=>r.employee===personId&&r.kind==='Annual leave'&&r.status==='pending');
console.log(`PENDING_SYNTHETIC_LEAVE_FOUND count=${pending.length}`);
assert.ok(pending.length>0,'no pending synthetic leave evidence to recover');
for(const r of pending){assert.ok(!requestsOf(otherState.body).some(x=>x.id===r.id),'pending leave leaked cross-tenant');const capacity=await post(reviewer,'/api/leave-capacity',{...r,employee:r.employee,requestId:r.id});console.log(`LEAVE_CAPACITY_HTTP id=${r.id} status=${capacity.status}`);assert.equal(capacity.status,200,`capacity check failed ${capacity.status}: ${capacity.text.slice(0,180)}`);reviewerState=await authed(reviewer,'/api/bootstrap');let version=versionOf(reviewerState.body);assert.ok(Number.isInteger(version));let decision=await command(reviewer,version,'rules-leave-decision',{id:r.id,decision:'declined',reviewed:true,reason:'Controlled synthetic customer-proof cleanup after preserved failure.'});if(decision.status!==200){reviewerState=await authed(reviewer,'/api/bootstrap');version=versionOf(reviewerState.body);decision=await command(reviewer,version,'leave-decision',{id:r.id,decision:'declined'});}console.log(`LEAVE_DECLINE_HTTP id=${r.id} status=${decision.status}`);assert.equal(decision.status,200,`decline failed ${decision.status}: ${decision.text.slice(0,200)}`);}
employeeState=await authed(employee,'/api/bootstrap');otherState=await authed(other,'/api/bootstrap');const recovered=requestsOf(employeeState.body).filter(r=>pending.some(p=>p.id===r.id));assert.equal(recovered.length,pending.length);assert.ok(recovered.every(r=>r.status==='declined'),'not all synthetic requests were declined');assert.ok(!requestsOf(otherState.body).some(r=>pending.some(p=>p.id===r.id)),'declined leave leaked cross-tenant');console.log(`PRIVATE_ABSENCE_RECOVERY_PROOF=PASS declined=${recovered.length}`);console.log('Failure evidence preserved; synthetic pending requests closed by authorised review; no real communication/payment.');
createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','text/plain');res.end('proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
