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
const root = path.resolve(__dirname, '..');
const bootstrap = fs.readFileSync(path.join(root, 'security/runtime/bootstrap.cjs'), 'utf8');
const relativeRequires = Array.from(bootstrap.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g), m => m[1]);
function copyMappings(docker) {const mappings=new Set();for(const line of docker.split('\n')){if(!line.startsWith('COPY '))continue;const words=line.trim().split(/\s+/).slice(1);while(words[0]?.startsWith('--'))words.shift();const destination=words.pop();for(const source of words){const target=destination.endsWith('/')&&!source.endsWith('/')?destination+path.posix.basename(source):destination;mappings.add(`${source} ${target}`);}}return mappings;}
const {runtimeStageAncestry} = require('../scripts/docker-runtime-ancestry.cjs');
test('runtime packaging follows inherited stages without accepting sibling fixtures', () => {
  const fixture = 'FROM node AS base\nCOPY runtime /app/\nFROM base AS proof\nCOPY fixtures /proof/\nFROM base\nCOPY --from=proof /receipt /tmp/receipt\n';
  const final = runtimeStageAncestry(fixture);
  assert.ok(final.includes('COPY runtime /app/'));
  assert.ok(final.includes('COPY --from=proof /receipt /tmp/receipt'));
  assert.ok(!final.includes('COPY fixtures /proof/'));
  assert.ok(!runtimeStageAncestry(fixture.replace('FROM base\n', 'FROM scratch\n')).includes('COPY runtime /app/'));
});
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
 const finalStage=runtimeStageAncestry(docker);
 const source='COPY artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz /tmp/runtime.tgz';
 const check='RUN echo "'+sealedArchiveSha256+'  /tmp/runtime.tgz" | sha256sum -c -';
 const unpack='&& tar -xzf /tmp/runtime.tgz -C /app';
 assert.ok(finalStage.indexOf(source)>=0&&finalStage.indexOf(check)>finalStage.indexOf(source)&&finalStage.indexOf(unpack)>finalStage.indexOf(check),'final image must copy/check the pinned archive before extracting public helpers into /app');
}
test('the final Docker stage includes every relative bootstrap dependency', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const finalStage = runtimeStageAncestry(docker);
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
    if (required === 'support-runtime/support-selfhelp-service.cjs') {
      for (const file of ['support-selfhelp.cjs', 'support-selfhelp-service.cjs']) {
        assert.ok(fs.existsSync(path.join(root, 'resilience', file)), `support dependency missing: ${file}`);
        assert.ok(composer.includes(`copy('resilience/${file}', 'support-runtime/${file}')`), `support dependency not composed: ${file}`);
        assert.ok(docker.includes(`resilience/${file}`), `support dependency not packaged: ${file}`);
      }
      assert.match(docker, /COPY resilience\/support-selfhelp\.cjs resilience\/support-selfhelp-service\.cjs \/app\/support-runtime\//);
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
