import assert from 'node:assert/strict';
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';

const targetBase = (process.env.PROOF_TARGET_BASE || '').replace(/\/$/, '');
const browserOrigin = (process.env.PROOF_BROWSER_ORIGIN || '').replace(/\/$/, '');
const password = process.env.WFM_STAGING_PASSWORD;
const expectedRelease = '0.6.76-hosted-staging-rc1';
assert.ok(targetBase.startsWith('http://') || targetBase.startsWith('https://'), 'PROOF_TARGET_BASE missing');
assert.ok(targetBase.includes('.railway.internal'), 'Proof target must stay on Railway private networking');
assert.ok(browserOrigin.startsWith('https://'), 'PROOF_BROWSER_ORIGIN missing');
assert.ok(password && password.length >= 20, 'WFM_STAGING_PASSWORD missing');

const target = new URL(targetBase);
const browserHost = new URL(browserOrigin).host;
const hostedHeaders = { host: browserHost, 'x-forwarded-host': browserHost, 'x-forwarded-proto': 'https' };
const timeoutMs = 20_000;

async function request(path, init = {}) {
  const method = init.method || 'GET';
  const headers = { ...(init.headers || {}) };
  const body = init.body == null ? null : String(init.body);
  if (body != null && headers['content-length'] == null) headers['content-length'] = Buffer.byteLength(body);
  const transport = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const result = await new Promise((resolve, reject) => {
    const req = transport({ protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method, path, headers, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ res, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
  let parsed = null;
  try { parsed = result.text ? JSON.parse(result.text) : null; } catch { parsed = result.text; }
  return { status: result.res.statusCode || 0, body: parsed, text: result.text, headers: result.res.headers };
}
function cookieFrom(r) { const v=r.headers['set-cookie']; const a=Array.isArray(v)?v:(v?[v]:[]); return a[0]?a[0].split(';',1)[0]:''; }
async function login(email) {
  const r=await request('/api/login',{method:'POST',headers:{...hostedHeaders,'content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`,accept:'application/json'},body:JSON.stringify({email,password})});
  assert.equal(r.status,200,`${email} login failed ${r.status}: ${r.text.slice(0,160)}`); const cookie=cookieFrom(r); assert.ok(cookie); return cookie;
}
async function authed(cookie,path){return request(path,{headers:{...hostedHeaders,cookie,accept:'application/json',referer:`${browserOrigin}/`}});}
async function command(cookie,version,name,payload){return request('/api/command',{method:'POST',headers:{...hostedHeaders,cookie,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify({command:name,payload,version})});}
async function post(cookie,path,payload){return request(path,{method:'POST',headers:{...hostedHeaders,cookie,accept:'application/json','content-type':'application/json',origin:browserOrigin,referer:`${browserOrigin}/`},body:JSON.stringify(payload)});}
function findNamed(node,name,accept,depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>6||seen.has(node))return null;seen.add(node);if(Object.prototype.hasOwnProperty.call(node,name)&&accept(node[name]))return node[name];for(const value of Object.values(node)){const found=findNamed(value,name,accept,depth+1,seen);if(found!==null)return found;}return null;}
const versionOf=b=>findNamed(b,'version',Number.isInteger);
const requestsOf=b=>findNamed(b,'requests',Array.isArray)||[];
const actorOf=b=>findNamed(b,'actor',v=>!!v&&typeof v==='object'&&!Array.isArray(v))||{};
function localMinute(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return null;return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d).replace(' ','T');}
function collectDates(node,out=new Set(),depth=0,seen=new Set()){if(node==null||depth>8)return out;if(typeof node==='string'){for(const m of node.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g))out.add(m[0]);return out;}if(typeof node!=='object'||seen.has(node))return out;seen.add(node);if(Array.isArray(node))for(const v of node)collectDates(v,out,depth+1,seen);else for(const [k,v] of Object.entries(node)){if(/date|start|end|shift|day/i.test(k))collectDates(v,out,depth+1,seen);else if(depth<3)collectDates(v,out,depth+1,seen);}return out;}
function collectIntervals(node,out=[],depth=0,seen=new Set()){if(!node||typeof node!=='object'||depth>8||seen.has(node))return out;seen.add(node);if(!Array.isArray(node)){const start=typeof node.start==='string'?node.start:(typeof node.clockIn==='string'?node.clockIn:null);const end=typeof node.end==='string'?node.end:(typeof node.clockOut==='string'?node.clockOut:null);const ls=start&&localMinute(start),le=end&&localMinute(end);if(ls&&le&&ls.slice(0,10)===le.slice(0,10))out.push({date:ls.slice(0,10),start:ls,end:le,rawStart:start,rawEnd:end});}for(const value of Object.values(node))collectIntervals(value,out,depth+1,seen);return out;}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

const health=await request('/api/health',{headers:hostedHeaders});assert.equal(health.status,200);assert.equal(health.body?.release,expectedRelease);assert.equal(health.body?.fixtureOnly,true);assert.equal(health.body?.productionApproved,false);assert.equal(health.body?.pilotReady,false);console.log(`HEALTH_PASS ${health.body.release}`);
const employeeEmail='maya@northstar.example',otherEmail='other@isolation.example';
const managerCandidates=['manager@northstar.example','supervisor@northstar.example','director@northstar.example','superuser@northstar.example'];
const employeeCookie=await login(employeeEmail),otherCookie=await login(otherEmail);
const employeeBefore=await authed(employeeCookie,'/api/bootstrap'),personalBefore=await authed(employeeCookie,'/api/personal'),otherBefore=await authed(otherCookie,'/api/bootstrap');
assert.equal(employeeBefore.status,200);assert.equal(personalBefore.status,200);assert.equal(otherBefore.status,200);assert.equal(actorOf(employeeBefore.body)?.tenant,'northstar-demo');assert.equal(actorOf(otherBefore.body)?.tenant,'isolation-test');assert.notEqual(actorOf(employeeBefore.body)?.tenant,actorOf(otherBefore.body)?.tenant);
const employeePerson=actorOf(employeeBefore.body)?.personId;assert.ok(employeePerson);let beforeVersion=versionOf(employeeBefore.body);assert.ok(Number.isInteger(beforeVersion));const beforeRequests=requestsOf(employeeBefore.body);console.log(`BOOTSTRAP_STATE_PASS version=${beforeVersion} requests=${beforeRequests.length}`);
const candidates=[...new Set([...collectDates(personalBefore.body),...collectDates(employeeBefore.body)])].filter(date=>date>today&&!beforeRequests.some(r=>r.employee===employeePerson&&r.date===date&&r.status!=='declined')).sort();
const intervals=[...collectIntervals(personalBefore.body),...collectIntervals(employeeBefore.body)];assert.ok(candidates.length,'no future dated employee schedule evidence found');console.log(`SHIFT_DATE_EVIDENCE_PASS futureCandidates=${candidates.length} intervals=${intervals.length}`);
let date=null,submitted=null,successfulPayload=null;
outer:for(const candidate of candidates.slice(0,40)){const matching=intervals.filter(x=>x.date===candidate).slice(0,6);const payloads=[{date:candidate}];for(const i of matching){payloads.push({date:candidate,start:i.start,end:i.end});if(i.rawStart!==i.start||i.rawEnd!==i.end)payloads.push({date:candidate,start:i.rawStart,end:i.rawEnd});}payloads.push({date:candidate,hours:8});const seen=new Set();for(const payload of payloads){const k=JSON.stringify(payload);if(seen.has(k))continue;seen.add(k);const attempt=await command(employeeCookie,beforeVersion,'leave-request',payload);if(attempt.status===200){date=candidate;submitted=attempt;successfulPayload=payload;break outer;}const err=String(attempt.body?.error||attempt.text||'');if(!/No published shift starts|scheduled interval|already exists|outside|partial-shift|start and end|hours are calculated|invalid leave|request|Choose a future date/i.test(err))throw new Error(`Unexpected leave request rejection on ${candidate}: ${attempt.status} ${err.slice(0,200)}`);const refreshed=await authed(employeeCookie,'/api/bootstrap');beforeVersion=versionOf(refreshed.body)??beforeVersion;}}
assert.ok(date&&submitted&&successfulPayload,`no future published shift accepted bounded leave; checked ${Math.min(candidates.length,40)} candidates`);console.log(`LEAVE_REQUEST_SUBMIT_PASS date=${date} mode=${successfulPayload.start?'bounded-interval':(successfulPayload.hours?'hours':'full-shift')}`);
const employeeAfterSubmit=await authed(employeeCookie,'/api/bootstrap');const created=requestsOf(employeeAfterSubmit.body).find(r=>r.employee===employeePerson&&(r.date===date||String(r.start||'').startsWith(date))&&r.status!=='declined');assert.ok(created);assert.equal(created.status,'pending');assert.equal(created.kind,'Annual leave');assert.ok(Number(created.hours)>0||created.start);assert.ok(created.id);console.log('LEAVE_REQUEST_VISIBILITY_PASS pending annual-leave');
const duplicateVersion=versionOf(employeeAfterSubmit.body);const duplicate=await command(employeeCookie,duplicateVersion,'leave-request',successfulPayload);assert.notEqual(duplicate.status,200);const employeeAfterDuplicate=await authed(employeeCookie,'/api/bootstrap');assert.equal(requestsOf(employeeAfterDuplicate.body).filter(r=>r.id===created.id).length,1);console.log(`LEAVE_DUPLICATE_GUARD_PASS status=${duplicate.status}`);
const otherAfter=await authed(otherCookie,'/api/bootstrap');assert.ok(!requestsOf(otherAfter.body).some(r=>r.id===created.id));console.log('LEAVE_TENANT_ISOLATION_PASS');
let reviewer=null;for(const email of managerCandidates){const cookie=await login(email),dash=await authed(cookie,'/api/bootstrap');if(dash.status!==200||actorOf(dash.body)?.tenant!=='northstar-demo')continue;const visible=requestsOf(dash.body).find(r=>r.id===created.id);if(!visible)continue;const capacity=await post(cookie,'/api/leave-capacity',{...visible,employee:visible.employee,requestId:visible.id});if(capacity.status===200){reviewer={email,cookie,dash:dash.body,visible,capacity:capacity.body};break;}}
assert.ok(reviewer,'no authorised reviewer could see request and execute leave-capacity check');console.log(`LEAVE_CAPACITY_REVIEW_PASS reviewer=${reviewer.email}`);
const reviewVersion=versionOf(reviewer.dash);const decision=await command(reviewer.cookie,reviewVersion,'rules-leave-decision',{id:created.id,decision:'declined',reviewed:true,reason:'Controlled synthetic proof: decline by design after capacity review.'});assert.equal(decision.status,200,`leave decision failed ${decision.status}: ${decision.text.slice(0,240)}`);console.log('LEAVE_DECISION_PASS declined-by-design');
const employeeFinal=await authed(employeeCookie,'/api/bootstrap');const final=requestsOf(employeeFinal.body).find(r=>r.id===created.id);assert.ok(final);assert.equal(final.status,'declined');const otherFinal=await authed(otherCookie,'/api/bootstrap');assert.ok(!requestsOf(otherFinal.body).some(r=>r.id===created.id));console.log('PRIVATE_ABSENCE_END_TO_END_PROOF=PASS');console.log('claim_boundary=private synthetic fixture-only proof; decline-by-design; no employee communication/payment; productionApproved=false; pilotReady=false');
createServer((req,res)=>{res.statusCode=200;res.setHeader('content-type','text/plain');res.end('proof-pass\n');}).listen(Number(process.env.PORT||3000),'0.0.0.0');
