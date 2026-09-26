import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const origin=String(process.env.TARGET_ORIGIN||'').replace(/\/$/,'');
const password=process.env.TARGET_PASSWORD||'';
const expectedRelease=process.env.EXPECTED_RELEASE||'0.6.76-hosted-staging-rc1';
const port=Number(process.env.PORT||3000);
const timeoutMs=20000;

assert.ok(origin.startsWith('https://'),'TARGET_ORIGIN must be https');
assert.ok(password.length>=20,'TARGET_PASSWORD missing/too short');

async function request(path,init={}){
  const response=await fetch(origin+path,{...init,signal:AbortSignal.timeout(timeoutMs)});
  const text=await response.text(); let body=null;
  try{body=text?JSON.parse(text):null}catch{body=text}
  return {response,body,text};
}
function cookieFrom(response){return (response.headers.get('set-cookie')||'').split(';',1)[0];}
async function login(email){
  const {response}=await request('/api/login',{method:'POST',headers:{'content-type':'application/json',origin,referer:origin+'/',accept:'application/json'},body:JSON.stringify({email,password})});
  assert.equal(response.status,200,email+' login failed');
  const cookie=cookieFrom(response); assert.ok(cookie,'no cookie '+email); return cookie;
}
async function authed(cookie,path,{method='GET',body,headers={}}={}){
  return request(path,{method,headers:{cookie,accept:'application/json,text/plain,*/*',referer:origin+'/',...(method==='POST'?{'content-type':'application/json',origin}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}

async function run(){
  const checks=[];
  const pass=(name,detail='')=>checks.push({name,status:'PASS',detail});
  const health=await request('/api/health');
  assert.equal(health.response.status,200); assert.equal(health.body?.release,expectedRelease);
  assert.equal(health.body?.fixtureOnly,true); assert.equal(health.body?.productionApproved,false); pass('release-boundary',expectedRelease);

  assert.equal((await request('/api/bootstrap')).response.status,401); pass('unauthenticated-bootstrap-denied','401');

  const manager=await login('manager@northstar.example');
  assert.equal((await authed(manager,'/api/bootstrap')).response.status,200);
  assert.equal((await authed(manager,'/api/payroll-run')).response.status,403); pass('manager-payroll-denied','403');

  const north=await login('superuser@northstar.example');
  const other=await login('other@isolation.example');
  const nb=await authed(north,'/api/bootstrap'); const ob=await authed(other,'/api/bootstrap');
  assert.equal(nb.response.status,200); assert.equal(ob.response.status,200);
  assert.equal(nb.body?.actor?.tenant,'northstar-demo'); assert.equal(ob.body?.actor?.tenant,'isolation-test');
  const forgedN=await authed(north,'/api/bootstrap?tenant=isolation-test',{headers:{'x-tenant-id':'isolation-test'}});
  const forgedO=await authed(other,'/api/bootstrap?tenant=northstar-demo',{headers:{'x-tenant-id':'northstar-demo'}});
  assert.equal(forgedN.body?.actor?.tenant,'northstar-demo'); assert.equal(forgedO.body?.actor?.tenant,'isolation-test');
  pass('tenant-override-resistance','query/header selectors ignored');

  const coreRoutes=['/api/readiness','/api/weekly-review','/api/schedule-publication','/api/operations','/api/payroll-run','/api/readiness/payroll-outcomes','/api/readiness/finance-attribution','/api/payroll-intelligence','/api/support/bot','/api/personal'];
  for(const path of coreRoutes){const r=await authed(north,path);assert.equal(r.response.status,200,path+' failed');}
  pass('authenticated-core-routes',String(coreRoutes.length));

  const categories={
    onboarding:['/api/onboarding','/api/company'],
    workforce:['/api/resources','/api/availability'],
    demand:['/api/demand','/api/operations'],
    attendance:['/api/time-review','/api/attendance-corrections'],
    value:['/api/cost','/api/recommendations','/api/value-cockpit']
  };
  for(const [name,paths] of Object.entries(categories)){
    let found=false;
    for(const path of paths){const r=await authed(north,path);if(r.response.status===200){found=true;break;}}
    assert.ok(found,'no live route for '+name); pass('category-'+name);
  }

  const staff=Array.isArray(nb.body?.state?.staff)?nb.body.state.staff:[];
  const employee=staff.find(p=>p.id==='e0'&&p.site&&p.onboardingReady!==false)||staff.find(p=>p.site&&p.onboardingReady!==false);
  assert.ok(employee,'no kiosk employee');
  const reg=await authed(north,'/api/kiosk/devices/register',{method:'POST',body:{site:employee.site,name:'Fast security proof '+Date.now()}});
  assert.equal(reg.response.status,200);
  const deviceId=reg.body?.id, secret=reg.body?.secret; assert.ok(deviceId&&String(secret).length>=32);
  pass('kiosk-device-register',deviceId);

  const base=Date.now();
  const events=[
    {eventId:'fast-in-'+randomBytes(8).toString('hex'),sequence:1,employee:employee.id,type:'in',capturedAt:new Date(base-120000).toISOString(),clockOffsetMs:0},
    {eventId:'fast-out-'+randomBytes(8).toString('hex'),sequence:2,employee:employee.id,type:'out',capturedAt:new Date(base-60000).toISOString(),clockOffsetMs:0}
  ];
  const kiosk=payload=>request('/api/kiosk/sync',{method:'POST',headers:{'content-type':'application/json','x-device-id':deviceId,authorization:'Device '+secret,accept:'application/json'},body:JSON.stringify(payload)});
  const injected=await kiosk({tenant:'isolation-test',events}); assert.equal(injected.response.status,400); pass('kiosk-tenant-injection-denied','400');
  const sync=await kiosk({events}); assert.equal(sync.response.status,200); assert.equal(sync.body?.accepted,2); assert.equal(sync.body?.held,0); assert.equal(sync.body?.lastSequence,2); pass('kiosk-clock-cycle','2 accepted');
  const replay=await kiosk({events}); assert.equal(replay.response.status,200); assert.ok(replay.body?.results?.every(x=>x.replayed===true)); pass('kiosk-idempotency');
  const gap=await kiosk({events:[{eventId:'fast-gap-'+randomBytes(8).toString('hex'),sequence:4,employee:employee.id,type:'in',capturedAt:new Date().toISOString(),clockOffsetMs:0}]});
  assert.equal(gap.response.status,200); assert.equal(gap.body?.accepted,0); assert.equal(gap.body?.held,1); pass('sequence-gap-held');

  const devices=await authed(north,'/api/kiosk/devices'); const device=devices.body?.devices?.find(x=>x.id===deviceId);
  assert.ok(device); assert.equal(Object.prototype.hasOwnProperty.call(device,'secret'),false); pass('device-secret-not-leaked');

  const revoke=await authed(north,'/api/kiosk/devices/revoke',{method:'POST',body:{id:deviceId}}); assert.equal(revoke.response.status,200); assert.equal(revoke.body?.status,'revoked');
  const after=await kiosk({events:[{eventId:'fast-after-'+randomBytes(8).toString('hex'),sequence:3,employee:employee.id,type:'in',capturedAt:new Date().toISOString(),clockOffsetMs:0}]});
  assert.equal(after.response.status,401); pass('revoked-device-denied','401');

  return {status:'PASS',release:expectedRelease,checks,completedAt:new Date().toISOString(),claimBoundary:'fixture-only hosted candidate; no production mutation'};
}

let result;
try{result=await run();console.log('VECTOR_LIVE_SECURITY_PROOF='+JSON.stringify(result));}
catch(e){console.error('VECTOR_LIVE_SECURITY_PROOF_FAIL='+String(e?.stack||e));process.exit(1);}
http.createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}).listen(port,'0.0.0.0');
