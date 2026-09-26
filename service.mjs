import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

const mode = process.env.MODE || 'verify';
const target = String(process.env.TARGET_ORIGIN || '').replace(/\/$/, '');
const password = process.env.TARGET_PASSWORD || '';
const expectedRelease = process.env.EXPECTED_RELEASE || '0.6.76-hosted-staging-rc1';
const seedOrigin = String(process.env.SEED_ORIGIN || '').replace(/\/$/, '');
const port = Number(process.env.PORT || 3000);
const timeoutMs = 20_000;
const openStatuses = new Set(['submitted','information_required','awaiting_approval','payroll_review_required']);
let latest = { status:'STARTING', mode, startedAt:new Date().toISOString() };

function cookieFrom(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values[0] ? values[0].split(';',1)[0] : '';
}
async function request(origin, path, init={}) {
  const response = await fetch(origin + path, {...init, signal:AbortSignal.timeout(timeoutMs)});
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { response, body, text };
}
async function login(email) {
  const {response} = await request(target,'/api/login',{
    method:'POST',
    headers:{'content-type':'application/json',origin:target,referer:target+'/',accept:'application/json'},
    body:JSON.stringify({email,password})
  });
  assert.equal(response.status,200,email+' login failed: '+response.status);
  const cookie = cookieFrom(response);
  assert.ok(cookie,'missing session cookie for '+email);
  return cookie;
}
async function authed(cookie,path,{method='GET',body}={}) {
  return request(target,path,{
    method,
    headers:{
      cookie,
      accept:'application/json,text/plain,*/*',
      referer:target+'/',
      ...(method==='POST'?{'content-type':'application/json',origin:target}:{})
    },
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
}
function londonLocalMinute(value) {
  const d = new Date(value);
  assert.ok(Number.isFinite(d.getTime()),'invalid attendance timestamp');
  return new Intl.DateTimeFormat('sv-SE',{
    timeZone:'Europe/London',
    year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hour12:false
  }).format(d).replace(' ','T');
}
async function healthCheck() {
  assert.ok(target.startsWith('https://'),'TARGET_ORIGIN must be https');
  assert.ok(password.length>=20,'TARGET_PASSWORD missing/too short');
  const health=await request(target,'/api/health');
  assert.equal(health.response.status,200,'target health failed');
  assert.equal(health.body?.release,expectedRelease,'unexpected target release');
  return health.body;
}
async function seed() {
  const health = await healthCheck();
  const candidates=[
    ['maya@northstar.example','e0'],
    ['leah@northstar.example','e32'],
    ['quality@northstar.example','e16'],
    ['leeds-employee@northstar.example','e24']
  ];
  let employee=null;
  for (const [email,personId] of candidates) {
    const cookie=await login(email);
    const dash=await authed(cookie,'/api/attendance-corrections');
    assert.equal(dash.response.status,200,email+' dashboard failed');
    const blocked=new Set((dash.body?.requests||[])
      .filter(q=>q.employee===personId && openStatuses.has(q.status))
      .map(q=>q.record));
    const record=(dash.body?.records||[]).find(r=>r.employee===personId && r.effective?.clockIn && r.effective?.clockOut && !blocked.has(r.id));
    if (record) { employee={email,personId,cookie,dash:dash.body,record}; break; }
  }
  assert.ok(employee,'no safe attendance record available');
  const clockIn=londonLocalMinute(employee.record.effective.clockIn);
  const clockOut=londonLocalMinute(employee.record.effective.clockOut);
  const submitKey='persist-seed-'+randomBytes(10).toString('hex');
  const submitted=await authed(employee.cookie,'/api/attendance-corrections/command',{
    method:'POST',
    body:{
      version:employee.dash.version,
      command:'correction-submit',
      payload:{
        period:employee.record.period,
        record:employee.record.id,
        clockIn,clockOut,
        note:'Hosted persistence proof seed. Requested times match existing evidence; no attendance mutation intended.'
      },
      idempotencyKey:submitKey
    }
  });
  assert.equal(submitted.response.status,200,'correction submit failed');
  const correctionId=submitted.body?.result?.id;
  assert.match(String(correctionId||''),/^AC-[a-f0-9]{32}$/i);
  assert.equal(submitted.body?.result?.revision,1);

  const managers=['manager@northstar.example','supervisor@northstar.example','director@northstar.example','superuser@northstar.example'];
  let manager=null;
  for (const email of managers) {
    const cookie=await login(email);
    const dash=await authed(cookie,'/api/attendance-corrections');
    if (dash.response.status!==200) continue;
    const visible=(dash.body?.requests||[]).find(q=>q.id===correctionId);
    if (visible) { manager={email,cookie,dash:dash.body}; break; }
  }
  assert.ok(manager,'no authorised reviewer can see seeded correction');
  const reviewKey='persist-review-'+randomBytes(10).toString('hex');
  const reviewed=await authed(manager.cookie,'/api/attendance-corrections/command',{
    method:'POST',
    body:{
      version:manager.dash.version,
      command:'correction-review',
      payload:{
        id:correctionId,
        revision:1,
        decision:'reject',
        note:'Hosted persistence proof: rejected by design so original attendance evidence remains unchanged.'
      },
      idempotencyKey:reviewKey
    }
  });
  assert.equal(reviewed.response.status,200,'correction review failed');
  assert.equal(reviewed.body?.result?.status,'rejected');
  assert.equal(reviewed.body?.result?.revision,2);

  const after=await authed(employee.cookie,'/api/attendance-corrections');
  const row=(after.body?.requests||[]).find(q=>q.id===correctionId);
  assert.ok(row,'seeded correction not readable before restart');
  assert.equal(row.status,'rejected');
  assert.equal(row.revision,2);
  assert.equal(row.outcome?.applied,false);
  const history=(row.history||[]).map(h=>h.type);
  assert.ok(history.includes('attendance-correction-submitted'));
  assert.ok(history.includes('attendance-correction-reject'));

  return {
    status:'PASS',mode:'seed',targetRelease:health.release,
    correctionId,employeeEmail:employee.email,employeeId:employee.personId,
    recordId:employee.record.id,period:employee.record.period,
    finalStatus:row.status,revision:row.revision,history,
    seededAt:new Date().toISOString()
  };
}
async function verify() {
  const health=await healthCheck();
  assert.ok(seedOrigin.startsWith('https://'),'SEED_ORIGIN must be https');
  const seedResult=await request(seedOrigin,'/');
  assert.equal(seedResult.response.status,200,'seed service unavailable');
  assert.equal(seedResult.body?.status,'PASS','seed did not pass');
  const correctionId=seedResult.body.correctionId;
  const employeeEmail=seedResult.body.employeeEmail;
  assert.match(String(correctionId||''),/^AC-[a-f0-9]{32}$/i);
  assert.ok(String(employeeEmail||'').includes('@'));

  const cookie=await login(employeeEmail);
  const dash=await authed(cookie,'/api/attendance-corrections');
  assert.equal(dash.response.status,200,'fresh-login dashboard failed');
  const row=(dash.body?.requests||[]).find(q=>q.id===correctionId);
  assert.ok(row,'persisted correction was not found after target restart');
  assert.equal(row.status,'rejected');
  assert.equal(row.revision,2);
  assert.equal(row.outcome?.applied,false);
  const history=(row.history||[]).map(h=>h.type);
  assert.ok(history.includes('attendance-correction-submitted'));
  assert.ok(history.includes('attendance-correction-reject'));

  return {
    status:'PASS',mode:'verify',targetRelease:health.release,
    correctionId,employeeEmail,finalStatus:row.status,revision:row.revision,
    history,verifiedAt:new Date().toISOString(),
    proof:'fresh external service + fresh login after candidate restart'
  };
}
async function run() {
  latest={status:'RUNNING',mode,startedAt:new Date().toISOString()};
  try {
    latest = mode==='seed' ? await seed() : await verify();
  } catch (error) {
    latest={status:'FAIL',mode,error:String(error?.stack||error),finishedAt:new Date().toISOString()};
  }
  console.log('VECTOR_HOSTED_PERSISTENCE_PROOF='+JSON.stringify(latest));
}
await run();

http.createServer((req,res)=>{
  const ok=latest.status==='PASS';
  res.writeHead(ok?200:503,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify(latest));
}).listen(port,'0.0.0.0');
