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
const target=new URL(targetBase),browserHost=new URL(browserOrigin).host;
const hostedHeaders={host:browserHost,'x-forwarded-host':browserHost,'x-forwarded-proto':'https'};

async function request(path,init={}){
 const method=init.method||'GET',headers={...(init.headers||{})},body=init.body==null?null:String(init.body);
 if(body!=null)headers['content-length']=Buffer.byteLength(body);
 const transport=target.protocol==='https:'?httpsRequest:httpRequest;
 const result=await new Promise((resolve,reject)=>{const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,method,path,headers,timeout:20000},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({res,text:Buffer.concat(chunks).toString('utf8')}));});req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',reject);if(body!=null)req.write(body);req.end();});
 let parsed=null;try{parsed=result.text?JSON.parse(result.text):null}catch{parsed=result.text}
 return{status:result.res.statusCode||0,body:parsed,text:result.text,headers:result.res.headers};
}
function cookieFrom(r){const v=r.headers['set-cookie'],a=Array.isArray(v)?v:(v?[v]:[]);return a[0]?a[0].split(';',1)[0]:'';}
async function login(email){const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`${email} login failed ${r.status}`);const c=cookieFrom(r);assert.ok(c);return c;}
async function authed(c,path){return request(path,{headers:{...hostedHeaders,cookie:c,accept:'application/json',referer:`${browserOrigin}/`}});}
async function post(c,path,payload){return request(path,{method:'POST',headers:{...hostedHeaders,cookie:c,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify(payload)});}
async function command(c,version,name,payload){return post(c,'/api/command',{command:name,payload,version});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>8||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const v of Object.values(node)){const f=findNamed(v,name,accept,depth+1,seen);if(f!==null)return f;}return null;}
const requestsOf=b=>findNamed(b,'requests',Array.isArray)||[];
const actorOf=b=>findNamed(b,'actor',v=>!!v&&typeof v==='object'&&!Array.isArray(v))||{};
const versionOf=b=>findNamed(b,'version',Number.isInteger);
function localMinute(value){const d=new Date(value);assert.ok(Number.isFinite(d.getTime()),'invalid timestamp');return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');}
function collectDates(node,out=new Set(),depth=0,seen=new Set()){if(node==null||depth>8)return out;if(typeof node==='string'){for(const m of node.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g))out.add(m[0]);return out;}if(typeof node!=='object'||seen.has(node))return out;seen.add(node);if(Array.isArray(node))for(const v of node)collectDates(v,out,depth+1,seen);else for(const [k,v] of Object.entries(node)){if(/date|start|end|shift|day/i.test(k))collectDates(v,out,depth+1,seen);else if(depth<3)collectDates(v,out,depth+1,seen);}return out;}
function collectIntervals(node,out=[],depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>8||seen.has(node))return out;seen.add(node);if(!Array.isArray(node)){const start=typeof node.start==='string'?node.start:null,end=typeof node.end==='string'?node.end:null;const ls=start&&localMinute(start),le=end&&localMinute(end);if(ls&&le&&ls.slice(0,10)===le.slice(0,10))out.push({date:ls.slice(0,10),start:ls,end:le});}for(const v of Object.values(node))collectIntervals(v,out,depth+1,seen);return out;}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

