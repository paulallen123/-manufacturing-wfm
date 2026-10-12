'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const root = path.resolve(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'security/runtime/bootstrap.cjs'), 'utf8');
const relativeRequires = Array.from(bootstrap.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
function copyMappings(docker) {const mappings=new Set();for(const line of docker.split('\n')){if(!line.startsWith('COPY '))continue;const words=line.trim().split(/\s+/).slice(1);while(words[0]?.startsWith('--'))words.shift();const destination=words.pop();for(const source of words){const target=destination.endsWith('/')&&!source.endsWith('/')?destination+path.posix.basename(source):destination;mappings.add(`${source} ${target}`);}}return mappings;}
const sealedArchiveSha256='3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
const sealedPublicHelpers=Object.freeze({'public/engine.js':Object.freeze(['allowedPeople','descendants']),'public/operations-engine.js':Object.freeze(['approvedSite'])});
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
let sealedPublicProof;
function readSealedPublicProof(t){
 if(sealedPublicProof)return sealedPublicProof;
 const archive=path.join(root,'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
 assert.equal(sha256(fs.readFileSync(archive)),sealedArchiveSha256,'native public helpers require the exact reviewed archive');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrap-native-helpers-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const names=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split(/\r?\n/);
 assert.ok(names.every(name=>!path.posix.isAbsolute(name)&&!name.split('/').includes('..')&&!name.includes('\\')),'sealed archive member paths must remain safe');
 execFileSync('tar',['--no-same-owner','-xzf',archive,'-C',dir],{stdio:'pipe'});
 const manifestBytes=fs.readFileSync(path.join(dir,'RUNTIME_MANIFEST.json')),packageManifest=JSON.parse(fs.readFileSync(path.join(dir,'PACKAGE_MANIFEST_SHA256.json')));
 assert.equal(sha256(manifestBytes),packageManifest.files['RUNTIME_MANIFEST.json'],'native manifest must match the archive package manifest');
 const manifest=JSON.parse(manifestBytes),members={},exports={};
 assert.equal(Object.keys(manifest).length,133,'sealed runtime member coverage must remain exact');
 for(const [member,expected] of Object.entries(manifest)){assert.ok(!path.posix.isAbsolute(member)&&!member.split('/').includes('..')&&!member.includes('\\'),'unsafe runtime manifest member');assert.equal(sha256(fs.readFileSync(path.join(dir,member))),expected,'sealed runtime dependency bytes differ: '+member);}
 for(const required of Object.keys(sealedPublicHelpers)){members[required]=fs.readFileSync(path.join(dir,required));exports[required]=require(path.join(dir,required));}
 return sealedPublicProof={archiveSha256:sealedArchiveSha256,manifest,members,exports};
}
function assertSealedPublicPackaging(required,composer,docker,proof){
 assert.ok(Object.hasOwn(sealedPublicHelpers,required),'unreviewed sealed public bootstrap dependency: '+required);
 assert.equal(proof.archiveSha256,sealedArchiveSha256,'native archive pin must remain exact');
 assert.match(String(proof.manifest[required]||''),/^[0-9a-f]{64}$/,'native helper missing from authenticated runtime manifest: '+required);
 assert.ok(Buffer.isBuffer(proof.members[required]),'native helper member missing: '+required);
 assert.equal(sha256(proof.members[required]),proof.manifest[required],'native helper member digest changed: '+required);
 for(const name of sealedPublicHelpers[required])assert.equal(typeof proof.exports[required]?.[name],'function','native helper export missing: '+required+'#'+name);
 const extract="execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', output]);";
 const mismatch="throw Error('RUNTIME_ARTIFACT_HASH_MISMATCH')";
 assert.match(composer,/const archive = path\.join\(root, 'artifact\/wfm-0\.6\.76-hosted-staging-rc1\.tar\.gz'\);/,'composer must select the exact sealed artifact');
 assert.ok(composer.includes("const expected = '"+sealedArchiveSha256+"';"),'composer must pin the exact sealed archive');
 assert.ok(composer.indexOf(mismatch)>=0&&composer.indexOf(extract)>composer.indexOf(mismatch),'composer must verify archive bytes before extracting members into the actual runtime root');
 const finalStage=docker.slice(docker.lastIndexOf('\nFROM '));
 const source='COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz';
 const check='RUN echo "'+sealedArchiveSha256+'  /tmp/runtime.tgz" | sha256sum -c -';
 const unpack='&& tar -xzf /tmp/runtime.tgz -C /app';
 assert.ok(finalStage.indexOf(source)>=0&&finalStage.indexOf(check)>finalStage.indexOf(source)&&finalStage.indexOf(unpack)>finalStage.indexOf(check),'final image must copy/check the pinned archive before extracting public helpers into /app');
}
test('the final Docker stage includes every relative bootstrap dependency', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const finalStage = docker.slice(docker.lastIndexOf('\nFROM '));
  const mappings=copyMappings(finalStage);
  for (const file of relativeRequires) {
    assert.ok(mappings.has(`security/runtime/${file} /app/security-runtime/${file}`), `required runtime module omitted from image: ${file}`);
  }
});
test('local proof assembly includes the same required bootstrap dependencies', () => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const group = composer.match(/security:\s*\[([^\]]+)\]/)?.[1] || '';
  for (const file of relativeRequires) assert.ok(group.includes(`'${file}'`), `local proof omitted required module: ${file}`);
});

