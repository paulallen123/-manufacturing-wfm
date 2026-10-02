'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createRuntimeIdentity}=require('../../../security/runtime/runtime-identity.cjs');

test('supported Docker admission composes and binds the strict full canonical runtime',()=>{
 const dockerfile=readFileSync(resolve(__dirname,'../../../Dockerfile'),'utf8');
 const proof=dockerfile.slice(dockerfile.indexOf('AS autonomy-proof'),dockerfile.indexOf('# Customer-proof staging build'));
 assert.match(proof,/node scripts\/compose-vector-local-runtime\.mjs \/proof\/staffology-full-runtime/);
 assert.match(proof,/CANONICAL_SOURCE_DIR=\/proof/);
 assert.match(proof,/WFM_RUNTIME=\/proof\/staffology-full-runtime/);
 assert.match(proof,/STAFFOLOGY_RUNTIME_MODE=full/);
 assert.match(proof,/WFM_BUILD_SOURCE_SHA="\$RAILWAY_GIT_COMMIT_SHA"/);
 assert.match(proof,/STAFFOLOGY_PRIVATE_EVIDENCE_DIR=\/proof\/staffology-private-artifacts/);
 assert.match(proof,/set \+e; CANONICAL_SOURCE_DIR=\/proof/);
 assert.match(proof,/cat \/proof\/staffology-private-artifacts\/staffology-full\.tap; exit \$status/);
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
 assert.match(runtime,/COPY integrations\/staffology\/staffology-adapter\.cjs integrations\/staffology\/canonical-runtime-bridge\.cjs integrations\/staffology\/canonical-production-boundaries\.cjs integrations\/staffology\/canonical-operations\.cjs \/workspace\/integrations\/staffology\//);
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

test('hosted caller binds configured candidate to the independently read sealed build file',()=>{
 const exact='1'.repeat(40),other='2'.repeat(40);
 const matched=createRuntimeIdentity({env:{WFM_HOSTED_STAGING:'true',WFM_CANDIDATE_SHA:exact},readFileSync:path=>{assert.equal(path,'/app/.wfm-build-source-sha');return exact+'\n';}});
 const response={statusCode:0,headers:new Map(),setHeader(name,value){this.headers.set(name.toLowerCase(),String(value));},end(value){this.body=value;}};
 matched.applyResponseHeaders(response);assert.equal(matched.handleRequest({method:'GET',url:'/api/runtime-identity'},response),true);
 assert.deepEqual(JSON.parse(response.body),{schemaVersion:1,candidateSha:exact,sourceBinding:'build-file-matched',fixtureOnly:true,productionApproved:false,pilotReady:false});
 assert.equal(response.headers.get('x-wfm-source-sha'),exact);assert.equal(response.headers.get('x-wfm-source-binding'),'build-file-matched');
 assert.throws(()=>createRuntimeIdentity({env:{WFM_HOSTED_STAGING:'true',WFM_CANDIDATE_SHA:other},readFileSync:()=>exact+'\n'}),/WFM_RUNTIME_IDENTITY_SHA_MISMATCH/);
});
