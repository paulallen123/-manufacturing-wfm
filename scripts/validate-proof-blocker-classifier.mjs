#!/usr/bin/env node
import assert from 'node:assert/strict';
import {classifyProofBlocker} from './classify-proof-blocker.mjs';

const cases=[
  ['PROVIDER_DEGRADED','runner_id=0 no runner allocated before execution'],
  ['MISSING_PROOF_DEPENDENCY',"ENOENT: no such file or directory, open '/proof/missing.json'"],
  ['SECURITY_INVARIANT','not ok 7 - cross-tenant payroll authority isolation failed'],
  ['EVIDENCE_OR_CATALOG_DRIFT','not ok 8 - integration-fabric canonicalTargets expected protocol evidence'],
  ['STALE_PROOF_CONTRACT','AssertionError expected Odoo version but actual provider documentation changed'],
  ['MISSING_EVIDENCE','PROOF_REQUIRED exact hosted evidence unavailable'],
  ['PRODUCT_REGRESSION','not ok 10 - calculation result failed']
];
for(const [expected,log] of cases) assert.equal(classifyProofBlocker(log).blockerClass,expected,log);
assert.equal(classifyProofBlocker('Build Failed without useful evidence').blockerClass,'UNKNOWN_FAIL_CLOSED');
console.log('VECTOR_PROOF_BLOCKER_CLASSIFIER=PASS cases='+cases.length);
