import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
console.log('VECTOR_PROOF_STARTED');
'use strict';
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const http=require('node:http');
const origin='https://vector-customer-ready-candidate-production.up.railway.app';
const correctionId='AC-616ddc06b0b3c969aee1b825443a2431';
const expectedRelease='0.6.76-hosted-staging-rc1';
const phase='baseline';
const proof={phase,target:origin,candidateSha:'7d72c52f28e21c5225fcdce19e3e4fcecc6e5adb',startedAt:new Date().toISOString(),assertions:[]};
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
async function req(path,options={}){const r=await fetch(origin+path,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});const text=await r.text();let body;try{body=JSON.parse(text)}catch{body=null}return {r,text,body};}
function check(name,fn){fn();proof.assertions.push({name,status:'PASS'});}
async function login(email){const x=await req('/api/login',{method:'POST',headers:{'content-type':'application/json',origin,referer:origin+'/',accept:'application/json'},body:JSON.stringify({email,password:process.env.TARGET_PASSWORD})});assert.equal(x.r.status,200,'fresh fixture login');const raw=x.r.headers.get('set-cookie')||'';assert.ok(/HttpOnly/i.test(raw),'session HttpOnly');assert.ok(/Secure/i.test(raw),'session Secure');return raw.split(';',1)[0];}
function finish(status,error){proof.status=status;proof.finishedAt=new Date().toISOString();if(error)proof.error=String(error.message||error).slice(0,500);console.log('VECTOR_RELEASE_BOUND_PROOF='+JSON.stringify(proof));http.createServer((q,s)=>{s.writeHead(status==='PASS'?200:503,{'content-type':'application/json'});s.end(JSON.stringify(proof));}).listen(process.env.PORT||3000,'0.0.0.0');}
(async()=>{
assert.equal((process.env.TARGET_ORIGIN||'').replace(/\/$/,''),origin,'runner must bind current protected origin');
assert.ok(process.env.TARGET_PASSWORD?.length>=20,'existing credential required');
const health=await req('/api/health');
check('hosted_fixture_boundary',()=>{assert.equal(health.r.status,200);assert.equal(health.body.release,expectedRelease);assert.equal(health.body.fixtureOnly,true);assert.equal(health.body.productionApproved,false);});
proof.health=health.body;
const asset=await req('/vector-ui.js');check('served_asset',()=>{assert.equal(asset.r.status,200);assert.ok(asset.text.includes('VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1'));});proof.assetSha256=hash(asset.text);
const unauth=await req('/api/attendance-corrections');
check('unauthenticated_records_denied',()=>assert.ok([401,403].includes(unauth.r.status),'unauth status '+unauth.r.status));
const forged=await req('/api/attendance-corrections',{headers:{'x-user-role':'superuser','x-tenant-id':'northstar','x-user-id':'m1'}});
check('forged_headers_denied',()=>assert.ok([401,403].includes(forged.r.status),'forged status '+forged.r.status));
const cookie=await login('maya@northstar.example');
check('fresh_login_secure_cookie',()=>assert.ok(cookie.length>10));
const dash=await req('/api/attendance-corrections',{headers:{cookie,referer:origin+'/',accept:'application/json'}});
check('employee_readback',()=>assert.equal(dash.r.status,200));
const row=dash.body?.requests?.find(q=>q.id===correctionId);
check('exact_correction_state',()=>{assert.ok(row,'exact correction missing');assert.equal(row.status,'rejected');assert.equal(row.revision,2);assert.equal(row.outcome?.applied,false);const types=row.history.map(x=>x.type);assert.ok(types.includes('attendance-correction-submitted'));assert.ok(types.includes('attendance-correction-reject'));});
proof.correction={id:row.id,status:row.status,revision:row.revision,history:row.history.map(x=>x.type),sha256:hash(row)};
const record=dash.body.records?.find(x=>x.id==='wr-e0-2026-09-07');
check('source_record_preserved',()=>assert.ok(record));proof.sourceRecordSha256=hash(record);
proof.recordCount=dash.body.records?.length;proof.requestCount=dash.body.requests?.length;
finish('PASS');
})().catch(e=>finish('FAIL',e));
