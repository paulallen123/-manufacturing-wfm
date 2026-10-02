'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'bootstrap.cjs'), 'utf8');

test('exact bootstrap enables the signed proof runner only through explicit staging configuration', () => {
  assert.match(source, /createProofRunnerAuth/);
  assert.match(source, /WFM_PROOF_RUNNER_AUTH === 'enabled'/);
  assert.match(source, /hosted && proofRunnerEnabled && !process\.env\.WFM_STAGING_PASSWORD/);
});

test('identity guard executes before the proof runner session exchange', () => {
  const guardIndex = source.indexOf('guard.beforeRequest(req, res)');
  const proofIndex = source.indexOf('proofRunnerAuth.handleRequest(req, res)');
  assert.ok(guardIndex >= 0, 'identity guard route is missing');
  assert.ok(proofIndex > guardIndex, 'proof runner must execute after injected-identity rejection');
});

// Execute exact source snippets with controlled module transport. This is not a
// complete bootstrap/server/HTTPS run and never reads deployment configuration.
function employeeBootstrapOwner() {
  const zlib=require('node:zlib'),os=require('node:os'),tar=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../../artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'))),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-onboarding-'));let server;
  for(let off=0;off+512<=tar.length;){const h=tar.subarray(off,off+512);if(h.every(x=>x===0))break;const str=(a,b)=>h.subarray(a,b).toString().split('\0')[0],name=(str(345,500)?str(345,500)+'/':'')+str(0,100),size=parseInt(str(124,136).trim()||'0',8),b=tar.subarray(off+512,off+512+size);if(name==='server.cjs')server=b.toString();if(['public/onboarding-engine.js','public/engine.js','public/cost-engine.js','public/work-rules.js'].includes(name)){const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}off+=512+Math.ceil(size/512)*512;}return{dir,server,ON:require(path.join(dir,'public/onboarding-engine.js'))};
}
test('EMPLOYEE bootstrap injects unchanged assembled onboarding owner callback into the canonical constructor',t=>{
  const vm=require('node:vm'),owner=employeeBootstrapOwner();t.after(()=>fs.rmSync(owner.dir,{recursive:true,force:true}));const start=source.indexOf('  if (hosted && !passkeyAuth) {'),end=source.indexOf('\n  }',start)+4;assert.ok(start>=0);let captured;
  vm.runInNewContext(source.slice(start,end),{hosted:true,passkeyAuth:null,process:{env:{WFM_DB:'synthetic-fixture.sqlite'}},createPasskeyAuth:o=>{captured=o;return{};},require:p=>{assert.equal(p,'/app/public/onboarding-engine.js');return owner.ON;}});assert.equal(captured.onboardingMarkVerified,owner.ON.markVerified);assert.equal(captured.dbPath,'synthetic-fixture.sqlite');
});
function employeeHostedIntercept(passkeys,listener) {
  const vm=require('node:vm'),start=source.indexOf("    if (passkeyAuth && requestPath(req) === '/api/login')"),end=source.indexOf('    if (await ownerAccessRecovery.handleRequest',start);assert.ok(start>=0&&end>start);return vm.runInNewContext('(async function(req,res){'+source.slice(start,end)+'return listener(req,res);})',{passkeyAuth:passkeys,requestPath:req=>req.url.split('?')[0],listener});
}
test('EMPLOYEE hosted password acceptance is refused before listener/body mutation and tokens are not reflected',async()=>{
  let reads=0,mutations=0;const run=employeeHostedIntercept({},async()=>{mutations++;}),req={url:'/api/onboarding/accept',method:'POST',get body(){reads++;throw Error('Must not read hosted password payload');}},res={setHeader(){},end(raw){this.body=JSON.parse(raw);}};await run(req,res);assert.equal(res.statusCode,410);assert.equal(reads,0);assert.equal(mutations,0);assert.equal(res.body.signInPath,'/');assert.ok(!JSON.stringify(res.body).includes('token'));
});
test('EMPLOYEE existing unhosted password fixture still crosses actual packed loopback guard only',async t=>{
  const vm=require('node:vm'),owner=employeeBootstrapOwner();t.after(()=>fs.rmSync(owner.dir,{recursive:true,force:true}));const begin=owner.server.indexOf('const host=req.headers.host'),end=owner.server.indexOf("if(url.pathname==='/api/health')",begin);assert.ok(begin>=0&&end>begin);const guard=vm.runInNewContext('(function(req){'+owner.server.slice(begin,end)+'return true;})',{HOSTED_STAGING:false,E:{assert:(ok,message,status)=>{if(!ok){const e=Error(message);e.status=status;throw e;}}},URL});
  const req={url:'/api/onboarding/accept',method:'POST',headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000','content-type':'application/json'}};assert.equal(guard(req),true);assert.throws(()=>guard({...req,headers:{...req.headers,host:'remote.invalid'}}));assert.throws(()=>guard({...req,headers:{...req.headers,origin:'https://attacker.test'}}));let calls=0;await employeeHostedIntercept(null,async()=>{guard(req);calls++;})(req,{setHeader(){},end(){}});assert.equal(calls,1);
});
