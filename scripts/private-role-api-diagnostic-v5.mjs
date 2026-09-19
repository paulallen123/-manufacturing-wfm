import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// DEVELOPMENT-only proof harness. Targets only Railway private networking and synthetic identities.
const targetBase=(process.env.PROOF_TARGET_BASE||'').replace(/\/$/,'');
const browserOrigin=(process.env.PROOF_BROWSER_ORIGIN||'').replace(/\/$/,'');
const expectedSha=process.env.WFM_EXPECTED_CANDIDATE_SHA;
const password=process.env.WFM_STAGING_PASSWORD;
assert.ok(targetBase.includes('.railway.internal'),'private target required');
assert.ok(browserOrigin.startsWith('https://'),'browser origin required');
assert.match(expectedSha||'',/^[0-9a-f]{40}$/,'candidate commit required');
assert.ok(password&&password.length>=20,'staging password required');
const target=new URL(targetBase);
const browserHost=new URL(browserOrigin).host;
const transport=target.protocol==='https:'?httpsRequest:httpRequest;

function request(path,{method='GET',headers={},body=null,timeoutMs=5000}={}){
  return new Promise((resolve,reject)=>{
    const payload=body==null?null:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const outHeaders={
      host:browserHost,
      'x-forwarded-host':browserHost,
      'x-forwarded-proto':'https',
      origin:browserOrigin,
      referer:`${browserOrigin}/`,
      'accept-encoding':'identity',
      ...headers,
    };
    if(payload){outHeaders['content-type']=outHeaders['content-type']||'application/json';outHeaders['content-length']=String(payload.length);}
    const req=transport({protocol:target.protocol,hostname:target.hostname,port:target.port||undefined,path,method,headers:outHeaders,timeout:timeoutMs},res=>{
      const chunks=[];
      res.on('data',c=>chunks.push(c));
      res.on('end',()=>{
        const text=Buffer.concat(chunks).toString('utf8');
        let json=null; try{json=text?JSON.parse(text):null;}catch{}
        resolve({status:res.statusCode||0,headers:res.headers,text,json});
      });
    });
    req.on('timeout',()=>req.destroy(new Error(`timeout ${method} ${path}`)));
    req.on('error',reject);
    if(payload)req.write(payload);
    req.end();
  });
}

function cookieHeader(setCookie){
  const values=Array.isArray(setCookie)?setCookie:(setCookie?[setCookie]:[]);
  return values.map(v=>String(v).split(';',1)[0]).filter(Boolean).join('; ');
}

const health=await request('/api/health',{timeoutMs:4000});
assert.equal(health.status,200,'health failed');
assert.equal(health.json?.release,'0.6.76-hosted-staging-rc1','release identity mismatch');
assert.equal(health.json?.fixtureOnly,true,'fixture boundary mismatch');
assert.equal(health.json?.productionApproved,false,'production boundary mismatch');
assert.equal((await request('/api/bootstrap',{timeoutMs:4000})).status,401,'unauth bootstrap must fail closed');
console.log('PRIVATE_API_BASELINE=PASS');

const specs=[
  ['manager','manager@northstar.example','manager','northstar-demo',403,'/api/time-review','isolation-test'],
  ['employee','maya@northstar.example','employee','northstar-demo',403,'/api/personal','isolation-test'],
  ['payroll','payroll@northstar.example','payroll_admin','northstar-demo',200,'/api/payroll-run','isolation-test'],
  ['company-admin','superuser@northstar.example','director','northstar-demo',200,'/api/onboarding','isolation-test'],
  ['isolation-manager','other@isolation.example','manager','isolation-test',403,'/api/bootstrap','northstar-demo'],
];

let passed=0;
for(const [slug,email,role,tenant,payrollExpected,requiredPath,forgedTenant] of specs){
  try{
    const login=await request('/api/login',{method:'POST',body:{email,password},timeoutMs:5000});
    assert.equal(login.status,200,`${slug} login`);
    const cookie=cookieHeader(login.headers['set-cookie']);
    assert.ok(cookie,`${slug} session cookie`);
    const authHeaders={cookie};
    const identity=await request('/api/bootstrap',{headers:authHeaders,timeoutMs:4000});
    assert.equal(identity.status,200,`${slug} bootstrap`);
    assert.equal(identity.json?.actor?.role,role,`${slug} role`);
    assert.equal(identity.json?.actor?.tenant,tenant,`${slug} tenant`);

    const forged=await request('/api/bootstrap',{headers:{...authHeaders,'x-tenant-id':forgedTenant},timeoutMs:4000});
    assert.equal(forged.status,200,`${slug} forged-tenant bootstrap`);
    assert.equal(forged.json?.actor?.tenant,tenant,`${slug} forged tenant accepted`);

    const started=Date.now();
    const payroll=await request('/api/payroll-run',{headers:authHeaders,timeoutMs:4000});
    const elapsed=Date.now()-started;
    assert.equal(payroll.status,payrollExpected,`${slug} payroll boundary`);
    assert.ok(elapsed<4000,`${slug} payroll boundary too slow`);

    const required=await request(requiredPath,{headers:authHeaders,timeoutMs:4000});
    assert.equal(required.status,200,`${slug} required surface ${requiredPath}`);
    passed++;
    console.log(`PRIVATE_API_ROLE_PASS=${slug}|role=${role}|tenant=${tenant}|payrollMs=${elapsed}`);
  }catch(error){
    console.error(`PRIVATE_API_ROLE_FAIL=${slug}|${error.message}`);
  }
}

assert.equal(passed,specs.length,`role API proof incomplete ${passed}/${specs.length}`);
console.log(`PRIVATE_API_MATRIX=PASS|roles=${passed}|sha=${expectedSha}`);
delete process.env.WFM_STAGING_PASSWORD;
