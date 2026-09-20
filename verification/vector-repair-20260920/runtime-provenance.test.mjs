import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
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