let fatal=null;
try{
 const health=await request('/api/health',{headers:hostedHeaders});
 assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);assert.equal(health.body?.pilotReady,false);
 console.log(`HEALTH_PASS ${health.body.release}`);
 const employee=await login('maya@northstar.example'),other=await login('other@isolation.example'),reviewer=await login('superuser@northstar.example');
 const employeeInitial=await authed(employee,'/api/bootstrap'),personal=await authed(employee,'/api/personal'),otherInitial=await authed(other,'/api/bootstrap');
 assert.equal(actorOf(employeeInitial.body)?.tenant,'northstar-demo');assert.equal(actorOf(otherInitial.body)?.tenant,'isolation-test');
 const personId=actorOf(employeeInitial.body)?.personId;assert.ok(personId);
 assert.equal(requestsOf(employeeInitial.body).filter(r=>r.employee===personId&&r.kind==='Annual leave'&&r.status==='pending').length,0,'pending synthetic leave existed before approval proof');
 const dates=[...new Set([...collectDates(employeeInitial.body),...collectDates(personal.body)])].filter(d=>d>today).sort();
 const intervals=[...collectIntervals(employeeInitial.body),...collectIntervals(personal.body)];
 assert.ok(dates.length,'no future schedule dates available');
 let approved=null;
 for(const date of dates.slice(0,20)){
  let employeeState=await authed(employee,'/api/bootstrap');
  if(requestsOf(employeeState.body).some(r=>r.employee===personId&&r.status!=='declined'&&(r.date===date||String(r.start||'').startsWith(date))))continue;
  const matching=intervals.filter(x=>x.date===date).slice(0,4);
  const payloads=[...matching.map(i=>({date,start:i.start,end:i.end})),{date},{date,hours:8}];
  let created=null;
  for(const payload of payloads){
   const v=versionOf(employeeState.body);assert.ok(Number.isInteger(v));
   const submit=await command(employee,v,'leave-request',payload);
   if(submit.status===200){employeeState=await authed(employee,'/api/bootstrap');created=requestsOf(employeeState.body).find(r=>r.employee===personId&&r.kind==='Annual leave'&&r.status==='pending'&&(r.date===date||String(r.start||'').startsWith(date)));if(created)break;}
   employeeState=await authed(employee,'/api/bootstrap');
  }
  if(!created)continue;
  assert.ok(!requestsOf((await authed(other,'/api/bootstrap')).body).some(r=>r.id===created.id),'pending leave leaked cross-tenant');
  let reviewerState=await authed(reviewer,'/api/bootstrap');
  const visible=requestsOf(reviewerState.body).find(r=>r.id===created.id);assert.ok(visible,'reviewer cannot see pending request');
  const capacityPayload={...visible,employee:visible.employee,requestId:visible.id,start:visible.start?localMinute(visible.start):undefined,end:visible.end?localMinute(visible.end):undefined};
  const capacity=await post(reviewer,'/api/leave-capacity',capacityPayload);
  if(capacity.status!==200||capacity.body?.status!=='prechecks_clear'){
   reviewerState=await authed(reviewer,'/api/bootstrap');
   const decline=await command(reviewer,versionOf(reviewerState.body),'rules-leave-decision',{id:created.id,decision:'declined',reviewed:true,reason:'Synthetic approval-proof cleanup: capacity not clear.'});
   assert.equal(decline.status,200,'cleanup decline failed');
   console.log(`LEAVE_APPROVAL_CANDIDATE_SKIPPED request=${created.id} capacity=${capacity.body?.status||capacity.status}`);
   continue;
  }
  reviewerState=await authed(reviewer,'/api/bootstrap');
  const decision=await command(reviewer,versionOf(reviewerState.body),'rules-leave-decision',{id:created.id,decision:'approved',reviewed:true});
  assert.equal(decision.status,200,`approval failed ${decision.status}: ${decision.text.slice(0,180)}`);
  const employeeFinal=await authed(employee,'/api/bootstrap'),otherFinal=await authed(other,'/api/bootstrap'),reviewerFinal=await authed(reviewer,'/api/bootstrap');
  const final=requestsOf(employeeFinal.body).find(r=>r.id===created.id),reviewed=requestsOf(reviewerFinal.body).find(r=>r.id===created.id);
  assert.ok(final&&reviewed);assert.equal(final.status,'approved');assert.equal(reviewed.status,'approved');assert.ok(!requestsOf(otherFinal.body).some(r=>r.id===created.id),'approved leave leaked cross-tenant');
  approved={id:created.id,date};
  console.log(`LEAVE_APPROVAL_PASS request=${created.id} date=${date} status=approved capacity=prechecks_clear`);
  console.log('LEAVE_TENANT_ISOLATION_PASS');
  break;
 }
 assert.ok(approved,'no clean capacity-safe leave approval could be completed');
 console.log(`PRIVATE_ABSENCE_APPROVAL_PROOF=PASS request=${approved.id}`);
 console.log('claim_boundary=private synthetic fixture-only proof; no employee communication/payment; productionApproved=false; pilotReady=false');
}catch(e){fatal=e;console.error(`PRIVATE_ABSENCE_APPROVAL_FATAL ${e.message}`);}
createServer((req,res)=>{res.statusCode=fatal?503:200;res.setHeader('content-type','text/plain');res.end(fatal?'contained-after-failure\n':'proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
