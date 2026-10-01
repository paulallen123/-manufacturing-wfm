'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');

test('supported Docker admission composes and binds the strict full canonical runtime',()=>{
 const dockerfile=readFileSync(resolve(__dirname,'../../../Dockerfile'),'utf8');
 const proof=dockerfile.slice(dockerfile.indexOf('AS autonomy-proof'),dockerfile.indexOf('# Customer-proof staging build'));
 assert.match(proof,/node scripts\/compose-vector-local-runtime\.mjs \/proof\/staffology-full-runtime/);
 assert.match(proof,/CANONICAL_SOURCE_DIR=\/proof/);
 assert.match(proof,/WFM_RUNTIME=\/proof\/staffology-full-runtime/);
 assert.match(proof,/STAFFOLOGY_RUNTIME_MODE=full/);
 assert.match(proof,/integrations\/staffology\/\*\.test\.cjs/);
 assert.match(proof,/independent\/succession-regressions\.test\.cjs/);
 assert.match(proof,/independent\/current-authority-recovery-held-out\.test\.cjs/);
 assert.match(proof,/independent\/full-http-employee-journey\.test\.cjs/);
 assert.ok(proof.indexOf('npm ci --prefix security/runtime')<proof.indexOf('compose-vector-local-runtime.mjs'),'composition must use the preceding exact locked dependency installation');
});
