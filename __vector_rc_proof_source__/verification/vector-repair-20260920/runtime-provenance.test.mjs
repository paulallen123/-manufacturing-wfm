import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, symlinkSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifiedRuntimeProvenance} from './runtime-provenance.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'vector-provenance-test-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const runtimeFiles = [{path: 'server.cjs', sha256: hash('fixture')}];
  const manifest = {schemaVersion: 1, sourceInputs: [], sourceSetSha256: hash('[]'), runtimeFiles, runtimeSetSha256: hash(JSON.stringify(runtimeFiles))};
  writeFileSync(join(root, 'server.cjs'), 'fixture');
  writeFileSync(join(root, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify(manifest));
  return {root, manifest};
}

test('proof accepts matching runtime and refuses a subsequently changed engine', t => {
  const {root} = fixture(t);
  assert.equal(verifiedRuntimeProvenance(root).verifiedRuntimeFiles, 1);
  writeFileSync(join(root, 'server.cjs'), 'different engine');
  assert.throws(() => verifiedRuntimeProvenance(root), /Runtime changed: server.cjs/);
});

test('proof refuses a modified inventory with the old digest', t => {
  const {root, manifest} = fixture(t);
  manifest.runtimeFiles[0].sha256 = hash('different engine');
  writeFileSync(join(root, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify(manifest));
  assert.throws(() => verifiedRuntimeProvenance(root), /Runtime inventory digest mismatch/);
});

test('proof refuses unlisted files that can change runtime semantics', t => {
  const {root} = fixture(t);
  mkdirSync(join(root, 'lib'));
  writeFileSync(join(root, 'lib', 'package.json'), JSON.stringify({type: 'module'}));
  assert.throws(() => verifiedRuntimeProvenance(root), /Runtime inventory does not match actual files/);
});

test('proof refuses duplicate and non-normalized inventory paths', t => {
  const duplicate = fixture(t);
  duplicate.manifest.runtimeFiles.push({...duplicate.manifest.runtimeFiles[0]});
  duplicate.manifest.runtimeSetSha256 = hash(JSON.stringify(duplicate.manifest.runtimeFiles));
  writeFileSync(join(duplicate.root, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify(duplicate.manifest));
  assert.throws(() => verifiedRuntimeProvenance(duplicate.root), /Duplicate runtime path/);

  const nonNormalized = fixture(t);
  nonNormalized.manifest.runtimeFiles[0].path = './server.cjs';
  nonNormalized.manifest.runtimeSetSha256 = hash(JSON.stringify(nonNormalized.manifest.runtimeFiles));
  writeFileSync(join(nonNormalized.root, 'LOCAL_PROOF_PROVENANCE.json'), JSON.stringify(nonNormalized.manifest));
  assert.throws(() => verifiedRuntimeProvenance(nonNormalized.root), /Non-normalized runtime path/);
});

test('proof refuses unlisted symlinks and special entries', t => {
  const {root} = fixture(t);
  symlinkSync('server.cjs', join(root, 'engine-link.cjs'));
  assert.throws(() => verifiedRuntimeProvenance(root), /Unexpected runtime file type/);
});
