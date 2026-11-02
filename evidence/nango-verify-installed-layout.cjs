'use strict';
// Local handoff proof of the exact new composer hook, not a complete image build.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { loadLibrary } = require('../test-support/sealed-nango-broker.cjs');
const root = path.resolve(__dirname, '..');
const runtime = path.dirname(loadLibrary());
const source = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
const hook = source.match(/^function composeNangoMetadata\(runtime, server\) \{[\s\S]*?^\}/m);
assert.ok(hook);
const inputs = [];
const invoke = vm.compileFunction('return (' + hook[0] + ')(runtime, server);', ['runtime', 'server'], {
  parsingContext: vm.createContext({ fs, path, root, recordInput: relative => inputs.push(relative) })
});
const server = invoke(runtime, fs.readFileSync(path.join(runtime, 'server.cjs'), 'utf8'));
new vm.Script(server, { filename: 'nango-hook-composed-server.cjs' });
fs.writeFileSync(path.join(runtime, 'server.cjs'), server);
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = hash(fs.readFileSync(path.join(root, 'integration/runtime/nango-credential-provider.cjs')));
const installedHash = hash(fs.readFileSync(path.join(runtime, 'integration-runtime/nango-credential-provider.cjs')));
assert.equal(installedHash, sourceHash);
assert.deepEqual(inputs, ['integration/runtime/nango-credential-provider.cjs']);
console.log('# exact-hook-installed-resolver-sha256 ' + installedHash);
console.log('# exact-hook-composed-server-sha256 ' + hash(server));
console.log('# proof-scope: exact new hook and installed module; complete composer and Docker image not executed');
process.env.VECTOR_NANGO_RUNTIME_ROOT = path.join(runtime, 'integration-runtime');
process.env.VECTOR_NANGO_BROKER_ROOT = path.join(runtime, 'lib');
require('../integration/runtime/nango-credential-provider.test.cjs');
require('../integration/runtime/nango-metadata-broker.test.cjs');
