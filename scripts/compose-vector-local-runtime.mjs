// Reproduce the existing Dockerfile's runtime assembly for isolated local proof.
// No package install, external connection, credential access or deployment occurs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, 'candidate-runtime'));
if (fs.existsSync(output)) throw Error('OUTPUT_EXISTS: choose a new empty output directory; existing source is never overwritten.');
const archive = path.join(root, 'artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz');
const expected = '3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d';
if (crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex') !== expected) throw Error('RUNTIME_ARTIFACT_HASH_MISMATCH');
const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
if (names.some(name => path.isAbsolute(name) || name.split('/').includes('..'))) throw Error('UNSAFE_ARCHIVE_PATH');
fs.mkdirSync(output, { recursive: true });
execFileSync('tar', ['--no-same-owner', '-xzf', archive, '-C', output]);
const run = (file, args = []) => execFileSync(process.execPath, [path.join(root, file), ...args], { stdio: 'inherit' });
const publicRoot = path.join(output, 'public');
run('scripts/retire-legacy-presentation.mjs', [publicRoot]);
const copy = (source, destination) => { const target = path.join(output, destination); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, source), target); };
const groups = {
  security: ['bootstrap.cjs', 'identity-survival-guard.cjs', 'hosted-listen-guard.cjs', 'owner-access-recovery.cjs'],
  integration: ['autonomous-integration-hub.cjs'],
  implementation: ['one-day-enterprise-engine.cjs', 'one-day-enterprise-engine-core.cjs', 'readiness-evidence-contract.cjs', 'configuration-inference-engine.cjs'],
  learning: ['adaptive-learning-engine.cjs'],
  operations: ['workflow-action-evidence-contract.cjs', 'workflow-action-evidence-bridge.cjs']
};
for (const [group, files] of Object.entries(groups)) for (const file of files) copy(`${group}/runtime/${file}`, `${group}-runtime/${file}`);
copy('operations/runtime/workforce-lifecycle-guard.cjs', 'operations-runtime/workforce-lifecycle-core.cjs');
copy('operations/runtime/workforce-lifecycle-router.cjs', 'operations-runtime/workforce-lifecycle-guard.cjs');
copy('ux-overlay/vector-workflows.js', 'public/vector-workflows.js');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = '/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + fs.readFileSync(path.join(publicRoot, 'factory-control-ui.css'), 'utf8') + '\n/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.css') + '\n/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.css') + '\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.css') + read('ux-overlay/vector-workflows.css');
const js = "'use strict';\n/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n" + '\n;/* WFM_ADAPTIVE_COACH_BEGIN */\n' + read('learning/ui/adaptive-coach.js') + '\n;/* WFM_IMPLEMENTATION_JOURNEY_VERSION_D_BEGIN */\n' + read('implementation/ui/implementation-journey.js') + '\n;/* VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1 */\n' + read('ux-overlay/vector-shell.js');
fs.writeFileSync(path.join(publicRoot, 'vector-ui.css'), css);
fs.writeFileSync(path.join(publicRoot, 'vector-ui.js'), js);
run('scripts/compose-vector-presentation.mjs', [publicRoot]);
for (const file of ['factory-control-ui.css', 'value-cockpit-ui.js', 'value-cockpit-ui.css', 'review-ui.js', 'review-ui.css', 'ui-evolution.css', 'vector-shell.js']) fs.rmSync(path.join(publicRoot, file), { force: true });
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-ui.js')]);
execFileSync(process.execPath, ['--check', path.join(publicRoot, 'vector-workflows.js')]);
// Bootstrap has existing absolute /app imports. A local-only resolver maps those exact
// paths to this proof directory without modifying the application or the host's /app.
fs.writeFileSync(path.join(output, 'local-paths.cjs'), "'use strict';const M=require('node:module'),p=require('node:path'),old=M._resolveFilename;M._resolveFilename=function(s,...a){return old.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};const fs=require('node:fs'),read=fs.readFileSync;fs.readFileSync=function(s,...a){return read.call(this,typeof s==='string'&&s.startsWith('/app/')?p.join(__dirname,s.slice(5)):s,...a)};\n");
fs.writeFileSync(path.join(output, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify({ sourceCommit: '6667f4217e0c0a8a90cab8d4c7d79f8efd628662', artifactSha256: expected, purpose: 'Local runtime assembly. Docker admission stages are not rerun. Not hosted proof.', workflowSha256: crypto.createHash('sha256').update(read('ux-overlay/vector-workflows.js')).digest('hex') }, null, 2) + '\n');
console.log('VECTOR_LOCAL_RUNTIME=' + output);
console.log('Start with: WFM_DB=<isolated sqlite path> PORT=4100 node --require ' + path.join(output, 'local-paths.cjs') + ' ' + path.join(output, 'security-runtime/bootstrap.cjs'));
