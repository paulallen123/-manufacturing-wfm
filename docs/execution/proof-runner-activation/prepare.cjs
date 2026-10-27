'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const launcher = require('./launcher.cjs');

const sourceRoot = path.resolve(process.argv[2] || process.cwd());
const out = path.resolve(process.argv[3] || path.join(__dirname, 'generated'));
const files = Object.keys(launcher.FILES).map(file => ({ path: file, base64: fs.readFileSync(path.join(sourceRoot, file)).toString('base64') }));
const compressed = zlib.gzipSync(Buffer.from(JSON.stringify({ schema: 1, source: launcher.SOURCE, files })), { level: 9 });
const payload = compressed.toString('base64');
const bundleHash = launcher.hash(compressed);
launcher.validateBundle(payload, bundleHash);
const script = fs.readFileSync(path.join(__dirname, 'launcher.cjs'), 'utf8') + '\nmodule.exports.run(' + JSON.stringify(payload) + ',' + JSON.stringify(bundleHash) + ').catch(error=>{console.error("VECTOR_PROOF_RUNNER_START_FAILED="+error.message);process.exitCode=1;});\n';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = 'node -e ' + quote(script);
if (Buffer.byteLength(command) > 90000) throw new Error('START_COMMAND_TOO_LARGE');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ payload, bundleHash }) + '\n');
fs.writeFileSync(path.join(out, 'start-command.txt'), command + '\n');
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ schema: 1, source: launcher.SOURCE,
  scope: 'existing isolated signed browser runner; prepared, not activated',
  serviceId: 'f84fe27d-af17-451c-b164-54dfef6b6a4b', bundleSha256: bundleHash,
  startCommandSha256: launcher.hash(Buffer.from(command + '\n')), startCommandBytes: Buffer.byteLength(command),
  playwright: '1.63.0', image: 'mcr.microsoft.com/playwright:v1.63.0-noble', files: launcher.FILES,
  proof: { materializationOnly: true, hosted: false, provider: false, customer: false },
  pending: ['normal target staged-change application', 'verified target startup and serving identity',
    'protected signer/public-key matching', 'persisted actors and tenant/run/configuration bindings',
    'independent artifact asset digests', 'existing runner activation and real browser proof',
    'retained redacted screenshots and traces'] }, null, 2) + '\n');
console.log(JSON.stringify({ bundleSha256: bundleHash, startCommandBytes: Buffer.byteLength(command), source: launcher.SOURCE }));
