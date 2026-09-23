#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const c=JSON.parse(fs.readFileSync(new URL('../release/completion-rehearsal-contract.json',import.meta.url),'utf8'));
assert.equal(c.schemaVersion,1);
assert.equal(c.name,'VECTOR_FINISH_LINE_REHEARSAL_V1');
assert.equal(c.principles.rehearseAsFinishedProduct,true);
assert.equal(c.principles.simulationNeverCountsAsProof,true);
assert.equal(c.principles.actualBlockersAndSimulatedRisksAreSeparated,true);
assert.equal(c.principles.simulatePastCurrentBlocker,true);
assert.equal(c.principles.affectedScopeDoesNotStopUnrelatedCapabilities,true);
assert.equal(c.principles.futureStagesContinueInDiagnosticMode,true);
assert.ok(Array.isArray(c.completionStages)&&c.completionStages.length>=9);
assert.ok(Array.isArray(c.finishedCustomerJourney)&&c.finishedCustomerJourney.length>=12);
assert.ok(Array.isArray(c.scenarioCatalogue)&&c.scenarioCatalogue.length>=15);
for(const s of c.scenarioCatalogue){
  assert.ok(s.id&&Array.isArray(s.applies)&&s.applies.length&&s.expected,s.id||'scenario');
}
console.log('VECTOR_FINISH_LINE_REHEARSAL_CONTRACT=PASS stages='+c.completionStages.length+' scenarios='+c.scenarioCatalogue.length);