test('local proof assembly includes absolute bootstrap runtime dependencies and training closure', t => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const absoluteRequires = Array.from(bootstrap.matchAll(/require\(['"]\/app\/([^'"]+)['"]\)/g), m => m[1]);
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const runtimeGroups = {
    'integration-runtime': 'integration',
    'integrations': 'integrations',
    'implementation-runtime': 'implementation',
    'learning-runtime': 'learning',
    'operations-runtime': 'operations',
    'reporting-runtime': 'reporting',
    'trust-runtime': 'trust'
  };
  for (const required of absoluteRequires) {
    if(Object.hasOwn(sealedPublicHelpers,required)){
      // These exact native helpers and their complete dependency bytes come from
      // the pinned archive, not a source-copy group or an arbitrary public path.
      assertSealedPublicPackaging(required,composer,docker,readSealedPublicProof(t));
      continue;
    }
    if (required === 'lib/configuration-compiler.cjs') {
      // This dependency comes from the hash-verified sealed archive, not a source-copy group.
      const compiler = require('../implementation/runtime/test-support/sealed-compiler.cjs')(t);
      assert.equal(typeof compiler.compile, 'function');
      assert.match(composer, /run\('scripts\/patch-workspace-compiler\.mjs', \[path\.join\(output,'lib\/configuration-compiler\.cjs'\)\]\)/);
      continue;
    }
    if (required === 'server.cjs') {
      assert.match(composer, /artifact\/wfm-0\.6\.76-hosted-staging-rc1\.tar\.gz/, 'base server must remain sourced from the pinned sealed runtime artifact');
      continue;
    }
    const [runtimeGroup, ...rest] = required.split('/');
    const sourceGroup = runtimeGroups[runtimeGroup];
    assert.ok(sourceGroup, `unmapped bootstrap runtime group: ${runtimeGroup}`);
    const file = rest.join('/');
    if (runtimeGroup === 'operations-runtime' && file === 'workforce-lifecycle-guard.cjs') {
      assert.match(composer, /workforce-lifecycle-router\.cjs'\s*,\s*'operations-runtime\/workforce-lifecycle-guard\.cjs'/);
      continue;
    }
    const group = composer.match(new RegExp(sourceGroup + ':\\s*\\[([\\s\\S]*?)\\n\\s*\\]'))?.[1]
      || composer.match(new RegExp(sourceGroup + ':\\s*\\[([^\\]]+)\\]'))?.[1]
      || '';
    assert.ok(group.includes(`'${file}'`), `local proof omitted absolute bootstrap dependency: ${required}`);
  }

  const training = fs.readFileSync(path.join(root, 'learning/runtime/training-delivery-service.cjs'), 'utf8');
  const trainingRelatives = Array.from(training.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
  const learningGroup = composer.match(/learning:\s*\[([\s\S]*?)\n\s*\]/)?.[1] || '';
  for (const file of trainingRelatives) {
    assert.ok(learningGroup.includes(`'${file}'`), `local proof omitted training dependency: ${file}`);
  }
});
for(const required of Object.keys(sealedPublicHelpers))for(const [name,mutate] of [
 ['missing manifest entry',proof=>({...proof,manifest:{...proof.manifest,[required]:undefined}})],
 ['missing archive member',proof=>({...proof,members:{...proof.members,[required]:undefined}})],
 ['changed archive member bytes',proof=>({...proof,members:{...proof.members,[required]:Buffer.from('unreviewed native helper')}})]
])test('native helper packaging refuses '+name+': '+required,t=>{
 const composer=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
 assert.throws(()=>assertSealedPublicPackaging(required,composer,docker,mutate(readSealedPublicProof(t))),/missing|changed/);
});
for(const [required,names] of Object.entries(sealedPublicHelpers))for(const name of names)test('native helper packaging refuses missing export: '+required+'#'+name,t=>{
 const proof=readSealedPublicProof(t),changed={...proof,exports:{...proof.exports,[required]:{...proof.exports[required],[name]:undefined}}};
 assert.throws(()=>assertSealedPublicPackaging(required,fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),changed),/export missing/);
});
for(const [name,mutate] of [
 ['composer archive pin',([composer,docker])=>[composer.replace("const expected = '"+sealedArchiveSha256+"';","const expected = '"+'0'.repeat(64)+"';"),docker]],
 ['composer extraction destination',([composer,docker])=>[composer.replace("'-C', output]);","'-C', '/unreviewed']);"),docker]],
 ['Docker archive source',([composer,docker])=>[composer,docker.replace('COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz','COPY artifact/unreviewed.tar.gz /tmp/runtime.tgz')]],
 ['Docker extraction destination',([composer,docker])=>[composer,docker.replace('&& tar -xzf /tmp/runtime.tgz -C /app','&& tar -xzf /tmp/runtime.tgz -C /elsewhere')]]
])test('native helper packaging refuses incorrect '+name,t=>{
 const [composer,docker]=mutate([fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),fs.readFileSync(path.join(root,'Dockerfile'),'utf8')]);
 assert.throws(()=>assertSealedPublicPackaging('public/engine.js',composer,docker,readSealedPublicProof(t)),/must pin|verify archive|final image/);
});
test('native helper packaging refuses an unknown public dependency',t=>{
 assert.throws(()=>assertSealedPublicPackaging('public/unreviewed.js',fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),readSealedPublicProof(t)),/unreviewed sealed public bootstrap dependency/);
});
test('local proof assembly includes scheduling runtime dependency closure', () => {
  const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
  const scheduling = fs.readFileSync(path.join(root, 'operations/runtime/scheduling-intelligence-service.cjs'), 'utf8');
  const relatives = Array.from(scheduling.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
  const operationsGroup = composer.match(/operations:\s*\[([\s\S]*?)\n\s*\]/)?.[1] || '';
  assert.ok(operationsGroup.includes("'scheduling-intelligence-service.cjs'"), 'local proof omitted scheduling service');
  for (const file of relatives) {
    assert.ok(operationsGroup.includes(`'${file}'`), `local proof omitted scheduling dependency: ${file}`);
  }
});

test('retired presentation serves 410 for direct and encoded paths, and never intercepts the real API', async t => {
  const { serveRetiredPresentation } = require('../security/runtime/retired-presentation.cjs');
  const server = http.createServer((req, res) => {
    if (serveRetiredPresentation(req, res)) return;
    res.writeHead(204); res.end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const asset of ['/factory-control-ui.js', '/factory%2dcontrol-ui.js', '/nested/review-ui.js?cache=old', '/vector-shell.js']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await fetch(base + asset, { method });
      assert.equal(res.status, 410); assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      const body = await res.text(); if (method === 'HEAD') assert.equal(body, '');
    }
  }
  for (const route of ['/api/health', '/api/login', '/vector-ui.js', '/vector-workflows.js']) {
    assert.equal((await fetch(base + route)).status, 204);
  }
});


test('legacy local-data writes are redirected outside immutable app root', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /mkdir -p \/tmp\/vector-local-data/);
  assert.match(docker, /ln -s \/tmp\/vector-local-data \/app\/local-data/);
  assert.match(docker, /chmod 0700 \/tmp\/vector-local-data/);
  assert.match(docker, /USER\s+root/);
  assert.match(docker, /ENTRYPOINT\s+\[\"\/usr\/local\/bin\/vector-entrypoint\.sh\"\]/);
  assert.match(docker, /exec gosu node \"\$@\"/);
  assert.match(docker, /find \/app -type d -exec chmod 0555/);
});


test('integration fabric runtime retains its source-relative loader layout', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const mappings=copyMappings(docker);
  for(const mapping of ['integration-fabric/runtime/ /app/integration-fabric/runtime/','integration-fabric/scripts/load-catalog.mjs /app/integration-fabric/scripts/load-catalog.mjs','integration-fabric/systems.json /app/integration-fabric/systems.json','integration-fabric/systems-research.json /app/integration-fabric/systems-research.json','integration-fabric/research-overlays/ /app/integration-fabric/research-overlays/','integration-fabric/protocol-profiles.json /app/integration-fabric/protocol-profiles.json','integration-fabric/opportunity-profiles.json /app/integration-fabric/opportunity-profiles.json'])assert.ok(mappings.has(mapping),`runtime mapping omitted: ${mapping}`);
  const registry = fs.readFileSync(path.join(root, 'integration-fabric/runtime/connector-registry.mjs'), 'utf8');
  assert.match(registry, /\.\.\/scripts\/load-catalog\.mjs/);
});


test('packaged lifecycle router preserves the trusted Autopilot execution adapter', () => {
  const router = fs.readFileSync(path.join(root, 'operations/runtime/workforce-lifecycle-router.cjs'), 'utf8');
  assert.match(router, /applyTrustedEvent\(input\s*=\s*\{\}\)/, 'packaged lifecycle router must expose trusted lifecycle mutation');
  assert.match(router, /return lifecycle\.applyTrustedEvent\(input\)/, 'trusted lifecycle mutation must delegate to the authoritative guard');
  assert.match(router, /getTrustedEvent\(input\s*=\s*\{\}\)/, 'packaged lifecycle router must expose trusted lifecycle readback');
  assert.match(router, /return lifecycle\.getTrustedEvent\(input\)/, 'trusted lifecycle readback must delegate to the authoritative guard');
  assert.match(bootstrap, /createAutopilotExecutionEngine\(\{[^}]*lifecycleAdapter\s*:\s*lifecycleGuard/s, 'hosted bootstrap must inject the same authoritative lifecycle guard into Autopilot');
});

function assertNativeContainmentAssembly(composer,docker){
 const call="run('scripts/patch-native-setup-containment.mjs', [output]);";
 assert.equal(composer.split(call).length-1,2,'native helper must run once in each composer branch');
 const branch=composer.slice(composer.indexOf('if (fs.existsSync(output)) {'),composer.indexOf("const archive = path.join(root"));
 assert.ok(branch.indexOf(call)>branch.indexOf('patchPayrollMoney(output);')&&branch.indexOf(call)<branch.indexOf('process.exit(0);'),'existing-output native patch must follow prior overlays');
 const fresh=composer.slice(composer.indexOf("const archive = path.join(root"));
 assert.ok(fresh.indexOf(call)>fresh.indexOf('patchPayrollMoney(output);')&&fresh.indexOf(call)<fresh.indexOf('inventory(output);'),'fresh native patch must precede final inventory');
 const final=docker.slice(docker.lastIndexOf('\nFROM '));
 const helperCopy=final.split('\n').find(line=>line.startsWith('COPY ')&&line.includes('scripts/patch-native-setup-containment.mjs')&&line.trimEnd().endsWith('/workspace/scripts/'));
 assert.ok(helperCopy&&final.indexOf(helperCopy)<final.indexOf('RUN node /workspace/scripts/compose-vector-local-runtime.mjs /app'),'Docker must copy shared native helper before existing composer entry');
 assert.equal(final.split('node /workspace/scripts/compose-vector-local-runtime.mjs /app').length-1,1,'Docker must preserve one composer owner');
 const mappings=copyMappings(final);
 for(const module of ['implementation-run-schema.cjs','native-setup-containment.cjs']){
  assert.ok(composer.match(/implementation:\s*\[([\s\S]*?)\n\s*\]/)?.[1].includes("'"+module+"'"),'composer native dependency omitted: '+module);
  for(const destination of ['/app/implementation-runtime/','/tmp/wfm-tests/implementation/runtime/'])assert.ok(mappings.has('implementation/runtime/'+module+' '+destination+module),'Docker native dependency omitted: '+destination+module);
 }
 assert.ok(docker.includes('node --test implementation/runtime/native-setup-containment.test.cjs'),'source guard suite must execute');
 assert.ok(docker.includes('VECTOR_NATIVE_SETUP_RUNTIME_ROOT=/proof/staffology-full-runtime/implementation-runtime node --test implementation/runtime/native-setup-containment.test.cjs'),'source composed guard suite must select actual composed modules');
 assert.ok(docker.includes('VECTOR_NATIVE_CONTAINMENT_MODE=build-controls VECTOR_NATIVE_CONTAINMENT_LOCAL_PATHS=1 VECTOR_NATIVE_CONTAINMENT_RUNTIME=/proof/staffology-full-runtime'),'source build controls must select explicit source resolver');
 assert.ok(final.includes('VECTOR_NATIVE_SETUP_RUNTIME_ROOT=/app/implementation-runtime node --test /tmp/wfm-tests/implementation/runtime/native-setup-containment.test.cjs'),'final guard suite must select actual app modules');
 assert.ok(docker.includes('VECTOR_NATIVE_CONTAINMENT_RUNTIME=/proof/staffology-full-runtime'),'source composed proof must execute');
 assert.ok(final.includes('COPY verification/setup-only-native-containment.test.cjs /tmp/wfm-tests/verification/setup-only-native-containment.test.cjs'),'final native proof must be copied');
 assert.ok(final.includes('COPY scripts/patch-native-setup-containment.mjs /tmp/wfm-tests/scripts/patch-native-setup-containment.mjs'),'final native proof must pin exact admitted helper bytes');
 assert.ok(final.includes('VECTOR_NATIVE_CONTAINMENT_RUNTIME=/app')&&final.includes('/tmp/wfm-tests/verification/setup-only-native-containment.test.cjs'),'actual final app proof must execute');
}
test('native containment assembly preserves the single shared patch owner and source/final-app closure',()=>{
 assertNativeContainmentAssembly(fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),fs.readFileSync(path.join(root,'Dockerfile'),'utf8'));
});
for(const [name,mutate]of [
 ['missing existing-output invocation',c=>c.replace("run('scripts/patch-native-setup-containment.mjs', [output]);",'')],
 ['missing fresh invocation',c=>{const at=c.lastIndexOf("run('scripts/patch-native-setup-containment.mjs', [output]);");return c.slice(0,at)+c.slice(at).replace("run('scripts/patch-native-setup-containment.mjs', [output]);",'');}],
 ['duplicate invocation',c=>c.replace("run('scripts/patch-native-setup-containment.mjs', [output]);","run('scripts/patch-native-setup-containment.mjs', [output]);run('scripts/patch-native-setup-containment.mjs', [output]);")],
 ['missing guard copy',c=>c.replace("'native-setup-containment.cjs'",'')]
])test('native containment assembly rejects '+name,()=>{
 const c=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),d=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');assertNativeContainmentAssembly(c,d);assert.throws(()=>assertNativeContainmentAssembly(mutate(c),d),/native helper|native dependency/);
});
for(const [name,selector]of [
 ['missing source-composed guard selector','VECTOR_NATIVE_SETUP_RUNTIME_ROOT=/proof/staffology-full-runtime/implementation-runtime '],
 ['missing final-app guard selector','VECTOR_NATIVE_SETUP_RUNTIME_ROOT=/app/implementation-runtime ']
])test('native containment assembly rejects '+name,()=>{
 const c=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),d=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
 assert.ok(d.includes(selector),'positive assembly must contain actual runtime selector');
 assert.throws(()=>assertNativeContainmentAssembly(c,d.replace(selector,'')),/guard suite must select actual/);
});
test('native containment assembly rejects missing final identity helper copy',()=>{
 const c=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),d=fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),copy='COPY scripts/patch-native-setup-containment.mjs /tmp/wfm-tests/scripts/patch-native-setup-containment.mjs';
 assertNativeContainmentAssembly(c,d);assert.throws(()=>assertNativeContainmentAssembly(c,d.replace(copy,'')),/exact admitted helper bytes/);
});

