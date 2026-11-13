'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createRuntimeIdentity}=require('../../../security/runtime/runtime-identity.cjs');

const staffologyRuntimeModules=[
 'staffology-adapter.cjs','canonical-runtime-bridge.cjs','canonical-production-boundaries.cjs',
 'canonical-operations.cjs','configured-site-authority.cjs','employee-import-previews.cjs'
];
const staffologyWorkspaceCopy='COPY '+staffologyRuntimeModules.map(file=>'integrations/staffology/'+file).join(' ')+' /workspace/integrations/staffology/';
const composerWorkspaceCopy='COPY scripts/compose-vector-local-runtime.mjs scripts/patch-payroll-money.mjs scripts/patch-workspace-compiler.mjs /workspace/scripts/';
const composeRuntime='RUN node /workspace/scripts/compose-vector-local-runtime.mjs /app '+String.fromCharCode(92);
function assertRuntimePackaging(dockerfile){
 const start=dockerfile.indexOf('# Customer-proof staging build');assert.ok(start>=0,'supported runtime stage must exist');
 const lines=dockerfile.slice(start).split(/\r?\n/),copies=lines.filter(line=>/^COPY\s+/.test(line));
 const workspaceCopies=copies.filter(line=>line.trim().split(/\s+/).at(-1)==='/workspace/integrations/staffology/');
 assert.deepEqual(workspaceCopies,[staffologyWorkspaceCopy],'exact six reviewed Staffology modules must share the sole workspace COPY');
 for(const file of staffologyRuntimeModules)assert.equal(copies.filter(line=>line.split(/\s+/).includes('integrations/staffology/'+file)).length,1,'runtime module must have exactly one source COPY: '+file);
 const modulesAt=lines.indexOf(staffologyWorkspaceCopy),scriptsAt=lines.indexOf(composerWorkspaceCopy),composeAt=lines.indexOf(composeRuntime),cleanupAt=lines.findIndex(line=>line.trim()==='&& rm -rf /workspace');
 assert.ok(modulesAt>=0&&scriptsAt>modulesAt&&composeAt>scriptsAt&&cleanupAt>composeAt,'exact modules and patchers must precede runtime composition; workspace removal must follow it');
}

