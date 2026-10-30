'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const modulePath=path.resolve(process.env.WFM_RECOVERY_MODULE||path.join(__dirname,'owner-access-recovery.cjs'));
const {createOwnerAccessRecovery,API_PATH,PAGE_PATH}=require(modulePath);
const {FORBIDDEN_IDENTITY_HEADERS}=require(path.join(path.dirname(modulePath),'identity-survival-guard.cjs'));

async function fixture(t,patch={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-recovery-help-'));
  const dbPath=path.join(dir,'must-not-be-created.sqlite');
  const now=1700000000000;
  const grant={id:'synthetic-grant-identity',tokenHash:'1'.repeat(64),issuedAt:now-1000,expiresAt:now+60000,sessionEpoch:1,policyVersion:1,purpose:'first-passkey'};
  const env={NODE_ENV:'staging',WFM_HOSTED_STAGING:'true',WFM_DB:dbPath,WFM_PUBLIC_ORIGIN:'https://vector.example',...patch};
  const handler=createOwnerAccessRecovery({env,clock:()=>now});
  const server=http.createServer(async(req,res)=>{if(!await handler.handleRequest(req,res)){res.statusCode=404;res.end('Unhandled');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});});
  const call=(url=PAGE_PATH,options={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path:url,headers:{host:'vector.example','x-forwarded-proto':'https',...options.headers},method:options.method||'GET'},res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>{body+=chunk;});res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>res.headers[name]??null},body}));
    });req.on('error',reject);req.end(options.body);
  });
  return {env,grant,now,dbPath,call};
}

function honestHelp(response){
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(response.body,/Help signing in/);
  assert.match(response.body,/secure invitation/);
  assert.match(response.body,/organisation.s administrator/);
  assert.match(response.body,/href="\/"/);
  assert.doesNotMatch(response.body,/<form|<input|<script|superuser@|northstar-demo|new-password|owner-recovery-code|tokenHash/i);
  assert.equal(response.headers.get('set-cookie'),null);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
}

test('advertised recovery link gives useful public help without a grant or database',async t=>{
  const f=await fixture(t);honestHelp(await f.call());
  assert.equal(fs.existsSync(f.dbPath),false);
  const api=await f.call(API_PATH,{method:'POST',headers:{origin:'https://vector.example','content-type':'application/json'},body:'{"token":"not-a-valid-code"}'});
  assert.equal(api.status,404);assert.equal(api.headers.get('set-cookie'),null);assert.equal(fs.existsSync(f.dbPath),false);
});

test('malformed, expired, nonstaging and legacy grants give identical public help without enabling a password or setup flow',async t=>{
  const f=await fixture(t),baseline=await f.call();honestHelp(baseline);
  const legacy={...f.grant};delete legacy.purpose;
  for(const changes of [
    {WFM_OWNER_RECOVERY_JSON:'{'},
    {WFM_OWNER_RECOVERY_JSON:'{}'},
    {WFM_OWNER_RECOVERY_JSON:JSON.stringify({...f.grant,issuedAt:f.now-120000,expiresAt:f.now-60000})},
    {WFM_OWNER_RECOVERY_JSON:JSON.stringify(f.grant),NODE_ENV:'production'},
    {WFM_OWNER_RECOVERY_JSON:JSON.stringify(f.grant),WFM_HOSTED_STAGING:'false'},
    {WFM_OWNER_RECOVERY_JSON:JSON.stringify(legacy)}
  ]){
    Object.assign(f.env,{NODE_ENV:'staging',WFM_HOSTED_STAGING:'true'},changes);
    const response=await f.call();honestHelp(response);assert.equal(response.body,baseline.body);
    assert.equal(fs.existsSync(f.dbPath),false);
  }
});

test('public recovery help rejects altered URL, host, transport, method and identity headers without cookies or storage',async t=>{
  const f=await fixture(t);
  const cases=[
    [PAGE_PATH+'?token=untrusted',{},403],
    [PAGE_PATH,{headers:{host:'attacker.example'}},403],
    [PAGE_PATH,{headers:{'x-forwarded-proto':'http'}},403],
    [PAGE_PATH,{headers:{'x-forwarded-proto':'https,http'}},403],
    [PAGE_PATH,{method:'POST'},405],
    ...FORBIDDEN_IDENTITY_HEADERS.map(name=>[PAGE_PATH,{headers:{[name]:'untrusted'}},403])
  ];
  for(const [url,options,status]of cases){const response=await f.call(url,options);assert.equal(response.status,status);assert.equal(response.headers.get('set-cookie'),null);assert.doesNotMatch(response.body,/superuser@|northstar-demo|owner-recovery-code|new-password/);assert.equal(fs.existsSync(f.dbPath),false);}
});

test('only configured current first-passkey grant displays existing setup ceremony and does not touch storage',async t=>{
  const f=await fixture(t);f.env.WFM_OWNER_RECOVERY_JSON=JSON.stringify(f.grant);
  const response=await f.call();assert.equal(response.status,200);assert.match(response.body,/id="owner-recovery-code"/);assert.match(response.body,/src="\/passkey-ui.js"/);
  assert.doesNotMatch(response.body,/new-password|superuser@|northstar-demo/);assert.equal(response.headers.get('set-cookie'),null);assert.equal(fs.existsSync(f.dbPath),false);
});
