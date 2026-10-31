import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRuntimeArtifactManifest,requiredArtifacts} from './runtime-artifact-manifest.mjs';

const source='a'.repeat(40),runtimeId='sha256:'+'b'.repeat(64),clientId='sha256:'+'c'.repeat(64);
const clientNode='v24.22.1';
const secret='PRIVATE_FIXTURE_NEVER_COPY_TO_MANIFEST';
const script=fileURLToPath(new URL('./runtime-artifact-manifest.mjs',import.meta.url));
const identity=()=>({candidateSha:source,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false,privateValue:secret});
const smoke=()=>({scope:'PACKAGING_MODULE_SMOKE_ONLY',checkoutSourceSha:source,node:clientNode,sqliteAvailable:true,signedSessionExecuted:false,chromiumExecuted:false,hostedProof:false});
function fixture(t){
 const root=mkdtempSync(path.join(tmpdir(),'runtime-artifact-fixture-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const put=(relative,value)=>{const target=path.join(root,relative);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,typeof value==='string'?value:JSON.stringify(value));};
 for(const name of requiredArtifacts)put(name,secret+'\n');
 for(const name of ['source-sha.txt','auth-client-source-sha.txt','staffology/source-sha.txt'])put(name,source+'\n');
 put('image-inspect.json',[{Id:runtimeId,Config:{Env:[secret]},RepoDigests:[secret]}]);
 put('runtime-container-image-id.txt',runtimeId+'\n');
 put('auth-client-image-inspect.json',[{Id:clientId,Config:{Env:[secret]}}]);
 put('auth-client-image-node-version.txt',clientNode+'\n');
 put('runtime-identity.json',identity());
 put('runtime-identity.headers',`HTTP/1.1 200 OK\r\nX-WFM-Source-Sha: ${source}\r\nX-WFM-Source-Binding: build-file-matched\r\n\r\n`);
 put('auth-client-module-smoke.log','node warning\n'+JSON.stringify(smoke())+'\n');
 put('hosted-http-diagnostics.log',['health-ready','runtime-identity-build-file-matched','root-page','bootstrap-unauthenticated-401','demand-unauthenticated-401'].map(check=>'HOSTED_HTTP_ASSERTION=PASS check='+check).join('\n')+'\nVECTOR_APPLICATION_UID=PASS real=1000 effective=1000 saved=1000 filesystem=1000\n');
 return {root,put,manifest:()=>createRuntimeArtifactManifest(root,source)};
}

test('manifest binds exact source, container image and fixed artifact hashes without private values',t=>{
 const f=fixture(t);f.put('unlisted-private.json',{secret});const result=f.manifest();
 assert.equal(result.sourceSha,source);assert.equal(result.runtimeImageId,runtimeId);assert.equal(result.authClientImageId,clientId);
 assert.equal(result.authClientNodeVersion,clientNode);
 assert.deepEqual(result.artifacts.map(x=>x.path),requiredArtifacts);
 for(const record of result.artifacts){const b=readFileSync(path.join(f.root,record.path));assert.equal(record.bytes,b.length);assert.equal(record.sha256,createHash('sha256').update(b).digest('hex'));}
 assert.equal(result.signed,false);assert.equal(result.registryDigestAttested,false);assert.equal(result.testCountsVerified,false);assert.equal(result.providerAuthority,false);assert.equal(result.hostedCustomerProof,false);
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(result).includes(f.root),false);
});
test('invalid source SHA refuses',t=>{const f=fixture(t);for(const bad of ['',undefined,'a'.repeat(39),'A'.repeat(40)])assert.throws(()=>createRuntimeArtifactManifest(f.root,bad),/INVALID_SOURCE_SHA/);});
test('each required missing artifact refuses',t=>{for(const name of requiredArtifacts){const f=fixture(t);rmSync(path.join(f.root,name));assert.throws(f.manifest,/UNREADABLE_ARTIFACT/);}});
test('each required empty artifact refuses',t=>{for(const name of requiredArtifacts){const f=fixture(t);f.put(name,'');assert.throws(f.manifest,/EMPTY_ARTIFACT/);}});
test('malformed or missing image identities refuse',t=>{for(const name of ['image-inspect.json','auth-client-image-inspect.json'])for(const value of [{Id:runtimeId},[],[{}],[{Id:'tag:latest'}]]){const f=fixture(t);f.put(name,value);assert.throws(f.manifest,/INVALID_IMAGE_ID/);}});
test('running container must bind to the inspected runtime image',t=>{const f=fixture(t);f.put('runtime-container-image-id.txt',clientId);assert.throws(f.manifest,/CONTAINER_IMAGE_MISMATCH/);});
test('all exported source bindings must match',t=>{for(const name of ['source-sha.txt','auth-client-source-sha.txt','staffology/source-sha.txt']){const f=fixture(t);f.put(name,'d'.repeat(40));assert.throws(f.manifest,/SOURCE_MISMATCH/);}});
test('runtime identity must remain exact and fixture-only',t=>{for(const delta of [{candidateSha:'d'.repeat(40)},{sourceBinding:'environment'},{fixtureOnly:false},{productionApproved:true},{pilotReady:true}]){const f=fixture(t);f.put('runtime-identity.json',{...identity(),...delta});assert.throws(f.manifest,/RUNTIME_IDENTITY_MISMATCH/);}});
test('missing, duplicate or substituted identity headers refuse',t=>{for(const headers of ['',`X-WFM-Source-Sha: ${source}\nX-WFM-Source-Sha: ${source}\nX-WFM-Source-Binding: build-file-matched\n`,`X-WFM-Source-Sha: ${source}\nX-WFM-Source-Binding: environment\n`]){const f=fixture(t);f.put('runtime-identity.headers',headers||'HTTP/1.1 200 OK\n');assert.throws(f.manifest,/IDENTITY_HEADER_MISMATCH/);}});
test('Node24 client versions bind captured image output to module smoke',t=>{
 for(const node of ['v24.0.0','v24.22.1','v24.99.123']){const f=fixture(t);f.put('auth-client-image-node-version.txt',node+'\n');f.put('auth-client-module-smoke.log',JSON.stringify({...smoke(),node}));assert.equal(f.manifest().authClientNodeVersion,node);}
});
test('non-Node24, malformed and multiline client versions refuse',t=>{
 for(const node of ['v22.23.2','v23.11.0','v25.0.0','24.22.1','v24.22','v24.22.1-extra','v24.022.1','v24.22.1\nv24.22.1']){const f=fixture(t);f.put('auth-client-image-node-version.txt',node);f.put('auth-client-module-smoke.log',JSON.stringify({...smoke(),node}));assert.throws(f.manifest,/CLIENT_NODE_MISMATCH/);}
});
test('proof-client smoke must report the exact captured image Node version',t=>{
 for(const node of [undefined,null,24,'v24.22.0','v22.23.2','v24.22.1-extra']){const f=fixture(t);f.put('auth-client-module-smoke.log',JSON.stringify({...smoke(),node}));assert.throws(f.manifest,/CLIENT_NODE_MISMATCH/);}
});
test('proof-client packaging source/scope must match',t=>{
 for(const delta of [{checkoutSourceSha:'d'.repeat(40)},{sqliteAvailable:false},{signedSessionExecuted:true},{chromiumExecuted:true},{hostedProof:true}]){const f=fixture(t);f.put('auth-client-module-smoke.log',JSON.stringify({...smoke(),...delta}));assert.throws(f.manifest,/CLIENT_SMOKE_MISMATCH/);}
});
test('missing HTTP and nonroot receipts refuse',t=>{
 const f=fixture(t);f.put('hosted-http-diagnostics.log','VECTOR_APPLICATION_UID=PASS real=1000 effective=1000 saved=1000 filesystem=1000\n');assert.throws(f.manifest,/HTTP_RECEIPT_MISSING/);
 const g=fixture(t);g.put('hosted-http-diagnostics.log',readFileSync(path.join(g.root,'hosted-http-diagnostics.log'),'utf8').replace('effective=1000','effective=0'));assert.throws(g.manifest,/UID_RECEIPT_MISSING/);
});
test('symlink artifacts and directories refuse',t=>{
 const f=fixture(t);f.put('outside.txt',source+'\n');rmSync(path.join(f.root,'source-sha.txt'));symlinkSync('outside.txt',path.join(f.root,'source-sha.txt'));assert.throws(f.manifest,/NONREGULAR_ARTIFACT/);
 const g=fixture(t);rmSync(path.join(g.root,'staffology'),{recursive:true});mkdirSync(path.join(g.root,'private'));symlinkSync('private',path.join(g.root,'staffology'));assert.throws(g.manifest,/NONREGULAR_DIRECTORY/);
});
test('CLI writes only a new sanitized manifest and refuses replacement',t=>{
 const f=fixture(t),run=()=>spawnSync(process.execPath,[script,f.root,source],{encoding:'utf8'}),first=run();
 assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/^RUNTIME_ARTIFACT_MANIFEST=WRITTEN source=[a-f0-9]{40} sha256=[a-f0-9]{64}\n$/);
 const bytes=readFileSync(path.join(f.root,'artifact-manifest.json'));assert.equal(bytes.toString().includes(secret),false);
 const second=run();assert.equal(second.status,1);assert.match(second.stderr,/OUTPUT_UNAVAILABLE/);assert.deepEqual(readFileSync(path.join(f.root,'artifact-manifest.json')),bytes);
});
test('CLI refuses incomplete artifacts without emitting private values or output',t=>{
 const f=fixture(t);f.put('image-inspect.json','{'+secret);const result=spawnSync(process.execPath,[script,f.root,source],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/INVALID_JSON/);assert.equal((result.stdout+result.stderr).includes(secret),false);assert.throws(()=>readFileSync(path.join(f.root,'artifact-manifest.json')));
});
test('CI requires the manifest after capture and before cleanup, with ordinary source tests selected',()=>{
 const config=readFileSync(new URL('../.circleci/config.yml',import.meta.url),'utf8'),forge=readFileSync(new URL('./run-forge-ci.mjs',import.meta.url),'utf8');
 const capture=config.indexOf('name: Capture exact runtime proof'),manifest=config.indexOf('name: Bind mandatory runtime artifact manifest'),cleanup=config.indexOf('name: Clean up proof container');
 assert.ok(capture>=0&&manifest>capture&&cleanup>manifest,'normal mandatory manifest step must follow capture');
 assert.doesNotMatch(config.slice(manifest,cleanup),/when: always/);assert.match(config.slice(manifest,cleanup),/node scripts\/runtime-artifact-manifest\.mjs \/tmp\/circleci-runtime-artifacts "\$\{CIRCLE_SHA1\}"/);
 assert.match(config,/docker inspect --format '\{\{\.Image\}\}' vector-forge-proof/);assert.match(forge,/'scripts\/runtime-artifact-manifest\.test\.mjs'/);
});
