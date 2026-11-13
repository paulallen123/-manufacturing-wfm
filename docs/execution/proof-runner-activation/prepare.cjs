'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const launcher = require('./launcher.cjs');

const sourceRoot = path.resolve(process.argv[2] || process.cwd());
const out = path.resolve(process.argv[3] || path.join(__dirname, 'generated'));
launcher.validateRunnerSource();
const files = Object.keys(launcher.FILES).map(file => ({ path: file, base64: fs.readFileSync(path.join(sourceRoot, file)).toString('base64') }));
const compressed = zlib.gzipSync(Buffer.from(JSON.stringify({ schema: 1, source: launcher.SOURCE, files })), { level: 9 });
const payload = compressed.toString('base64');
const bundleHash = launcher.hash(compressed);
launcher.validateBundle(payload, bundleHash);
const script = fs.readFileSync(path.join(__dirname, 'launcher.cjs'), 'utf8') + '\nmodule.exports.run(' + JSON.stringify(payload) + ',' + JSON.stringify(bundleHash) + ').catch(error=>{console.error("VECTOR_PROOF_RUNNER_START_FAILED="+error.message);process.exitCode=1;});\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
// The launcher must not become PID 1: its detached proof descendants need a
// subreaper to collect orphans before process-group disappearance is asserted.
// An absent binary fails before Node reads proof authority. Binary trust is
// an exact-image review prerequisite.
// Railway image start commands use exec form, so the first token must be the
// executable itself, not a shell builtin that requires an implicit shell.
const command = '/usr/bin/tini -s -- node -e ' + quote(script);
if (Buffer.byteLength(command) > 90000) throw new Error('START_COMMAND_TOO_LARGE');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ payload, bundleHash }) + '\n');
fs.writeFileSync(path.join(out, 'start-command.txt'), command + '\n');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ schema: 1, source: launcher.SOURCE,
  scope: 'existing isolated signed browser runner; prepared, not activated',
  runnerSource: launcher.SOURCE, intendedReviewedTargetSha: null,
  sourceCommitBinding: launcher.SOURCE, reviewedBaseSha: '76c5f4d32910d6cac6d347cfff9917dd93301ffb',
  activationBlocked: 'Published source binding only; exact-image different-UID proc denial, in-flight capability expiry/revocation and cleanup review, /usr/bin/tini availability and trust, no-init orphan reaping, effective Railway start-chain parity, independent code/security/artifact review, approved target and protected bindings remain required before hosted activation',
  runnerSourceValidation: 'run rejects unpublished, non-lowercase-40-hex and all-zero SOURCE before identity fetch, materialization, SQLite, npm or child startup; review and exact commit/file matching remain owner gates',
  targetSelection: 'explicit WFM_EXPECTED_CANDIDATE_SHA from reviewed deployment configuration; never inferred from response or runner source',
  preflight: { endpoint: '/api/runtime-identity', unauthenticated: true, beforeInstallAndSigner: true, timeoutMs: launcher.PREFLIGHT_TIMEOUT_MS, maximumBytes: launcher.MAX_IDENTITY_BYTES, redirects: 'error', requires: ['exact configured target SHA', 'build-file-matched', 'fixtureOnly:true', 'productionApproved:false', 'pilotReady:false'] },
  serviceId: 'f84fe27d-af17-451c-b164-54dfef6b6a4b', bundleSha256: bundleHash,
  startCommandSha256: launcher.hash(Buffer.from(command + '\n')), startCommandBytes: Buffer.byteLength(command),
  installerEnvironment: 'minimal transport/CA/path/locale allowlist; committed exact npm lock and two-package closure; proof and provider credentials excluded',
  proofChildEnvironment: 'UID/GID 65534, separate writable home and process group, read-only root-owned code, explicit proof/browser/transport allowlist plus bounded loopback signer capability; shared close completion, hard deadline retained through descendant cleanup, distinct immediate deadline KILL, signal-failure terminal outcome, delete only after verified group exit, private key and unrelated authority excluded',
  browserProcessEnvironment: 'explicit operational/transport allowlist; signer, password, proof bindings, Node/loader hooks and unknown inputs excluded',
  playwright: '1.63.0', image: 'mcr.microsoft.com/playwright:v1.63.0-noble', files: launcher.FILES,
  proof: { materializationOnly: true, hosted: false, provider: false, customer: false },
  pending: ['normal target staged-change application', 'verified target startup and serving identity',
    'protected signer/public-key matching', 'persisted actors and tenant/run/configuration bindings',
    'independent artifact asset digests', 'existing runner activation and real browser proof',
    'retained redacted screenshots and traces'] }, null, 2) + '\n');
console.log(JSON.stringify({ bundleSha256: bundleHash, startCommandBytes: Buffer.byteLength(command), source: launcher.SOURCE }));