test('supported Docker admission composes and binds the strict full canonical runtime',()=>{
 const dockerfile=readFileSync(resolve(__dirname,'../../../Dockerfile'),'utf8');
 const proof=dockerfile.slice(dockerfile.indexOf('AS autonomy-proof'),dockerfile.indexOf('# Customer-proof staging build'));
 assert.match(proof,/node scripts\/compose-vector-local-runtime\.mjs \/proof\/staffology-full-runtime/);
 assert.match(proof,/CANONICAL_SOURCE_DIR=\/proof/);
 assert.match(proof,/WFM_RUNTIME=\/proof\/staffology-full-runtime/);
 assert.match(proof,/STAFFOLOGY_RUNTIME_MODE=full/);
 assert.match(proof,/WFM_BUILD_SOURCE_SHA="\$RAILWAY_GIT_COMMIT_SHA"/);
 assert.match(proof,/STAFFOLOGY_PRIVATE_EVIDENCE_DIR=\/proof\/staffology-private-artifacts/);
 assert.match(proof,/set \+e; printf 'STAFFOLOGY_ADMISSION stage=start/);
 assert.match(proof,/--test-reporter=tap --test-reporter-destination=\/proof\/staffology-private-artifacts\/staffology-full\.tap/);
 assert.match(proof,/--test-reporter=\.\/scripts\/staffology-build-diagnostics\.cjs --test-reporter-destination=stdout/);
 assert.match(proof,/3>&2 > \/proof\/staffology-private-artifacts\/staffology-runner-private\.log 2>&1; status=\$\?/);
 assert.match(proof,/printf 'STAFFOLOGY_ADMISSION stage=exit status=%s\\n' "\$status" >&2; exit "\$status"/);
 assert.doesNotMatch(proof,/cat \/proof\/staffology-private-artifacts\/staffology-full\.tap/);
 assert.match(proof,/integrations\/staffology\/\*\.test\.cjs/);
 assert.match(proof,/independent\/succession-regressions\.test\.cjs/);
 assert.match(proof,/independent\/current-authority-recovery-held-out\.test\.cjs/);
 assert.match(proof,/independent\/full-http-employee-journey\.test\.cjs/);
 assert.match(proof,/independent\/generated-provider-preload\.test\.cjs/);
 const fullHttp=readFileSync(resolve(__dirname,'full-http-employee-journey.test.cjs'),'utf8');
 assert.match(fullHttp,/staffology\/employees\/acquire-stage/);
 assert.match(fullHttp,/staffology\/payroll\/approve-deliver/);
 assert.match(fullHttp,/WFM_STAFFOLOGY_OPERATION_JSON/);
 assert.match(fullHttp,/FULL_BUILD_SOURCE_SHA_REQUIRED/);
 assert.match(fullHttp,/time-source-ingest/);
 assert.match(fullHttp,/payroll-release/);
 assert.match(fullHttp,/staffology-http-result\.json/);
 assert.match(fullHttp,/FROM outbound_staffology_deliveries WHERE delivery_id=\? AND status='acknowledged'/);
 assert.match(fullHttp,/FROM outbound_staffology_private_evidence WHERE delivery_id=\? ORDER BY id/);
 assert.match(fullHttp,/FROM audit_events WHERE tenant=\? AND action IN/);
 assert.match(fullHttp,/dispatchAttempt:JSON\.parse\(deliveryRow\.dispatch_json\)/);
 assert.match(fullHttp,/providerRequests,providerRequestCount/);
 assert.match(fullHttp,/reviewedEmployment:\{rates:/);
 assert.match(fullHttp,/rmSync\(temporary,\{recursive:true,force:false\}\)/);
 assert.match(fullHttp,/sha256\(durableBytes\),proofDigest/);
 assert.match(fullHttp,/UNEXPECTED_EXTERNAL_ORIGIN/);
 assert.ok(proof.indexOf('npm ci --prefix security/runtime')<proof.indexOf('compose-vector-local-runtime.mjs'),'composition must use the preceding exact locked dependency installation');
 assert.match(dockerfile,/FROM scratch AS staffology-proof-evidence/);
 assert.match(dockerfile,/staffology-private-artifacts\/staffology-full\.tap/);
 const runtime=dockerfile.slice(dockerfile.indexOf('# Customer-proof staging build'));
 const copyInstructions=runtime.split('\n').filter(line=>/^COPY\s+/.test(line)).length;
 assert.ok(copyInstructions<100,`same-destination consolidation regressed to ${copyInstructions} COPY layers`);
 assertRuntimePackaging(dockerfile);
 const circle=readFileSync(resolve(__dirname,'../../../.circleci/config.yml'),'utf8');
 // Admit the two application builds and the separately scoped proof-client image.
 // Exact commands retain each target, source binding and artifact destination.
 const builds=circle.split('\n').map(line=>line.trim()).filter(line=>/^docker build\s/.test(line));
 assert.equal((circle.match(/\bdocker[ \t]+build\b/g)||[]).length,3,'no inline or additional Docker build may evade the exact build list');
 assert.deepEqual(builds,[
  'docker build --pull=false --progress=plain --target staffology-proof-evidence --build-arg RAILWAY_GIT_COMMIT_SHA="${CIRCLE_SHA1}" --output "type=local,dest=/tmp/circleci-runtime-artifacts/staffology" . 2>&1 | tee /tmp/circleci-runtime-artifacts/staffology-proof-build.log',
  'docker build --pull=false --progress=plain --build-arg RAILWAY_GIT_COMMIT_SHA="${CIRCLE_SHA1}" -t "vector-forge-ci:${CIRCLE_SHA1}" . 2>&1 | tee /tmp/circleci-runtime-artifacts/runtime-image-build.log',
  'docker build --pull=false --progress=plain -f Dockerfile.current-candidate-role-browser-proof -t "$AUTH_IMAGE" . 2>&1 | tee /tmp/circleci-runtime-artifacts/auth-client-image-build.log'
 ]);
 const packagingStart=circle.indexOf('          name: Verify exact proof client image module packaging');
 const packagingEnd=circle.indexOf('          name: Verify runtime security boundary',packagingStart);
 assert.ok(packagingStart>=0&&packagingEnd>packagingStart,'proof-client packaging must precede runtime security checks');
 const packaging=circle.slice(packagingStart,packagingEnd);
 assert.match(packaging,/^[ \t]*test "\$\(git rev-parse HEAD\)" = "\$\{CIRCLE_SHA1\}"[ \t]*$/m);
 assert.match(packaging,/^[ \t]*AUTH_IMAGE="vector-role-auth-ci:\$\{CIRCLE_SHA1\}"[ \t]*$/m);
 assert.match(packaging,/^[ \t]*docker image inspect "\$AUTH_IMAGE" >[ \t]*\/tmp\/circleci-runtime-artifacts\/auth-client-image-inspect\.json[ \t]*$/m);
 const smokeRuns=packaging.split('\n').map(line=>line.trim()).filter(line=>/^docker run\s/.test(line));
 assert.deepEqual(smokeRuns,[
  'docker run --rm --network=none --entrypoint node "$AUTH_IMAGE" --version 2>&1 | tee /tmp/circleci-runtime-artifacts/auth-client-image-node-version.txt',
  'docker run --rm --network=none --entrypoint node \\'
 ]);
 const packagingLines=packaging.split('\n').map(line=>line.trim());
 assert.ok(packagingLines.includes('-e PROOF_SOURCE_SHA="${CIRCLE_SHA1}" '+String.fromCharCode(92)),'smoke source must bind to current checkout');
 for(const [binding,file]of[
  ['PROOF_CLIENT_BLOB','scripts/current-candidate-role-browser-proof.mjs'],
  ['PROOF_WRAPPER_BLOB','scripts/current-candidate-role-browser-proof-server.mjs'],
  ['PROOF_RESULT_BLOB','scripts/vector-proof-result.mjs'],
  ['PROOF_AUTH_BLOB','security/runtime/proof-runner-auth.cjs']
 ]){
  assert.ok(packagingLines.includes(`-e ${binding}="$(git rev-parse HEAD:${file})" `+String.fromCharCode(92)),`current checkout blob required: ${binding}`);
  assert.ok(packagingLines.some(line=>line.replace(/,$/,'')===`["${file}", "${binding}"]`),`copied module binding required: ${binding}`);
 }
 assert.match(packaging,/^[ \t]*"\$AUTH_IMAGE" --input-type=module -e '[ \t]*$/m);
 assert.match(packaging,/^[ \t]*import auth from "\/proof\/security\/runtime\/proof-runner-auth\.cjs";[ \t]*$/m);
 assert.match(packaging,/^[ \t]*assert\.equal\(blob, process\.env\[binding\], "Copied source mismatch: " \+ file\);[ \t]*$/m);
 assert.match(packaging,/^[ \t]*assert\.equal\(auth\.PROOF_RUNNER_PATH, "\/api\/proof-runner\/session"\);[ \t]*$/m);
 assert.match(packaging,/^[ \t]*assert\.equal\(auth\.canonicalAssertion\(/m);
 assert.match(packaging,/^[ \t]*import \{ DatabaseSync \} from "node:sqlite";[ \t]*$/m);
 assert.match(packaging,/^[ \t]*assert\.equal\(db\.prepare\("SELECT 1 AS available"\)\.get\(\)\.available, 1\);[ \t]*$/m);
 assert.match(packaging,/^[ \t]*console\.log\(JSON\.stringify\(\{ scope: "PACKAGING_MODULE_SMOKE_ONLY"/m);
 assert.match(packaging,/^[ \t]*console\.log\(JSON\.stringify\([^\n]+signedSessionExecuted: false, chromiumExecuted: false, hostedProof: false/m);
 assert.match(circle,/tee \/tmp\/circleci-runtime-artifacts\/staffology-proof-build\.log/);
 assert.match(circle,/tee \/tmp\/circleci-runtime-artifacts\/runtime-image-build\.log/);
 assert.match(circle,/-e WFM_CANDIDATE_SHA="\$\{CIRCLE_SHA1\}"/);
 assert.match(circle,/api\/runtime-identity >\/tmp\/runtime-identity\.json/);
 assert.match(circle,/body\.sourceBinding!=="build-file-matched"/);
 assert.match(circle,/x-wfm-source-sha: \$\{CIRCLE_SHA1\}/);
 assert.match(circle,/x-wfm-source-binding: build-file-matched/);
 assert.doesNotMatch(circle,/docker exec vector-forge-proof id -u/);
 assert.match(circle,/docker exec vector-forge-proof cat \/proc\/1\/status \| bash scripts\/verify-runtime-process-uid\.sh/);
 for(const check of ['health-ready','runtime-identity-build-file-matched','root-page','bootstrap-unauthenticated-401','demand-unauthenticated-401'])assert.match(circle,new RegExp(`passed ${check}`));
 assert.match(circle,/hosted-http-diagnostics\.log/);
 assert.match(dockerfile,/tests\/runtime-process-uid\.test\.cjs/);
});

for(const file of staffologyRuntimeModules)test('runtime packaging refuses an omitted reviewed module: '+file,()=>{
 const actual=readFileSync(resolve(__dirname,'../../../Dockerfile'),'utf8');
 assert.throws(()=>assertRuntimePackaging(actual.replace(staffologyWorkspaceCopy,staffologyWorkspaceCopy.replace('integrations/staffology/'+file+' ',''))),/exact six reviewed Staffology modules/);
});
for(const [name,mutate]of[
 ['unreviewed additional module',source=>source.replace(staffologyWorkspaceCopy,staffologyWorkspaceCopy.replace(' /workspace/',' integrations/staffology/unreviewed.cjs /workspace/'))],
 ['wrong destination',source=>source.replace(staffologyWorkspaceCopy,staffologyWorkspaceCopy.replace('/workspace/integrations/staffology/','/app/integrations/staffology/'))],
 ['duplicate workspace COPY',source=>source.replace(staffologyWorkspaceCopy,staffologyWorkspaceCopy+'\n'+staffologyWorkspaceCopy)],
 ['module copy after composition',source=>source.replace(staffologyWorkspaceCopy,'').replace(' && rm -rf /workspace',' && rm -rf /workspace\n'+staffologyWorkspaceCopy)],
 ['missing composition',source=>source.replace(composeRuntime,'RUN true '+String.fromCharCode(92))],
 ['missing workspace compiler patcher',source=>source.replace(composerWorkspaceCopy,composerWorkspaceCopy.replace(' scripts/patch-workspace-compiler.mjs',''))],
 ['workspace removed before composition',source=>source.replace(' && rm -rf /workspace','').replace(composeRuntime,' && rm -rf /workspace\n'+composeRuntime)]
])test('runtime packaging refuses '+name,()=>{
 const actual=readFileSync(resolve(__dirname,'../../../Dockerfile'),'utf8');assert.throws(()=>assertRuntimePackaging(mutate(actual)),/exact six|must precede|exactly one/);
});

test('hosted caller binds configured candidate to the independently read sealed build file',()=>{
 const exact='1'.repeat(40),other='2'.repeat(40);
 const matched=createRuntimeIdentity({env:{WFM_HOSTED_STAGING:'true',WFM_CANDIDATE_SHA:exact},readFileSync:path=>{assert.equal(path,'/app/.wfm-build-source-sha');return exact+'\n';}});
 const response={statusCode:0,headers:new Map(),setHeader(name,value){this.headers.set(name.toLowerCase(),String(value));},end(value){this.body=value;}};
 matched.applyResponseHeaders(response);assert.equal(matched.handleRequest({method:'GET',url:'/api/runtime-identity'},response),true);
 assert.deepEqual(JSON.parse(response.body),{schemaVersion:1,candidateSha:exact,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false});
 assert.equal(response.headers.get('x-wfm-source-sha'),exact);assert.equal(response.headers.get('x-wfm-source-binding'),'build-file-matched');
 assert.throws(()=>createRuntimeIdentity({env:{WFM_HOSTED_STAGING:'true',WFM_CANDIDATE_SHA:other},readFileSync:()=>exact+'\n'}),/WFM_RUNTIME_IDENTITY_SHA_MISMATCH/);
});
