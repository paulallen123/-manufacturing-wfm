import {readFileSync, readdirSync} from 'node:fs';
import {join, posix, relative, resolve, sep} from 'node:path';
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
  const listedPaths = new Set();
  for (const entry of manifest.runtimeFiles) {
    assert.equal(typeof entry.path, 'string', 'Runtime path must be a string');
    assert.ok(entry.path && !entry.path.includes('\\') && !entry.path.startsWith('/') && posix.normalize(entry.path) === entry.path && !entry.path.startsWith('../'), 'Non-normalized runtime path: ' + entry.path);
    assert.ok(!listedPaths.has(entry.path), 'Duplicate runtime path: ' + entry.path);
    listedPaths.add(entry.path);
    const file = resolve(root, entry.path);
    assert.ok(file.startsWith(root + sep), 'Runtime file outside composition');
    assert.equal(sha256(readFileSync(file)), entry.sha256, 'Runtime changed: ' + entry.path);
  }
  const actualPaths = [];
  function inventory(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const file = join(directory, entry.name);
      const runtimePath = relative(root, file).split(sep).join('/');
      if (entry.isDirectory()) inventory(file);
      else if (entry.isFile()) {
        if (runtimePath !== 'LOCAL_PROOF_PROVENANCE.json') actualPaths.push(runtimePath);
      } else {
        assert.fail('Unexpected runtime file type: ' + runtimePath);
      }
    }
  }
  inventory(root);
  assert.deepEqual([...listedPaths].sort(), actualPaths.sort(), 'Runtime inventory does not match actual files');
  return {
    artifactSha256: manifest.artifactSha256,
    sourceSetSha256: manifest.sourceSetSha256,
    runtimeSetSha256: manifest.runtimeSetSha256,
    verifiedRuntimeFiles: manifest.runtimeFiles.length,
    assets: manifest.runtimeFiles.filter(entry => /^public\/vector-(ui\.(js|css)|workflows\.js)$/.test(entry.path))
  };
}
