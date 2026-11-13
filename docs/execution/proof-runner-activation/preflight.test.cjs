'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const launcher=require('./launcher.cjs');
const bundle=JSON.parse(fs.readFileSync(path.join(__dirname,'generated/bundle.json')));
const URL='https://vector-hardening-proof-production.up.railway.app/api/runtime-identity';
const target='a'.repeat(40);
function env(){return {RAILWAY_SERVICE_ID:'f84fe27d-af17-451c-b164-54dfef6b6a4b',RAILWAY_ENVIRONMENT_ID:'eed9f097-610a-416e-83b9-6bc7bdb3eeef',VECTOR_PROOF_URL:'https://vector-hardening-proof-production.up.railway.app/',WFM_EXPECTED_CANDIDATE_SHA:target,VECTOR_PROOF_AUTH_PROFILE:'signed',WFM_REQUIRE_VECTOR_ASSET_DIGESTS:'true',WFM_REQUIRE_ACTION_AFFORDANCE_COVERAGE:'true',VECTOR_PROOF_ACTORS_JSON:'SYNTHETIC_ONLY',PROOF_PRIVATE_KEY_B64:'DO_NOT_LOG_SYNTHETIC_SENTINEL',EXPECTED_DEPLOYMENT_ID:'SYNTHETIC',EXPECTED_IMPLEMENTATION_TENANT:'SYNTHETIC',EXPECTED_IMPLEMENTATION_RUN_ID:'SYNTHETIC',EXPECTED_CONFIGURATION_DIGEST:'SYNTHETIC',VECTOR_CANONICAL_JS_SHA256:'SYNTHETIC',VECTOR_CANONICAL_CSS_SHA256:'SYNTHETIC',VECTOR_WORKFLOW_JS_SHA256:'SYNTHETIC'};}
function identity(extra={}){return {candidateSha:target,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false,...extra};}
function response(body=identity(),{status=200,contentType='application/json',url=URL,redirected=false,headers={}}={}){const r=new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers:{'content-type':contentType,...headers}});Object.defineProperty(r,'url',{value:url});Object.defineProperty(r,'redirected',{value:redirected});return r;}
test('runner source and explicit reviewed target are separate; request is bounded and unauthenticated',async()=>{
 assert.notEqual(target,launcher.SOURCE);let called=0;
 const result=await launcher.preflightRuntimeIdentity(env(),{fetchImpl:async(url,options)=>{called++;assert.equal(url,URL);assert.deepEqual(Object.keys(options.headers),['Accept']);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');assert.ok(options.signal instanceof AbortSignal);assert.doesNotMatch(JSON.stringify(options),/DO_NOT_LOG|SYNTHETIC/);return response();}});
 assert.equal(called,1);assert.equal(result.candidateSha,target);assert.equal(Object.isFrozen(result),true);
});
const failures=[
 ['stale target',()=>response(identity({candidateSha:launcher.SOURCE})),/TARGET_MISMATCH/],
 ['missing SHA',()=>response(identity({candidateSha:undefined})),/TARGET_MISMATCH/],
 ['configured-only',()=>response(identity({sourceBinding:'configured-only'})),/SOURCE_UNBOUND/],
 ['fixture false',()=>response(identity({fixtureOnly:false})),/SCOPE_MISMATCH/],
 ['fixture string',()=>response(identity({fixtureOnly:'true'})),/SCOPE_MISMATCH/],
 ['production true',()=>response(identity({productionApproved:true})),/SCOPE_MISMATCH/],
 ['pilot true',()=>response(identity({pilotReady:true})),/SCOPE_MISMATCH/],
 ['missing pilot',()=>response(identity({pilotReady:undefined})),/SCOPE_MISMATCH/],
 ['redirect status',()=>response('',{status:302}),/RESPONSE_REJECTED/],
 ['redirected response',()=>response(identity(),{redirected:true}),/RESPONSE_REJECTED/],
 ['different final URL',()=>response(identity(),{url:'https://other.example/'}),/RESPONSE_REJECTED/],
 ['server error',()=>response('',{status:503}),/RESPONSE_REJECTED/],
 ['html',()=>response('<html>',{contentType:'text/html'}),/CONTENT_TYPE_REJECTED/],
 ['malformed JSON',()=>response('{'),/INVALID_JSON/],
 ['null JSON',()=>response('null'),/INVALID_JSON/],
 ['array JSON',()=>response('[]'),/INVALID_JSON/],
 ['oversized body',()=>response('x'.repeat(8193)),/TOO_LARGE/],
 ['oversized declared length',()=>response(identity(),{headers:{'content-length':'9000'}}),/TOO_LARGE/],
 ['invalid declared length',()=>response(identity(),{headers:{'content-length':'-1'}}),/TOO_LARGE/],
 ['body stream failure',()=>{const r=new Response(new ReadableStream({start(c){c.error(Error('private upstream details'));}}),{headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:URL});return r;},/BODY_FAILED/],
 ['network failure',()=>{throw Error('untrusted private network detail');},/FETCH_FAILED/]
];
for(const [name,make,error] of failures)test('preflight fails closed: '+name,async()=>assert.rejects(launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>make()}),error));
test('fetch and streaming-body stalls hit deadline even when transport ignores abort',async()=>{
 let signal;const start=Date.now();await assert.rejects(launcher.preflightRuntimeIdentity(env(),{timeoutMs:20,fetchImpl:(_u,o)=>{signal=o.signal;return new Promise(()=>{});}}),/TIMEOUT/);assert.equal(signal.aborted,true);assert.ok(Date.now()-start<1000);
 const stalled=new ReadableStream({start(){}});const r=new Response(stalled,{headers:{'content-type':'application/json'}});Object.defineProperty(r,'url',{value:URL});await assert.rejects(launcher.preflightRuntimeIdentity(env(),{timeoutMs:20,fetchImpl:async()=>r}),/TIMEOUT/);
});
test('stream size counts actual bytes despite misleading content-length',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(5000));c.enqueue(new Uint8Array(4000));c.close();}});const r=new Response(stream,{headers:{'content-type':'application/json','content-length':'1'}});Object.defineProperty(r,'url',{value:URL});await assert.rejects(launcher.preflightRuntimeIdentity(env(),{fetchImpl:async()=>r}),/TOO_LARGE/);
});
test('locally rebound launcher fails before materialization/install/signing for every invalid identity',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'runner-preflight-')),tmp=path.join(root,'tmp'),bin=path.join(root,'bin');fs.mkdirSync(tmp);fs.mkdirSync(bin);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const marker=path.join(root,'INSTALL_OR_CHILD_WAS_CALLED');fs.writeFileSync(path.join(bin,'npm'),'#!/bin/sh\nprintf invoked > '+JSON.stringify(marker)+'\nexit 1\n',{mode:0o700});
 const original={...process.env};Object.assign(process.env,env(),{TMPDIR:tmp,PATH:bin});t.after(()=>{for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,original);});
 const fixture=require('./published-source.test-fixture.cjs')(),m={exports:{}};
 require('node:vm').runInNewContext(fixture.source,{require,module:m,exports:m.exports,process,Buffer,URL:global.URL,Uint8Array,AbortController,setTimeout,clearTimeout,console});
 for(const [,make,error]of failures){await assert.rejects(m.exports.run(fixture.bundle.payload,fixture.bundle.bundleHash,{fetchImpl:async()=>make()}),error);assert.deepEqual(fs.readdirSync(tmp),[]);assert.equal(fs.existsSync(marker),false);}
 await assert.rejects(m.exports.run(fixture.bundle.payload,fixture.bundle.bundleHash,{fetchImpl:()=>new Promise(()=>{}),timeoutMs:20}),/TIMEOUT/);assert.deepEqual(fs.readdirSync(tmp),[]);assert.equal(fs.existsSync(marker),false);
});
test('actual synthetic HTTP identity response uses no authorization and passes required fields',async t=>{
 let received;const server=http.createServer((req,res)=>{received={method:req.method,url:req.url,headers:req.headers};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(identity()));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const local=`http://127.0.0.1:${server.address().port}/api/runtime-identity`;
 const result=await launcher.preflightRuntimeIdentity(env(),{fetchImpl:async(_url,options)=>{const r=await fetch(local,options);Object.defineProperty(r,'url',{value:URL});return r;}});assert.equal(result.candidateSha,target);assert.equal(received.url,'/api/runtime-identity');assert.equal(received.method,'GET');assert.equal(received.headers.authorization,undefined);assert.equal(received.headers.cookie,undefined);
});