async function nativeCachedStateOwner(){
 const helper=await import(pathToFileURL(path.join(root,'scripts/patch-native-setup-containment.mjs')).href),source=helper.nativeSetupContainmentRecipe.find(h=>h.id==='bind-before-seed').after;
 const observed=[],context={URL,E:{assert(ok,message,status){if(!ok)throw Object.assign(Error(message),{status});}},nativeSetupContainment:{assertActorCurrent(actor){observed.push(['actor',actor]);},assertOperationalTenant(tenant){observed.push(['mode',tenant]);},assertPrincipalAnchor(actor,state){observed.push(['anchor',actor,state]);}}};
 const map=source.split('\n').find(line=>line.startsWith('const nativeRequestStates='));assert.ok(map,'Actual shared patch must own a lexical WeakMap');vm.runInNewContext(map,context);
 for(const name of ['nativeMutationNeedsAnchor','nativeStateNeedsAnchor','nativeCaptureRequestState','nativeAssertCachedRequestState','nativeAssertCurrentRequestState']){
  const line=source.split('\n').find(line=>line.startsWith('function '+name+'('));assert.ok(line,'Actual native owner omitted: '+name);vm.runInNewContext(line+';this.'+name+'='+name,context);
 }
 return {helper,context,observed};
}
test('native cached state is captured once with original actor and source-owned traversal decision',async()=>{
 const {context,observed}=await nativeCachedStateOwner(),a={tenant:'alpha',personId:'root'},s={org:[],staff:[]},req={method:'POST',url:'/api/payroll/preview?needsAnchor=false',needsAnchor:false};
 assert.equal(context.nativeCaptureRequestState(req,a,s),true);assert.throws(()=>context.nativeCaptureRequestState(req,a,s),/already captured/);
 context.nativeAssertCurrentRequestState(req,a);assert.ok(observed.some(x=>x[0]==='anchor'&&x[1]===a&&x[2]===s));
});
test('native cached state rejects actor substitution and never refreshes the captured source',async()=>{
 const {context,observed}=await nativeCachedStateOwner(),a={tenant:'alpha',personId:'root'},s={org:[],staff:[]},req={method:'POST',url:'/api/pattern-preview'};
 context.nativeCaptureRequestState(req,a,s);assert.throws(()=>context.nativeAssertCachedRequestState(req,{...a}),/actor|authority|binding/i);
 context.nativeAssertCachedRequestState(req,a);assert.equal(observed.at(-1)[2],s);const before=observed.length;context.nativeAssertCachedRequestState({},a);assert.equal(observed.length,before,'Uncaptured state has no synthetic binding');
});
test('native AI completion uses the same private current-state fence before cache and response',async()=>{
 const {helper}=await nativeCachedStateOwner(),hook=helper.nativeSetupContainmentRecipe.find(h=>h.id==='ai-current-after-await');assert.ok(hook,'Actual AI async owner must be pinned');
 const wait=hook.after.indexOf('await AI.explain(analysis)'),fence=hook.after.indexOf('nativeAssertCurrentRequestState(req,a)',wait),cache=hook.after.indexOf('aiCache.set(key,answer)',wait),reply=hook.after.indexOf('return json(res,200,answer)',wait);
 assert.ok(wait>=0&&fence>wait&&cache>fence&&reply>cache,'Current actor/mode/source must precede both post-await effects');
});
test('native company configuration GET preserves exact non-traversal ownership without path or method bypass',async()=>{
 const {context,observed}=await nativeCachedStateOwner(),actor={tenant:'alpha',personId:'admin1',role:'admin',permissions:['company.configure']},state={org:[],staff:[]};
 const req={method:'GET',url:'/api/company-admin'};assert.equal(context.nativeCaptureRequestState(req,actor,state),false);context.nativeAssertCurrentRequestState(req,actor);
 assert.ok(observed.some(x=>x[0]==='actor'&&x[1]===actor));assert.ok(observed.some(x=>x[0]==='mode'&&x[1]==='alpha'));assert.equal(observed.some(x=>x[0]==='anchor'),false);
 for(const [method,url]of [['GET','/api/company-admin/near'],['POST','/api/company-admin'],['GET','/api/unknown']])assert.equal(context.nativeStateNeedsAnchor({method},new URL(url,'http://native.local'),actor,state),true);
});

