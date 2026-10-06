import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const harnesses=[
  'scripts/live-role-browser-context-proof.mjs',
  'scripts/live-role-rendered-ui-proof.mjs',
  'scripts/live-role-control-inventory-proof.mjs',
  'scripts/live-role-accessibility-diagnostic.mjs'
];

test('full role browser harnesses use signed Ed25519 proof sessions and never password login',()=>{
  for(const relative of harnesses){
    const source=fs.readFileSync(path.join(root,relative),'utf8');
    assert.doesNotMatch(source,/\/api\/login/);
    assert.doesNotMatch(source,/const password\s*=\s*process\.env\.WFM_STAGING_PASSWORD/);
    assert.match(source,/signedProofSession/);
    assert.match(source,/vector-customer-ready-candidate-production\.up\.railway\.app/);
  }
  const helper=fs.readFileSync(path.join(root,'scripts/signed-proof-session.mjs'),'utf8');
  assert.match(helper,/VECTOR_PROOF_RUNNER_V1/);
  assert.match(helper,/\/api\/proof-runner\/session/);
  assert.match(helper,/PROOF_PRIVATE_KEY_B64/);
  assert.doesNotMatch(helper,/\/api\/login/);
});
