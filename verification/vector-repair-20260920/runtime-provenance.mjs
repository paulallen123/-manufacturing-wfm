import {readFileSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const sha256 = data => createHash('sha256').update(data).digest('hex');

// Run before launching the engine. A stale or edited runtime cannot inherit old proof.
export function verifiedRuntimeProvenance(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(join(root, 'LOCAL_PROOF_PROVENANCE.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1, 'Unsupported runtime provenance');
  assert.ok(manifest.runtimeFiles?.length > 0, 'Runtime file inventory required');
  assert.equal(sha256(JSON.stringify(manifest.runtimeFiles)), manifest.runtimeSetSha256, 'Runtime inventory digest mismatch');
  assert.equal(sha256(JSON.stringify(manifest.sourceInputs)), manifest.sourceSetSha256, 'Source inventory digest mismatch');
  for (const entry of manifest.runtimeFiles) {
    const file = resolve(root, entry.path);
    assert.ok(file.startsWith(root + sep), 'Runtime file outside composition');
    assert.equal(sha256(readFileSync(file)), entry.sha256, 'Runtime changed: ' + entry.path);
  }
  return {
    artifactSha256: manifest.artifactSha256,
    sourceSetSha256: manifest.sourceSetSha256,
    runtimeSetSha256: manifest.runtimeSetSha256,
    verifiedRuntimeFiles: manifest.runtimeFiles.length,
    assets: manifest.runtimeFiles.filter(entry => /^public\/vector-(ui\.(js|css)|workflows\.js)$/.test(entry.path))
  };
}