function assertNativeWorkflowClosure(composer,docker,helper){
 const copies=copyMappings(docker);
 const expected=JSON.parse(helper.match(/const workflowModuleExpected=(\{[^\n]+\});/)?.[1]||'null');
 assert.ok(expected,'Native workflow receipt must pin the reviewed source modules');
 for(const file of ['workflow-action-evidence-bridge.cjs','workflow-action-evidence-sources.cjs']){
  const source='operations/runtime/'+file;
  assert.ok(composer.includes("'"+source+"'"),'Workflow composition source omitted: '+source);
  for(const target of ['/workspace/operations/runtime/','/app/operations-runtime/','/tmp/wfm-tests/operations/runtime/'])
   assert.ok(copies.has(source+' '+target+file),'Workflow copied source omitted: '+target+file);
  assert.equal(expected[file],require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,source))).digest('hex'),'Workflow receipt source pin differs: '+file);
 }
 assert.ok(helper.includes("failure('WORKFLOW_MODULE_MISMATCH')"),'Changed workflow module bytes must fail closed');
 assert.ok(helper.includes('sourceOwner:nativeWorkflowSourceOwner.sourceOwner')&&helper.includes('resolveSourceActor:nativeWorkflowSourceOwner.resolveSourceActor'),'Both workflow owners must be wired to the private native instance');
}
test('native workflow assembly pins both reader modules through composition and final app admission',()=>{
 assertNativeWorkflowClosure(fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),fs.readFileSync(path.join(root,'scripts/patch-native-setup-containment.mjs'),'utf8'));
});
for(const target of ['/workspace/operations/runtime/','/app/operations-runtime/','/tmp/wfm-tests/operations/runtime/'])test('native workflow assembly rejects a missing '+target+' owner module',()=>{
 const c=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),d=fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),h=fs.readFileSync(path.join(root,'scripts/patch-native-setup-containment.mjs'),'utf8');
 const lines=d.split('\n'),index=lines.findIndex(line=>line.startsWith('COPY ')&&line.trimEnd().endsWith(target)&&line.includes('operations/runtime/workflow-action-evidence-sources.cjs'));
 assert.ok(index>=0);lines[index]=lines[index].replace('operations/runtime/workflow-action-evidence-sources.cjs ','');
 assert.throws(()=>assertNativeWorkflowClosure(c,lines.join('\n'),h),/Workflow copied source omitted/);
});
test('native workflow assembly rejects an unbound module receipt pin',()=>{
 const c=fs.readFileSync(path.join(root,'scripts/compose-vector-local-runtime.mjs'),'utf8'),d=fs.readFileSync(path.join(root,'Dockerfile'),'utf8'),h=fs.readFileSync(path.join(root,'scripts/patch-native-setup-containment.mjs'),'utf8');
 assert.throws(()=>assertNativeWorkflowClosure(c,d,h.replace(/const workflowModuleExpected=\{[^\n]+\};/,'')),/receipt must pin/);
});
