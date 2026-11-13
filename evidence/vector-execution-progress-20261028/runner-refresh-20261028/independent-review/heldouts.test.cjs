'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const launcher=require('../launcher.cjs');
const target='b'.repeat(40),url='https://vector-hardening-proof-production.up.railway.app/api/runtime-identity';
const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'../generated/bundle.json')));
function env(){return {RAILWAY_SERVICE_ID:'f84fe27d-af17-451c-b164-54dfef6b6a4b',RAILWAY_ENVIRONMENT_ID:'eed9f097-610a-416e-83b9-6bc7bdb3eeef',VECTOR_PROOF_URL:'https://vector-hardening-proof-production.up.railway.app/',WFM_EXPECTED_CANDIDATE_SHA:target,VECTOR_PROOF_AUTH_PROFILE:'signed',WFM_REQUIRE_VECTOR_ASSET_DIGESTS:'true',WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE:'true',VECTOR_PROOF_ACTORS_JSON:'SYNTHETIC_ACTORS',PROOF_PRIVATE_KEY_B64:'SYNTHETIC_SIGNER',EXPECTED_DEPLOYMENT_ID:'d',EXPECTED_IMPLEMENTATION_TENANT:'t',EXPECTED_IMPLEMENTATION_RUN_ID:'r',EXPECTED_CONFIGURATION_DIGEST:'c',VECTOR_CANONICAL_JS_SHA256:'j',VECTOR_CANONICAL_CSS_SHA256:'s',VECTOR_WORKFLOW_JS_SHA256:'w'};}
function identity(){return {candidateSha:target,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false};}
function response(body,headers={}){const r=new Response(body,{headers:{'content-type':'application/json',...headers}});Object.defineProperty(r,'url',{value:url});return r;}
test('exact byte budget succeeds; one extra byte rejects even with smaller declared length',async()=>{
 const text=JSON.stringify(identity()),fill=8192-Buffer.byteLength(text);let count=0;
 const value=await launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>{count++;return response(text+' '.repeat(fill));}});assert.equal(value.candidateSha,target);assert.equal(count,1);
 await assert.rejects(launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>response(text+' '.repeat(fill+1),{'content-length':'1'})}),/TOO_LARGE/);
});
test('UTF8 bytes count rather than Unicode character count',async()=>{
 const text=JSON.stringify({...identity(),padding:'é'.repeat(5000)});assert.ok(text.length<8192);assert.ok(Buffer.byteLength(text)>8192);
 await assert.rejects(launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>response(text)}),/TOO_LARGE/);
});
test('stream reader is cancelled after excess bytes and timeout; no partial result accepted',async()=>{
 for(const scenario of ['oversize','stall']){
  let canceled=false,calls=0;const r={status:200,redirected:false,url,headers:new Headers({'content-type':'application/json'}),body:{getReader(){return {read(){calls++;return scenario==='oversize'?Promise.resolve({done:false,value:new Uint8Array(8193)}):new Promise(()=>{});},cancel(){canceled=true;return Promise.resolve();}};}}};
  await assert.rejects(launcher.preflightRuntimeIdentity(env(),{timeoutMs:15,fetchImpl:async()=>r}),scenario==='oversize'?/TOO_LARGE/:/TIMEOUT/);assert.ok(canceled);assert.equal(calls,1);
 }
});
for(const alteration of [{productionApproved:'false'},{pilotReady:0},{fixtureOnly:1},{sourceBinding:'BUILD-FILE-MATCHED'},{candidateSha:target+' '}])test('strict preflight scalar '+JSON.stringify(alteration),async()=>{
 await assert.rejects(launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>response(JSON.stringify({...identity(),...alteration}))}));
});
test('run freezes configured authority across preflight and isolates installer environment',async()=>{
 const fakeEnv={...env(),PATH:'/original/path',HTTPS_PROXY:'http://synthetic-proxy',PROVIDER_API_TOKEN:'SYNTHETIC_PROVIDER',NODE_OPTIONS:'SYNTHETIC_NODE_OPTIONS'};
 const fakeProcess={env:fakeEnv,execPath:process.execPath,on(){},off(){},exitCode:undefined};let installed,childOptions,spawnCount=0;
 const mockChild={spawnSync(command,args,options){assert.equal(command,'npm');installed=options;return {status:0};},spawn(_command,_args,options){spawnCount++;childOptions=options;const e=new EventEmitter();e.kill=()=>{};process.nextTick(()=>e.emit('exit',0,null));return e;}};
 const module={exports:{}};const context={module,exports:module.exports,Buffer,URL,AbortController,Uint8Array,setTimeout,clearTimeout,console:{log(){}},process:fakeProcess,require(name){if(name==='node:child_process')return mockChild;if(name==='node:module')return {createRequire(){return name=>name==='playwright/package.json'?{version:'1.63.0'}:{chromium:{executablePath(){return '/bin/sh';}}};}};if(name==='node:sqlite')return {};return require(name);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../launcher.cjs'),'utf8'),context);
 await module.exports.run(bundle.payload,bundle.bundleHash,{fetchImpl:async(_url,options)=>{assert.equal(options.credentials,'omit');assert.deepEqual(Object.keys(options.headers),['Accept']);fakeEnv.WFM_EXPECTED_CANDIDATE_SHA='c'.repeat(40);fakeEnv.PROOF_PRIVATE_KEY_B64='MUTATED';fakeEnv.PATH='/mutated';return response(JSON.stringify(identity()));}});
 assert.equal(spawnCount,1);assert.equal(childOptions.env.WFM_EXPECTED_CANDIDATE_SHA,target);assert.equal(childOptions.env.PROOF_PRIVATE_KEY_B64,'SYNTHETIC_SIGNER');assert.ok(Object.isFrozen(childOptions.env));assert.equal(installed.env.PATH,'/original/path');
 for(const key of ['PROOF_PRIVATE_KEY_B64','PROVIDER_API_TOKEN','VECTOR_PROOF_ACTORS_JSON','WFM_EXPECTED_CANDIDATE_SHA','NODE_OPTIONS'])assert.equal(installed.env[key],undefined);
 assert.ok(Object.isFrozen(installed.env));assert.equal(fs.existsSync(childOptions.cwd),false);assert.equal(fakeProcess.exitCode,0);
});
