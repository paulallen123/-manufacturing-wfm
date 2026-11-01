'use strict';
// Bounded local assembly proof, not a full Docker build or running server.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const output = path.resolve(process.argv[3] || path.join(__dirname, 'installed-runtime'));
const hash = value => createHash('sha256').update(value).digest('hex');
const lib = require(path.join(root, 'test-support/sealed-nango-broker.cjs')).loadLibrary();
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.dirname(lib), output, { recursive: true });
const composer = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
const hook = composer.match(/^function composeNangoMetadata\(runtime, server\) \{[\s\S]*?^\}/m);
assert.ok(hook);
const inputs = [];
const install = vm.compileFunction('return (' + hook[0] + ')(runtime, server);', ['runtime', 'server'], {
  parsingContext: vm.createContext({ fs, path, root, recordInput: file => inputs.push({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) }) })
});
const original = fs.readFileSync(path.join(output, 'server.cjs'), 'utf8');
const server = install(output, original);
fs.writeFileSync(path.join(output, 'server.cjs'), server);
const assembly = composer.match(/^const js = [^\r\n]+;/gm);
assert.equal(assembly?.length, 1);
const composed = vm.runInNewContext(assembly[0] + '\njs;', { read: file => fs.readFileSync(path.join(root, file), 'utf8') });
fs.writeFileSync(path.join(output, 'public/vector-ui-composer.js'), composed);
// Replay only the real Dockerfile's printf/cat instructions for vector-ui.js.
const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const lines = docker.split(/\r?\n/).filter(line => /(?:printf|cat) .* >{1,2} \/app\/public\/vector-ui\.js/.test(line));
assert.equal(lines.length, 13);
const prefixes = {
  '/tmp/wfm-learning-ui/': 'learning/ui/', '/tmp/wfm-implementation-ui/': 'implementation/ui/',
  '/tmp/wfm-ux-overlay/': 'ux-overlay/', '/tmp/wfm-reporting-ui/': 'reporting/ui/'
};
let bundled = ''; const bundledInputs = [];
for (const line of lines) {
  const match = line.trim().match(/^&& (printf (?<quote>['"])(?<format>.*)\k<quote>|cat (?<file>[\w/.-]+)) (?<redirect>>{1,2}) \/app\/public\/vector-ui\.js \\$/);
  assert.ok(match, 'Only exact printf/cat assembly instructions are replayed');
  const { format, file: source, redirect } = match.groups;
  if (redirect === '>') { assert.equal(bundled, ''); }
  if (format !== undefined) {
    assert.doesNotMatch(format, /%/);
    bundled += format.replace(/\\n/g, '\n');
  } else {
    const prefix = Object.keys(prefixes).find(key => source.startsWith(key));
    assert.ok(prefix);
    const file = prefixes[prefix] + source.slice(prefix.length), bytes = fs.readFileSync(path.join(root, file));
    bundled += bytes.toString('utf8'); bundledInputs.push({ path: file, sha256: hash(bytes) });
  }
}
assert.equal(bundledInputs.length, 6);
fs.writeFileSync(path.join(output, 'public/vector-ui.js'), bundled);
assert.doesNotThrow(() => new vm.Script(server));
assert.doesNotThrow(() => new vm.Script(bundled));
const start = "if(url.pathname==='/api/integrations/discovery/broker-preview'&&req.method==='POST'){";
const end = "if(url.pathname==='/api/integrations/discovery/preview'&&req.method==='POST'){";
const controller = text => text.slice(text.indexOf(start), text.indexOf(end));
assert.equal(controller(server), controller(original));
const receipt = {
  sourceRef: 'cbc5bce85e8a380e89d3b1e670e86a73a50890c2', node: process.version,
  scope: 'Exact composer metadata hook plus actual composer and Docker printf/cat bundle expressions; no full build, sanitation, HTTP listener, live provider or credentials',
  originalServerSha256: hash(original), composedServerSha256: hash(server),
  previewControllerSha256: hash(controller(server)), previewControllerBytesUnchanged: true,
  installedInputs: inputs, bundleInputs: bundledInputs,
  composerBundleSha256: hash(composed), dockerAssemblyBundleSha256: hash(bundled),
  output: path.relative(root, output)
};
fs.writeFileSync(path.join(output, '../installed-assembly-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
