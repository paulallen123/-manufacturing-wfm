import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const password=process.env.WFM_STAGING_PASSWORD;
const expectedRelease='0.6.76-hosted-staging-rc1';
assert.ok(targetBase.includes('.railway.internal'));assert.ok(browserOrigin.startsWith('https://'));assert.ok(password&&password.length>=20);
const target=new URL(targetBase),browserHost=new URL(browserOrigin).host,hostedHeaders={host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https'};
async function request(path,init={}){const method=init.method||'GET',headers={...(init.headers||{})},body=init.body==null?null:String(init.body);if(body!=null)headers['content-length']=Buffer.byteLength(body);const transport=target.protocol==='https:'?httpsRequest:httpRequest;const result=await new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);if(body!=null)req.write(body);req.end();});let parsed=null;try{parsed=result.text?JSON.parse(result.text):null}catch{parsed=result.text}return{status:result.res.statusCode||0,body:parsed,text:result.text,headers:result.res.headers};}
function cookieFrom(r){const v=r.headers['set-cookie'],a=Array.isArray(v)?v:(v?[v]:[]);return a[0]?a[0].split(';',1)[0]:'';}
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
async function post(c,path,payload){return request(path,{method:'POST',headers:{...hostedHeaders,cookie:c,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify(payload)});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>7||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const requestsOf=b=>findNamed(b,'requests',Array.isArray)||[],actorOf=b=>findNamed(b,'actor',v=>!!v&&typeof v==='object'&&!Array.isArray(v))||{};
function localMinute(value){const d=new Date(value);assert.ok(Number.isFinite(d.getTime()),'invalid request timestamp');return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');}

let fatal=null;
try{
 const health=await request('/api/health',{headers:hostedHeaders});assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);console.log(`HEALTH_PASS ${health.body.release}`);
 const employee=await login('maya@northstar.example'),other=await login('other@isolation.example'),reviewer=await login('superuser@northstar.example');
 const employeeState=await authed(employee,'/api/bootstrap'),otherState=await authed(other,'/api/bootstrap');
 assert.equal(actorOf(employeeState.body)?.tenant,'northstar-demo');assert.equal(actorOf(otherState.body)?.tenant,'isolation-test');
 const personId=actorOf(employeeState.body)?.personId;assert.ok(personId);
 const all=requestsOf(employeeState.body).filter(r=>r.employee===personId&&r.kind==='Annual leave');
 const pending=all.filter(r=>r.status==='pending');assert.equal(pending.length,0,'synthetic recovery left pending leave');
 const candidates=all.filter(r=>r.status==='declined'&&r.start&&r.end).sort((a,b)=>String(b.id).localeCompare(String(a.id)));
 assert.ok(candidates.length,'no recovered declined request with interval found');
 const r=candidates[0];assert.ok(!requestsOf(otherState.body).some(x=>x.id===r.id),'request leaked cross-tenant');
 const payload={...r,employee:r.employee,requestId:r.id,start:localMinute(r.start),end:localMinute(r.end)};
 const capacity=await post(reviewer,'/api/leave-capacity',payload);
 assert.equal(capacity.status,200,`capacity failed ${capacity.status}: ${capacity.text.slice(0,200)}`);
 assert.ok(capacity.body&&typeof capacity.body==='object','capacity response missing');
 console.log(`LEAVE_CAPACITY_REVIEW_PASS request=${r.id} status=${capacity.body.status||'evaluated'}`);
 console.log('PRIVATE_ABSENCE_CAPACITY_PROOF=PASS');
 console.log('Recovered synthetic request remains declined; capacity evaluation made no leave write.');
}catch(e){fatal=e;console.error(`PRIVATE_ABSENCE_CAPACITY_FATAL ${e.message}`);}
createServer((req,res)=>{res.statusCode=fatal?503:200;res.setHeader('content-type','text/plain');res.end(fatal?'contained-after-failure\n':'proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
