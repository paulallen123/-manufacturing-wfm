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
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`${email} login ${r.status}`);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
async function post(c,path,payload){return request(path,{method:'POST',headers:{...hostedHeaders,cookie:c,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify(payload)});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>7||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const versionOf=b=>findNamed(b,'version',Number.isInteger),requestsOf=b=>findNamed(b,'requests',Array.isArray)||[],actorOf=b=>findNamed(b,'actor',v=>!!v&&typeof v==='object'&&!Array.isArray(v))||{};
async function command(c,version,name,payload){return post(c,'/api/command',{command:name,payload,version});}

let fatal=null;
try{
  const health=await request('/api/health',{headers:hostedHeaders});assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);console.log(`HEALTH_PASS ${health.body.release}`);
  const employee=await login('maya@northstar.example'),other=await login('other@isolation.example'),reviewer=await login('superuser@northstar.example');
  let employeeState=await authed(employee,'/api/bootstrap'),otherState=await authed(other,'/api/bootstrap');
  assert.equal(actorOf(employeeState.body)?.tenant,'northstar-demo');assert.equal(actorOf(otherState.body)?.tenant,'isolation-test');
  const personId=actorOf(employeeState.body)?.personId;assert.ok(personId);
  const pending=requestsOf(employeeState.body).filter(r=>r.employee===personId&&r.kind==='Annual leave'&&r.status==='pending');
  console.log(`PENDING_SYNTHETIC_LEAVE_FOUND count=${pending.length}`);
  let declined=0,failed=0;
  for(const r of pending){
    assert.ok(!requestsOf(otherState.body).some(x=>x.id===r.id),'pending leave leaked cross-tenant');
    let reviewerState=await authed(reviewer,'/api/bootstrap');let version=versionOf(reviewerState.body);assert.ok(Number.isInteger(version));
    let decision=await command(reviewer,version,'rules-leave-decision',{id:r.id,decision:'declined',reviewed:true,reason:'Controlled synthetic proof cleanup after preserved failed run.'});
    if(decision.status!==200){reviewerState=await authed(reviewer,'/api/bootstrap');version=versionOf(reviewerState.body);decision=await command(reviewer,version,'leave-decision',{id:r.id,decision:'declined'});}
    if(decision.status===200){declined++;console.log(`LEAVE_SYNTHETIC_CLOSE_PASS id=${r.id}`);}else{failed++;console.log(`LEAVE_SYNTHETIC_CLOSE_BLOCKED id=${r.id} status=${decision.status} error=${String(decision.body?.error||'').slice(0,120)}`);}
  }
  employeeState=await authed(employee,'/api/bootstrap');otherState=await authed(other,'/api/bootstrap');
  const tracked=requestsOf(employeeState.body).filter(r=>pending.some(p=>p.id===r.id));
  const stillPending=tracked.filter(r=>r.status==='pending').length;
  assert.ok(!requestsOf(otherState.body).some(r=>pending.some(p=>p.id===r.id)),'leave evidence leaked cross-tenant');
  console.log(`PRIVATE_ABSENCE_RECOVERY_RESULT declined=${declined} blocked=${failed} stillPending=${stillPending}`);
  if(stillPending===0){console.log('PRIVATE_ABSENCE_RECOVERY_PROOF=PASS');}else{console.log('PRIVATE_ABSENCE_RECOVERY_PROOF=PARTIAL');}
}catch(e){fatal=e;console.error(`PRIVATE_ABSENCE_RECOVERY_FATAL ${e.message}`);}
createServer((req,res)=>{res.statusCode=fatal?503:200;res.setHeader('content-type','text/plain');res.end(fatal?'contained-after-failure\n':'proof-contained\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
