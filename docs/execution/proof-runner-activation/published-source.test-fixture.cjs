'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Test-only local rebind keeps downstream boundary tests executable while the
// actual candidate and generated command remain blocked as unpublished.
// No environment option or production runtime bypass selects this fixture.
module.exports = function publishedSourceFixture(root = __dirname) {
  const sha = 'f'.repeat(40);
  const original = fs.readFileSync(path.join(root, 'launcher.cjs'), 'utf8');
  const source = original.replace(/^const SOURCE = '[^']+';$/m, "const SOURCE = '" + sha + "';");
  const originalBundle = JSON.parse(fs.readFileSync(path.join(root, 'generated/bundle.json')));
  const unpacked = JSON.parse(zlib.gunzipSync(Buffer.from(originalBundle.payload, 'base64')));
  unpacked.source = sha;
  const bytes = zlib.gzipSync(Buffer.from(JSON.stringify(unpacked)));
  const bundle = { payload: bytes.toString('base64'), bundleHash: crypto.createHash('sha256').update(bytes).digest('hex') };
  const script = source + '\nmodule.exports.run(' + JSON.stringify(bundle.payload) + ',' + JSON.stringify(bundle.bundleHash) + ').catch(error=>{console.error("VECTOR_PROOF_RUNNER_START_FAILED="+error.message);process.exitCode=1;});\n';
  const command = "node -e '" + script.replaceAll("'", "'\\''") + "'\n";
  return { source, bundle, command };
};
