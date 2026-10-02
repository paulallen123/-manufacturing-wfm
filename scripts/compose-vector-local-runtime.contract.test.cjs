'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {spawnSync}=require('node:child_process');

test('composer preserves the absent-directory canonical caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const temporary=mkdtempSync(join(tmpdir(),'vector-canonical-composer-'));
 const runtime=join(temporary,'runtime');
 assert.equal(existsSync(runtime),false);
 try{
  const result=spawnSync(process.execPath,[source,runtime],{cwd:join(__dirname,'..'),env:{PATH:process.platform==='win32'?join(process.env.SystemRoot,'System32'):'/usr/bin:/bin',HOME:temporary,NODE_OPTIONS:packedPreload()},encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Canonical composition failed. Actual stderr:\n${result.stderr}`);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),true);
  assert.equal(existsSync(join(runtime,'security-runtime/bootstrap.cjs')),true);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  const provenance=JSON.parse(readFileSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json'),'utf8'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-production-boundaries.cjs'));
  assert.ok(provenance.runtimeFiles.some(file=>file.path==='integrations/staffology/canonical-operations.cjs'));
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('composer preserves the extracted-runtime container caller contract',()=>{
 const source=join(__dirname,'compose-vector-local-runtime.mjs');
 const root=join(__dirname,'..');
 const temporary=mkdtempSync(join(tmpdir(),'vector-container-composer-'));
 const runtime=join(temporary,'runtime');
 try{
  mkdirSync(runtime);
  const extracted=spawnSync('tar',['--no-same-owner','-xzf',join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'-C',runtime],{encoding:'utf8',timeout:120000});
  assert.equal(extracted.status,0,`Sealed runtime extraction failed. Actual stderr:\n${extracted.stderr}`);
  const result=spawnSync(process.execPath,[source,runtime],{cwd:root,env:{PATH:process.platform==='win32'?join(process.env.SystemRoot,'System32'):'/usr/bin:/bin',HOME:temporary,NODE_OPTIONS:packedPreload()},encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`Container composition failed. Actual stderr:\n${result.stderr}`);
  assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),true);
  assert.equal(existsSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json')),false);
  const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));
  assert.equal(assembly.sealedRuntimePreserved,true);
  assert.equal(assembly.activationAvailable,false);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});


// Actual pinned-archive bytes and actual composer child processes; no app/server.
const packedFs=require('node:fs'),packedPath=require('node:path'),packedCrypto=require('node:crypto'),packedZlib=require('node:zlib');
const packedRoot=join(__dirname,'..'),packedArchive=readFileSync(join(packedRoot,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'));
function packedExtract(bytes,dest){const tar=packedZlib.gunzipSync(bytes);for(let at=0;at+512<=tar.length;){const h=tar.subarray(at,at+512),name=h.subarray(0,100).toString().replace(/\0.*$/,''),size=parseInt(h.subarray(124,136).toString().replace(/\0.*$/,'').trim(),8)||0;if(!name)break;assert.equal(packedPath.isAbsolute(name),false);assert.equal(name.split('/').includes('..'),false);const target=join(dest,name),type=h[156];if(type===0||type===48){mkdirSync(packedPath.dirname(target),{recursive:true});packedFs.writeFileSync(target,tar.subarray(at+512,at+512+size));}else assert.ok([53,120,103].includes(type),'archive fixture rejects links/unknown types');at+=512+Math.ceil(size/512)*512;}}
function packedPreload(){const i=process.execArgv.indexOf('--require');return i<0?'':'--require '+JSON.stringify(process.execArgv[i+1]);}
function packedRun(source,runtime,extraPreload){const guard=packedPreload();return spawnSync(process.execPath,[source,runtime],{encoding:'utf8',timeout:120000,env:{...process.env,NODE_OPTIONS:guard+(extraPreload?' --require '+JSON.stringify(extraPreload):''),WFM_HOSTED_STAGING:'false'}});}
function packedFixture(t){const temporary=mkdtempSync(join(tmpdir(),'vector-packed-on-')),project=join(temporary,'project'),runtime=join(temporary,'runtime');mkdirSync(join(project,'scripts'),{recursive:true});packedFs.copyFileSync(join(__dirname,'compose-vector-local-runtime.mjs'),join(project,'scripts/compose-vector-local-runtime.mjs'));for(const name of ['staffology-adapter.cjs','canonical-runtime-bridge.cjs','canonical-production-boundaries.cjs','canonical-operations.cjs']){mkdirSync(join(project,'integrations/staffology'),{recursive:true});packedFs.copyFileSync(join(packedRoot,'integrations/staffology',name),join(project,'integrations/staffology',name));}mkdirSync(runtime);packedExtract(packedArchive,runtime);t.after(()=>rmSync(temporary,{recursive:true,force:true}));return{project,runtime,source:join(project,'scripts/compose-vector-local-runtime.mjs')};}
const packedSha=b=>packedCrypto.createHash('sha256').update(b).digest('hex');
test('PACKED_ON exact Docker extracted-output contract binds sealed input and transformed ON without archive',t=>{const f=packedFixture(t);assert.equal(existsSync(join(f.project,'artifact')),false);const before=readFileSync(join(f.runtime,'public/onboarding-engine.js')),result=packedRun(f.source,f.runtime);assert.equal(result.status,0,result.stderr);const assembled=packedSha(readFileSync(join(f.runtime,'public/onboarding-engine.js'))),receipt=JSON.parse(readFileSync(join(f.runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));assert.equal(assembled,'a9ec1ee9782636b9ac564aae487d36378597aa7e756088b3f96b79da5d896744');assert.equal(receipt.assembledFiles.onboarding,assembled);assert.equal(receipt.sourceHashes['public/onboarding-engine.js'],packedSha(before));assert.equal(packedSha(before),'c06b354826747387fe14763dba5cef681ae08a1cf64d83d2fb54c1b13338476e');assert.equal(JSON.parse(readFileSync(join(f.runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8')).sealedRuntimePreserved,true);});
const packedNegatives=[
 ['wrong ON bytes',f=>packedFs.appendFileSync(join(f.runtime,'public/onboarding-engine.js'),'\n// changed')],
 ['missing ON bytes',f=>packedFs.unlinkSync(join(f.runtime,'public/onboarding-engine.js'))],
 ['missing runtime manifest',f=>packedFs.unlinkSync(join(f.runtime,'RUNTIME_MANIFEST.json'))],
 ['wrong runtime manifest',f=>packedFs.appendFileSync(join(f.runtime,'RUNTIME_MANIFEST.json'),' ')],
 ['missing package manifest',f=>packedFs.unlinkSync(join(f.runtime,'PACKAGE_MANIFEST_SHA256.json'))],
 ['wrong package runtime binding',f=>{const p=join(f.runtime,'PACKAGE_MANIFEST_SHA256.json'),m=JSON.parse(readFileSync(p,'utf8'));m.files['RUNTIME_MANIFEST.json']='0'.repeat(64);packedFs.writeFileSync(p,JSON.stringify(m));}],
 ['forged runtime manifest and matching forged package digest',f=>{const rp=join(f.runtime,'RUNTIME_MANIFEST.json'),pm=join(f.runtime,'PACKAGE_MANIFEST_SHA256.json'),m=JSON.parse(readFileSync(rp,'utf8'));m['public/index.html']='0'.repeat(64);const b=Buffer.from(JSON.stringify(m));packedFs.writeFileSync(rp,b);const p=JSON.parse(readFileSync(pm,'utf8'));p.files['RUNTIME_MANIFEST.json']=packedSha(b);packedFs.writeFileSync(pm,JSON.stringify(p));}],
 ['forged ON declaration with rehashed manifests',f=>{const rp=join(f.runtime,'RUNTIME_MANIFEST.json'),pm=join(f.runtime,'PACKAGE_MANIFEST_SHA256.json'),m=JSON.parse(readFileSync(rp,'utf8'));m['public/onboarding-engine.js']='0'.repeat(64);const b=Buffer.from(JSON.stringify(m));packedFs.writeFileSync(rp,b);const p=JSON.parse(readFileSync(pm,'utf8'));p.files['RUNTIME_MANIFEST.json']=packedSha(b);packedFs.writeFileSync(pm,JSON.stringify(p));}],
 ['forged package extra field',f=>{const p=join(f.runtime,'PACKAGE_MANIFEST_SHA256.json'),m=JSON.parse(readFileSync(p,'utf8'));m.owner='untrusted';packedFs.writeFileSync(p,JSON.stringify(m));}]
];
for(const [label,mutate]of packedNegatives)test('PACKED_ON existing output rejects '+label+' before composition mutation',t=>{const f=packedFixture(t);mutate(f);const result=packedRun(f.source,f.runtime);assert.notEqual(result.status,0,'invalid closure must not assemble');assert.equal(existsSync(join(f.runtime,'STAFFOLOGY_ASSEMBLY.json')),false);assert.equal(existsSync(join(f.runtime,'integrations/staffology')),false);});
test('PACKED_ON fresh actual canonical composition binds transformed ON and original archive provenance',t=>{const temporary=mkdtempSync(join(tmpdir(),'vector-packed-on-fresh-')),runtime=join(temporary,'runtime');t.after(()=>rmSync(temporary,{recursive:true,force:true}));const result=packedRun(join(__dirname,'compose-vector-local-runtime.mjs'),runtime);assert.equal(result.status,0,result.stderr);const before=packedSha(readFileSync(join(runtime,'public/onboarding-engine.js')));assert.equal(before,'a9ec1ee9782636b9ac564aae487d36378597aa7e756088b3f96b79da5d896744');const assembly=JSON.parse(readFileSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json'),'utf8'));assert.equal(assembly.sourceHashes['public/onboarding-engine.js'],'c06b354826747387fe14763dba5cef681ae08a1cf64d83d2fb54c1b13338476e');assert.equal(assembly.assembledFiles.onboarding,before);const provenance=JSON.parse(readFileSync(join(runtime,'LOCAL_PROOF_PROVENANCE.json'),'utf8'));assert.equal(provenance.artifactSha256,'3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d');assert.ok(provenance.runtimeFiles.some(r=>r.path==='public/onboarding-engine.js'&&r.sha256===before));});
for(const kind of ['missing','wrong'])test('PACKED_ON fresh rejects '+kind+' archive before extraction',t=>{const f=packedFixture(t);rmSync(f.runtime,{recursive:true,force:true});if(kind==='wrong'){mkdirSync(join(f.project,'artifact'));packedFs.writeFileSync(join(f.project,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz'),'wrong archive');}const result=packedRun(f.source,f.runtime);assert.notEqual(result.status,0);assert.equal(existsSync(f.runtime),false);});

for(const kind of ['missing ON','wrong ON','forged manifest'])test('PACKED_ON fresh rejects corrupt extraction '+kind+' before overlay writes',t=>{const temporary=mkdtempSync(join(tmpdir(),'vector-corrupt-extraction-')),runtime=join(temporary,'runtime'),preload=join(temporary,'corrupt-extraction.cjs');t.after(()=>rmSync(temporary,{recursive:true,force:true}));const mutation=kind==='missing ON'?"fs.unlinkSync(p.join(out,'public/onboarding-engine.js'));":kind==='wrong ON'?"fs.appendFileSync(p.join(out,'public/onboarding-engine.js'),'changed');":"const r=p.join(out,'RUNTIME_MANIFEST.json'),b=Buffer.from(fs.readFileSync(r,'utf8')+' ');fs.writeFileSync(r,b);const pm=p.join(out,'PACKAGE_MANIFEST_SHA256.json'),m=JSON.parse(fs.readFileSync(pm,'utf8'));m.files['RUNTIME_MANIFEST.json']=require('node:crypto').createHash('sha256').update(b).digest('hex');fs.writeFileSync(pm,JSON.stringify(m));";packedFs.writeFileSync(preload,"const cp=require('node:child_process'),fs=require('node:fs'),p=require('node:path'),old=cp.execFileSync;cp.execFileSync=function(file,args,...rest){const result=old.call(this,file,args,...rest);if(file==='tar'&&args.includes('-xzf')){const out=args[args.indexOf('-C')+1];"+mutation+"}return result;};");const result=packedRun(join(__dirname,'compose-vector-local-runtime.mjs'),runtime,preload);assert.notEqual(result.status,0,'corrupt extracted closure must fail');assert.equal(existsSync(join(runtime,'security-runtime')),false,'validation must precede overlay writes');assert.equal(existsSync(join(runtime,'STAFFOLOGY_ASSEMBLY.json')),false);});
