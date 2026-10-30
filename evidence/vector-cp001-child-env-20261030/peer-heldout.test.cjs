'use strict';
// Independent peer probes. Everything below uses disposable, fictional authority.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const candidate = path.resolve(process.env.CP001_PEER_CANDIDATE || process.cwd());
const base = path.resolve(process.env.CP001_PEER_BASE || path.join(candidate, '../base'));
const activation = 'docs/execution/proof-runner-activation';
const launchPath = path.join(candidate, activation, 'launcher.cjs');
const source = fs.readFileSync(launchPath, 'utf8');
const bundle = JSON.parse(fs.readFileSync(path.join(candidate, activation, 'generated/bundle.json')));
const launch = require(launchPath);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const transport = {
  PATH: '/fictional/bin', HOME: '/fictional/home', TMPDIR: '/fictional/tmp', TMP: '/fictional/tmp', TEMP: '/fictional/tmp',
  LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', LC_CTYPE: 'C.UTF-8', TZ: 'UTC',
  NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt', SSL_CERT_FILE: '/etc/ssl/certs/ca-certificates.crt',
  SSL_CERT_DIR: '/etc/ssl/certs', NODE_USE_ENV_PROXY: '1',
  HTTP_PROXY: 'http://fixture.invalid:8080', HTTPS_PROXY: 'http://fixture.invalid:8080', ALL_PROXY: 'http://fixture.invalid:8080', NO_PROXY: 'localhost',
  http_proxy: 'http://lower.invalid:8080', https_proxy: 'http://lower.invalid:8080', all_proxy: 'http://lower.invalid:8080', no_proxy: '127.0.0.1'
};
const signed = {
  PORT: '39999', PLAYWRIGHT_BROWSERS_PATH: '/fictional/browsers',
  VECTOR_PROOF_URL: 'https://vector-hardening-proof-production.up.railway.app/',
  WFM_EXPECTED_CANDIDATE_SHA: '1'.repeat(40), VECTOR_PROOF_AUTH_PROFILE: 'signed',
  VECTOR_PROOF_ACTORS_JSON: 'FICTIONAL_ACTORS', PROOF_PRIVATE_KEY_B64: 'FICTIONAL_PRIVATE_SIGNER_SENTINEL',
  EXPECTED_DEPLOYMENT_ID: 'fixture-deployment', EXPECTED_IMPLEMENTATION_TENANT: 'fixture-tenant', EXPECTED_IMPLEMENTATION_RUN_ID: 'fixture-run',
  EXPECTED_CONFIGURATION_DIGEST: '2'.repeat(64), WFM_REQUIRE_VECTOR_ASSET_DIGESTS: 'true', WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE: 'true',
  VECTOR_CANONICAL_JS_SHA256: '3'.repeat(64), VECTOR_CANONICAL_CSS_SHA256: '4'.repeat(64), VECTOR_WORKFLOW_JS_SHA256: '5'.repeat(64)
};
function envFixture() {
  const env = { ...transport, ...signed, RAILWAY_SERVICE_ID: 'f84fe27d-af17-451c-b164-54dfef6b6a4b', RAILWAY_ENVIRONMENT_ID: 'eed9f097-610a-416e-83b9-6bc7bdb3eeef' };
  const roots = ['STAFFOLOGY_API_KEY','CANDIDATE_STAFFOLOGY_KEY','OPENAI_API_KEY','WFM_IMPLEMENTATION_INTERNAL_TOKEN','WFM_IMPLEMENTATION_WORKER_TOKEN','WFM_STAGING_PASSWORD','WRAPPED_PASSKEY_CREDENTIALS','RAILWAY_TOKEN','AWS_SESSION_TOKEN','AZURE_CLIENT_SECRET','GOOGLE_APPLICATION_CREDENTIALS','UNKNOWN_FUTURE_SECRET','NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_LIBRARY_PATH','DYLD_INSERT_LIBRARIES','BROWSER_PROOF_SCRIPT','BROWSER_ROLE_PROOF_SCRIPT','npm_config_node_options'];
  for (const key of roots) {
    for (const variant of [key,key.toLowerCase(),key[0]+key.slice(1).toLowerCase(),key+' ',key+'\n',key+'=x',key+'\0suffix',' '+key,'_'+key])
      env[variant] = 'FICTIONAL_FORBIDDEN_SENTINEL';
  }
  for (const key of Object.keys(signed)) {
    for (const variant of [key.toLowerCase(), key + ' ', key + '\0suffix', key + '=x']) env[variant] = 'FICTIONAL_FORBIDDEN_SENTINEL';
  }
  Object.defineProperty(env, '__proto__', {value:'FICTIONAL_FORBIDDEN_SENTINEL', enumerable:true});
  env.constructor = 'FICTIONAL_FORBIDDEN_SENTINEL'; env.toString = 'FICTIONAL_FORBIDDEN_SENTINEL';
  return env;
}
function identityResponse(url, candidateSha = signed.WFM_EXPECTED_CANDIDATE_SHA) {
  const r = new Response(JSON.stringify({candidateSha, sourceBinding:'build-file-matched', fixtureOnly:true, productionApproved:false, pilotReady:false}), {headers:{'content-type':'application/json'}});
  Object.defineProperty(r, 'url', {value:url}); return r;
}
async function observe({env=envFixture(), fetchImpl, installerStatus=0, childStatus=0, holdChildMs=0}={}) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cp001-peer-'));
  const calls = [], logs = [], effects = [], handlers = new Map();
  const processFixture = {env, execPath:process.execPath, exitCode:0,
    on:(name,handler)=>handlers.set(name,handler), off:(name,handler)=>{assert.equal(handlers.get(name),handler);handlers.delete(name);}};
  let installerCaptured, childCaptured;
  const load = id => {
    if (id === 'node:child_process') return {
      spawnSync(command,args,options) {
        calls.push({kind:'installer',command,args,options});
        const capture = path.join(sandbox,'installer.json');
        const result = cp.spawnSync(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.env));process.exit(${installerStatus})`],{...options,stdio:'pipe',encoding:'utf8'});
        installerCaptured=JSON.parse(fs.readFileSync(capture));
        effects.push(String(result.stdout||''),String(result.stderr||'')); return result;
      },
      spawn(command,args,options) {
        calls.push({kind:'proof',command,args,options});
        const capture = path.join(sandbox,'child.json');
        const child = cp.spawn(process.execPath,['-e',`require('node:fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify(process.env));setTimeout(()=>process.exit(${childStatus}),${holdChildMs})`],{...options,stdio:'pipe'});
        child.stdout.on('data',b=>effects.push(b.toString())); child.stderr.on('data',b=>effects.push(b.toString()));
        child.once('exit',()=>{childCaptured=JSON.parse(fs.readFileSync(capture));}); return child;
      }
    };
    if (id === 'node:module') return {createRequire:()=>request=> request==='playwright/package.json'?{version:'1.63.0'}:request==='playwright'?{chromium:{executablePath:()=>process.execPath}}:assert.fail('Unexpected module: '+request)};
    if (id === 'node:sqlite') return {};
    return require(id);
  };
  const mod = {exports:{}};
  vm.runInNewContext(source,{require:load,module:mod,exports:mod.exports,process:processFixture,Buffer,URL,Uint8Array,AbortController,setTimeout,clearTimeout,console:{log:s=>logs.push(String(s))}},{filename:launchPath});
  let error;
  try { await mod.exports.run(bundle.payload,bundle.bundleHash,{fetchImpl:fetchImpl|| (async(url,options)=>{
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(Object.keys(options.headers),['Accept']);
    assert.doesNotMatch(JSON.stringify(options),/FICTIONAL_|PROOF_PRIVATE_KEY|TOKEN/); return identityResponse(url);
  })}); } catch(e) {error=e;}
  finally {fs.rmSync(sandbox,{recursive:true,force:true});}
  for(const call of calls) assert.equal(fs.existsSync(call.options.cwd),false,'materialized files removed');
  assert.equal(handlers.size,0,'signal handlers removed');
  return {calls,logs,effects,error,installerCaptured,childCaptured,exitCode:processFixture.exitCode};
}
test('OS boundaries exclude 247 unapproved keys including malformed/cased/provider/worker/preload/eval names while retaining 37 exact allowed values',async()=>{
  const r=await observe(); assert.ifError(r.error); assert.equal(r.calls.length,2);
  assert.deepEqual(r.childCaptured,{...transport,...signed});
  const installerKeys=Object.keys(r.installerCaptured).filter(k=>k!=='npm_config_cache').sort();
  assert.deepEqual(installerKeys,Object.keys(transport).sort());
  for(const [key,value]of Object.entries(transport))assert.equal(r.installerCaptured[key],value);
  assert.match(r.installerCaptured.npm_config_cache,/vector-browser-proof-[^/]+\/npm-cache$/);
  assert.doesNotMatch(JSON.stringify({logs:r.logs,effects:r.effects}),/FICTIONAL_(?:PRIVATE|FORBIDDEN|ACTORS)/);
});
test('preload and obsolete eval expressions cannot execute in actual proof child',async()=>{
  const e=envFixture(), marker=path.join(os.tmpdir(),'cp001-never-execute-'+crypto.randomUUID());
  const injection=`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`;
  e.BROWSER_PROOF_SCRIPT=injection;e.BROWSER_ROLE_PROOF_SCRIPT=injection;e.NODE_OPTIONS='--eval='+injection;
  const r=await observe({env:e});assert.ifError(r.error);assert.equal(r.exitCode,0);assert.equal(fs.existsSync(marker),false);
  for(const k of ['BROWSER_PROOF_SCRIPT','BROWSER_ROLE_PROOF_SCRIPT','NODE_OPTIONS'])assert.equal(r.childCaptured[k],undefined);
});
test('async preflight mutations cannot replace signer/target or inject later authority',async()=>{
  const e=envFixture();
  const r=await observe({env:e,fetchImpl:async url=>{
    e.PROOF_PRIVATE_KEY_B64='LATE_SIGNER';e.WFM_EXPECTED_CANDIDATE_SHA='9'.repeat(40);e.NODE_OPTIONS='--invalid-option';e.NEW_INTERNAL_SECRET='LATE_SECRET';
    return identityResponse(url);
  }});
  assert.ifError(r.error); assert.deepEqual(r.childCaptured,{...transport,...signed});
});
test('preflight errors stop both actual process boundaries and redact private fetch details',async()=>{
  for(const outcome of ['throw','stale','wrong-scope','too-large']) {
    const r=await observe({fetchImpl:async url=>{
      if(outcome==='throw')throw Error('FICTIONAL_PRIVATE_SIGNER_SENTINEL FICTIONAL_FORBIDDEN_SENTINEL');
      if(outcome==='stale')return identityResponse(url,'9'.repeat(40));
      if(outcome==='wrong-scope'){const v=identityResponse(url);v.json=()=>({});const x=new Response(JSON.stringify({candidateSha:signed.WFM_EXPECTED_CANDIDATE_SHA,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:true,pilotReady:false}),{headers:{'content-type':'application/json'}});Object.defineProperty(x,'url',{value:url});return x;}
      const x=new Response('x'.repeat(8193),{headers:{'content-type':'application/json'}});Object.defineProperty(x,'url',{value:url});return x;
    }});
    assert.ok(r.error,outcome);assert.equal(r.calls.length,0);assert.doesNotMatch(String(r.error)+JSON.stringify(r.logs),/FICTIONAL_(?:PRIVATE|FORBIDDEN)/);
  }
});
test('actual installer failure is fail-closed and has no proof or provider authority',async()=>{
  const r=await observe({installerStatus:19});assert.match(String(r.error),/PLAYWRIGHT_INSTALL_FAILED/);assert.equal(r.calls.length,1);
  assert.doesNotMatch(JSON.stringify(r.installerCaptured),/FICTIONAL_(?:PRIVATE|FORBIDDEN|ACTORS)/);
});
test('actual child nonzero exit and handler cleanup survive explicit env',async()=>{
  const r=await observe({childStatus:23});assert.ifError(r.error);assert.equal(r.exitCode,23);
});
test('non-string and inherited unknown inputs cannot enter snapshot or output',()=>{
  const e=Object.create({INHERITED_SECRET:'NO',NODE_OPTIONS:'--bad'});Object.assign(e,envFixture());
  for(const value of [undefined,null,0,{},[],false]) {e.PORT=value;const result=launch.proofChildEnvironment(e);assert.equal(result.PORT,undefined);assert.ok(Object.isFrozen(result));assert.equal(result.INHERITED_SECRET,undefined);}
});
test('allowlist cost is bounded independently of unrecognized environment size',()=>{
  const huge=envFixture();for(let i=0;i<50000;i++)huge['UNRECOGNIZED_TOKEN_'+i]='FICTIONAL_FORBIDDEN_SENTINEL';
  let ownKeysCalled=0;const proxy=new Proxy(huge,{ownKeys(){ownKeysCalled++;throw Error('enumeration forbidden');}});
  const start=performance.now();for(let i=0;i<25000;i++)launch.proofChildEnvironment(proxy);const ms=performance.now()-start;
  assert.equal(ownKeysCalled,0);assert.ok(ms<5000,'25k projections must stay under generous 5-second CPU bound');
  console.log('PEER_PERFORMANCE='+JSON.stringify({projections:25000,unknownKeys:50000,elapsedMs:Math.round(ms)}));
});
test('signed browser client can validate projected genuine ephemeral Ed25519 signer and actor scope',()=>{
  const privateKey=crypto.generateKeyPairSync('ed25519').privateKey;
  const e={...envFixture(),PROOF_PRIVATE_KEY_B64:Buffer.from(privateKey.export({format:'pem',type:'pkcs8'})).toString('base64'),VECTOR_PROOF_ACTORS_JSON:JSON.stringify([
    {slug:'manager',role:'manager',email:'manager@fixture.invalid',tenant:signed.EXPECTED_IMPLEMENTATION_TENANT},
    {slug:'employee',role:'employee',email:'employee@fixture.invalid',tenant:signed.EXPECTED_IMPLEMENTATION_TENANT},
    {slug:'payroll',role:'payroll_admin',email:'payroll@fixture.invalid',tenant:signed.EXPECTED_IMPLEMENTATION_TENANT},
    {slug:'company-admin',role:'director',email:'admin@fixture.invalid',tenant:signed.EXPECTED_IMPLEMENTATION_TENANT},
    {slug:'isolation-manager',role:'manager',email:'other@fixture.invalid',tenant:'other-fixture-tenant'}
  ])};
  const raw=fs.readFileSync(path.join(candidate,'scripts/current-candidate-role-browser-proof.mjs'),'utf8');
  const helper=raw.slice(raw.indexOf('export function createProofClient'),raw.indexOf('// VECTOR_PROOF_CLIENT_RUNNER_START')).replace('export function','function');
  const mod=vm.runInNewContext(helper+';createProofClient',{assert,crypto,URL,Buffer,proofRunnerAuth:require(path.join(candidate,'security/runtime/proof-runner-auth.cjs'))});
  const client=mod(launch.proofChildEnvironment(e));assert.equal(client.mode,'signed');assert.equal(client.actors.length,5);assert.equal(client.expectedSha,signed.WFM_EXPECTED_CANDIDATE_SHA);assert.equal(client.origin,new URL(signed.VECTOR_PROOF_URL).origin);
});
test('exact pinned source bytes, bundle payload, manifest hashes and embedded command are intact',()=>{
  const raw=fs.readFileSync(path.join(candidate,activation,'generated/bundle.json'));
  assert.deepEqual(raw,fs.readFileSync(path.join(base,activation,'generated/bundle.json')));
  assert.equal(bundle.bundleHash,'da77ee240dc635f19b29a2d771ff52a856ad98e9ccbe06436e96ac4a63201687');
  assert.equal(sha(Buffer.from(bundle.payload,'base64')),bundle.bundleHash);
  const unpack=JSON.parse(zlib.gunzipSync(Buffer.from(bundle.payload,'base64')));assert.equal(unpack.source,'ca05f1017c1e10f9b164c58a044d2cd4159d4ea3');
  assert.equal(unpack.files.length,4);
  for(const f of unpack.files) {
    assert.equal(sha(Buffer.from(f.base64,'base64')),launch.FILES[f.path]);
    assert.deepEqual(Buffer.from(f.base64,'base64'),fs.readFileSync(path.join(candidate,f.path)));
    assert.deepEqual(fs.readFileSync(path.join(candidate,f.path)),fs.readFileSync(path.join(base,f.path)));
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(candidate,activation,'generated/manifest.json')));
  const cmd=fs.readFileSync(path.join(candidate,activation,'generated/start-command.txt'));
  assert.equal(sha(cmd),manifest.startCommandSha256);assert.equal(cmd.length-1,manifest.startCommandBytes);
  const script=source+'\nmodule.exports.run('+JSON.stringify(bundle.payload)+','+JSON.stringify(bundle.bundleHash)+').catch(error=>{console.error("VECTOR_PROOF_RUNNER_START_FAILED="+error.message);process.exitCode=1;});\n';
  const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
  assert.equal(cmd.toString(),'node -e '+quote(script)+'\n');
  assert.deepEqual(manifest.files,launch.FILES);
});
