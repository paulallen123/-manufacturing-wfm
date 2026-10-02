// Reproduce the existing Dockerfile's runtime assembly for isolated local proof.
// No package install, external connection, credential access or deployment occurs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'candidate-runtime'));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inputs = new Map();
const recordInput = file => { inputs.set(file, sha256(fs.readFileSync(path.join(root, file)))); };
const sealedExpected = {
  'server.cjs': '1792f544d0fea25577f683f3df957b4f74b6a086cd0479b24b1fe77f58587dd0',
  'lib/outbound-integration.cjs': '7e7b3126ac7fdd5712fc5fc7299e3c75893bc699f7ed200dbba29b914c2bf9d4',
  'lib/transactional-outbound-bridge.cjs': '52f890d30bde3e657e8e95d2f4db25d075ebdc8c8cf3be3bd4331b40c072e81f'
};
function validateSealedRuntime(runtime) {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(runtime, 'PACKAGE_MANIFEST_SHA256.json'), 'utf8'));
  const runtimeManifestBytes = fs.readFileSync(path.join(runtime, 'RUNTIME_MANIFEST.json'));
  if (sha256(runtimeManifestBytes) !== packageManifest.files?.['RUNTIME_MANIFEST.json']) throw Error('SEALED_RUNTIME_MANIFEST_DIGEST_CHANGED');
  const runtimeManifest = JSON.parse(runtimeManifestBytes);
  if (Object.keys(runtimeManifest).length !== 133) throw Error('SEALED_RUNTIME_MANIFEST_COVERAGE_CHANGED');
  for (const [relative, digest] of Object.entries(sealedExpected)) {
    if (sha256(fs.readFileSync(path.join(runtime, relative))) !== digest) throw Error('SEALED_SOURCE_DRIFT: ' + relative);
    if (runtimeManifest[relative] !== digest) throw Error('SEALED_MANIFEST_MISMATCH: ' + relative);
  }
}
function composeStaffology(runtime) {
  validateSealedRuntime(runtime);
  const integrationDir = path.join(runtime, 'integrations', 'staffology');
  fs.mkdirSync(integrationDir, {recursive: true});
  for (const file of ['staffology-adapter.cjs', 'canonical-runtime-bridge.cjs', 'canonical-production-boundaries.cjs', 'canonical-operations.cjs']) {
    const source = `integrations/staffology/${file}`;
    recordInput(source);
    fs.copyFileSync(path.join(root, source), path.join(integrationDir, file));
  }
  const serverPath = path.join(runtime, 'server.cjs');
  let server = fs.readFileSync(serverPath, 'utf8');
  const importAnchor = "const IG=require('./lib/integration-gateway.cjs')";
  if (server.split(importAnchor).length !== 2) throw Error('SERVER_INTEGRATION_IMPORT_ANCHOR_CHANGED');
  server = server.replace(importAnchor, "const StaffologyIntegration=require('./integrations/staffology/canonical-runtime-bridge.cjs');\nconst StaffologyBoundaries=require('./integrations/staffology/canonical-production-boundaries.cjs');\nconst StaffologyOperations=require('./integrations/staffology/canonical-operations.cjs');\n" + importAnchor);
  const runtimeAnchor = 'outboundSenders=new Map(outboundConfigs.map(cfg=>[cfg.id,OI.createRestSender(cfg)]));';
  if (server.split(runtimeAnchor).length !== 2) throw Error('SERVER_INTEGRATION_CONSTRUCTION_ANCHOR_CHANGED');
  server = server.replace(runtimeAnchor, runtimeAnchor + "\nconst resolveStaffologyPrincipal=({tenant,email})=>{const row=db.prepare('SELECT email,tenant,person_id,permissions FROM users WHERE email=? AND tenant=?').get(email,tenant);if(!row)return null;return {email:row.email,tenant:row.tenant,personId:row.person_id,permissions:JSON.parse(row.permissions)};};\nconst staffologyBoundaries=StaffologyBoundaries.createBoundaries({db,resolvePrincipal:resolveStaffologyPrincipal});\nconst staffologyIntegration=StaffologyIntegration.createRuntime({loadState:load,productionBoundaries:staffologyBoundaries,stagePeople:(actor,envelope,receipt)=>{const cfg=inboundConnectorConfigs.find(row=>row.id===receipt.connectorId&&row.tenant===actor.tenant&&String(row.provider).toLowerCase()==='staffology'&&row.objectTypes.includes('people'));E.assert(cfg,'Reviewed Staffology people connector is unavailable.',503);return integrations.stage(cfg,envelope,receipt.idempotencyKey,(objectType,record)=>prepareInboundIntegration(objectType,record,cfg));}});\nconst staffologyOperationProfile=StaffologyOperations.loadConfiguration(process.env);\nconst staffologyOperations=StaffologyOperations.createOperations({runtime:staffologyIntegration,boundaries:staffologyBoundaries,profile:staffologyOperationProfile,audit:(actor,action,detail)=>db.prepare('INSERT INTO audit_events(tenant,actor,action,detail,created_at) VALUES(?,?,?,?,?)').run(actor.tenant,actor.personId,action,JSON.stringify(detail),new Date().toISOString())});");
  const reportAnchor = 'return json(res,200,{...report,jobs:providerJobs.report(a)';
  if (server.split(reportAnchor).length !== 2) throw Error('SERVER_INTEGRATION_REPORT_ANCHOR_CHANGED');
  server = server.replace(reportAnchor, 'return json(res,200,{...report,staffology:{...staffologyIntegration.status(),operation:staffologyOperations.status(a)},jobs:providerJobs.report(a)');
  const routeAnchor = "if(url.pathname==='/api/integrations'&&req.method==='GET')";
  if (server.split(routeAnchor).length !== 2) throw Error('SERVER_INTEGRATION_ROUTE_ANCHOR_CHANGED');
  server = server.replace(routeAnchor, "if(url.pathname==='/api/integrations/staffology/employees/acquire-stage'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.acquireAndStage(a,input));}\nif(url.pathname==='/api/integrations/staffology/payroll/approve-deliver'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.approveAndDeliver(a,input));}\nif(url.pathname==='/api/integrations/staffology/payroll/recover'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.recover(a,input));}\nif(url.pathname==='/api/integrations/staffology/payroll/readback'&&req.method==='POST'){const input=await body(req);return json(res,200,await staffologyOperations.readback(a,input));}\n" + routeAnchor);
  const payrollCommandAnchor = "if(input.command.startsWith('review-')||input.command.startsWith('payroll-'))";
  if (server.split(payrollCommandAnchor).length !== 2) throw Error('SERVER_PAYROLL_COMMAND_ANCHOR_CHANGED');
  server = server.replace(payrollCommandAnchor, "if(input.command==='time-source-ingest')return P.openPeriodFromSource(state,a,p);" + payrollCommandAnchor);
  const permissionAnchor = "new Set(['company.configure','payroll.view','payroll.export','payroll.reopen','payroll.remind'])";
  if (server.split(permissionAnchor).length !== 2) throw Error('SERVER_ACCOUNT_PERMISSION_ANCHOR_CHANGED');
  server = server.replace(permissionAnchor, "new Set(['company.configure','payroll.view','payroll.export','payroll.reopen','payroll.remind','time.ingest'])");
  fs.writeFileSync(serverPath, server);
  const receipt = {
    schemaVersion: 1,
    sealedRuntimePreserved: true,
    activationAvailable: false,
    sourceHashes: sealedExpected,
    assembledFiles: {
      adapter: sha256(fs.readFileSync(path.join(integrationDir, 'staffology-adapter.cjs'))),
      bridge: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-runtime-bridge.cjs'))),
      productionBoundaries: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-production-boundaries.cjs'))),
      operations: sha256(fs.readFileSync(path.join(integrationDir, 'canonical-operations.cjs'))),
      server: sha256(fs.readFileSync(serverPath))
    }
  };
  fs.writeFileSync(path.join(runtime, 'STAFFOLOGY_ASSEMBLY.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
recordInput('scripts/compose-vector-local-runtime.mjs');
if (fs.existsSync(output)) {
  console.log(JSON.stringify(composeStaffology(output), null, 2));
  process.exit(0);
}
const archive = path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
recordInput('artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const expected = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expected) throw Error('RUNTIME_ARTIFACT_HASH_MISMATCH');
const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (names.some(name => path.isAbsolute(name) || name.split('/').includes('..'))) throw Error('UNSAFE_ARCHIVE_PATH');
fs.mkdirSync(output, { recursive: true });
execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', output]);
const run = (file, args = []) => { recordInput(file); return execFileSync(process.execPath, [path.join(root, file), ...args], { stdio: 'inherit' }); };
const publicRoot = path.join(output, 'public');
run('scripts/retire-legacy-presentation.mjs', [publicRoot]);
run('scripts/harden-attendance-integrity.mjs', [publicRoot]);
const copy = (source, destination) => { recordInput(source); const target = path.join(output, destination); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, source), target); };
const groups = {
  security: ['bootstrap.cjs', 'runtime-identity.cjs', 'identity-survival-guard.cjs', 'proof-runner-auth.cjs', 'passkey-schema.cjs', 'passkey-auth.cjs', 'passkey-entry.html', 'passkey-ui.js', 'passkey-ui.css', 'package.json', 'package-lock.json', 'hosted-listen-guard.cjs', 'hosted-application-user-guard.cjs', 'owner-access-recovery.cjs', 'durable-state-guard.cjs', 'retired-presentation.cjs'],
  integration: ['autonomous-integration-hub.cjs', 'gusto-company-connector.cjs', 'gusto-oauth-landing.cjs'],
  implementation: [
    'one-day-enterprise-engine.cjs', 'one-day-enterprise-engine-core.cjs',
    'agents-api-adapter.cjs', 'agents-api-bootstrap-route.cjs', 'implementation-work-controller.cjs',
    'readiness-evidence-contract.cjs', 'configuration-inference-engine.cjs',
    'implementation-digital-twin.cjs', 'tenant-environment-provisioner.cjs'
  ],
  learning: [
    'adaptive-learning-engine.cjs', 'training-workflow-manifest.cjs',
    'training-twin.cjs', 'training-scenario-engine.cjs',
    'training-delivery-service.cjs', 'training-video-contract.cjs',
    'training-artifact-registry.cjs', 'training-regeneration-planner.cjs'
  ],
  operations: [
    'workflow-action-evidence-contract.cjs', 'workflow-action-evidence-bridge.cjs',
    'decision-episode.cjs', 'customer-demand-intelligence.cjs',
    'absence-recovery-shadow.cjs', 'demand-decision-service.cjs',
    'decision-outcome-proof.cjs', 'realtime-event-service.cjs',
    'autopilot-execution-engine.cjs', 't9-customer-guardian.cjs',
    'manufacturing-scheduling-engine.cjs', 'manufacturing-demand-forecast.cjs',
    'schedule-attendance-reconciliation.cjs', 'scheduling-intelligence-service.cjs'
  ],
  reporting: ['vector-reporting-service.cjs'],
  trust: ['vector-trust-spine.cjs']
};
for (const [group, files] of Object.entries(groups)) for (const file of files) copy(`${group}/runtime/${file}`, `${group}-runtime/${file}`);
composeStaffology(output);
// Copy the lockfile-installed dependency closure; never install from the proof process.
const securityDependencies = path.join(root, 'security/runtime/node_modules');
if (!fs.existsSync(path.join(securityDependencies, '@simplewebauthn/server/package.json'))) throw Error('PASSKEY_DEPENDENCIES_MISSING: run npm ci --prefix security/runtime --ignore-scripts before composing proof.');
fs.cpSync(securityDependencies, path.join(output, 'security-runtime/node_modules'), {recursive:true,dereference:true});
copy('security/runtime/passkey-session-ui.js', 'public/passkey-session-ui.js');
copy('operations/runtime/workforce-lifecycle-guard.cjs', 'operations-runtime/workforce-lifecycle-core.cjs');
copy('operations/runtime/workforce-lifecycle-router.cjs', 'operations-runtime/workforce-lifecycle-guard.cjs');
copy('ux-overlay/vector-workflows.js', 'public/vector-workflows.js');
const read = file => { recordInput(file); return fs.readFileSync(path.join(root, file), 'utf8'); };
const css = '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(publicRoot, 'factory-control-ui.css'), 'utf8') + '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.css') + '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.css') + '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.css') + read('ux-overlay/vector-workflows.css') + '\n/* VECTOR_REPORTING_UI_V1 */\n' + read('reporting/ui/vector-reporting-ui.css');
const js = "'use strict';\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n" + '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.js') + '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.js') + '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.js') + '\n;/* VECTOR_REPORTING_UI_V1 */\n' + read('reporting/ui/vector-reporting-ui.js');
fs.writeFileSync(path.join(publicRoot, 'vector-ui.css'), css);
fs.writeFileSync(path.join(publicRoot, 'vector-ui.js'), js);
run('scripts/compose-vector-presentation.mjs', [publicRoot]);
const entryPath=path.join(publicRoot,'index.html');
fs.writeFileSync(entryPath,fs.readFileSync(entryPath,'utf8').replace('</head>','<script src="/passkey-session-ui.js" defer></script></head>'));
for (const file of ['factory-control-ui.js', 'factory-control-ui.css', 'value-cockpit-ui.js', 'value-cockpit-ui.css', 'review-ui.js', 'review-ui.css', 'ui-evolution.css', 'vector-shell.js']) fs.rmSync(path.join(publicRoot, file), { force: true });
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-ui.js')]);
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-workflows.js')]);
// Bootstrap has existing absolute /app imports. A local-only resolver maps those exact
// paths to this proof directory without modifying the application or the host's /app.
fs.writeFileSync(path.join(output, 'local-paths.cjs'), "'use strict';const M=require('node:module'),p=require('node:path'),old=M._resolveFilename;M._resolveFilename=function(s,...a){return old.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};const fs=require('node:fs'),read=fs.readFileSync;fs.readFileSync=function(s,...a){return read.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};\n");
const sourceInputs = [...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => ({ path: file, sha256: hash }));
const runtimeFiles = [];
function inventory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inventory(file);
    else if (entry.isFile()) runtimeFiles.push({ path: path.relative(output, file).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(file)) });
    else throw Error('UNEXPECTED_RUNTIME_FILE_TYPE: ' + file);
  }
}
inventory(output);
runtimeFiles.sort((a, b) => a.path.localeCompare(b.path));
fs.writeFileSync(path.join(output, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify({
  schemaVersion: 1,
  sourceCommit: null,
  purpose: 'Actual local composition bytes; no inferred commit identity. Docker admission stages are not rerun. Not hosted proof.',
  node: process.version,
  artifactSha256: expected,
  sourceSetSha256: sha256(JSON.stringify(sourceInputs)),
  runtimeSetSha256: sha256(JSON.stringify(runtimeFiles)),
  sourceInputs,
  runtimeFiles
}, null, 2) + '\n');
console.log('VECTOR_LOCAL_RUNTIME=' + output);
console.log('Start with: WFM_DB=<isolated sqlite path> PORT=4100 node --require ' + path.join(output, 'local-paths.cjs') + ' ' + path.join(output, 'security-runtime/bootstrap.cjs'));
