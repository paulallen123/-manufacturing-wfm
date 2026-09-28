import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-27-0050-sap-successfactors.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='sap-successfactors')?.patch;

test('SAP SuccessFactors evidence remains documentation-only and read-only',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/OAuth/i);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('SAP SuccessFactors pins company, regional endpoint and consumer identity',()=>{
  for(const dimension of [
    'wfm-tenant','connection','SuccessFactors-company','consumer','api-origin','api-version','entity','query-mode','schema'
  ]) assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  assert.match(patch.regionalApiVersions,/data cent|region|exact.*host/i);
  assert.match(patch.reconciliation,/consumer/i);
});

test('SAP SuccessFactors preserves effective history and legitimate multiple assignments',()=>{
  assert.equal(patch.effectiveDatedWorkforceAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.effectiveDatedWorkforceAuthority.deletionAuthority,false);
  assert.equal(patch.effectiveDatedWorkforceAuthority.writeBackAuthority,false);
  assert.equal(patch.effectiveDatedWorkforceAuthority.payrollAuthority,false);
  assert.match(patch.reconciliation,/person.*employment.*assignment/i);
  assert.match(patch.reconciliation,/sequence/i);
});

test('SAP SuccessFactors records effective-date, delta and pagination recovery semantics',()=>{
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/cursor|next/i);
  assert.match(patch.paginationDeltaEventsFilesQueues.delta,/lastModifiedDateTime/i);
  assert.match(patch.paginationDeltaEventsFilesQueues.delta,/effective-dated|period-based/i);
  assert.match(patch.reconciliation,/absence.*deletion|missing.*deletion/i);
  assert.match(patch.failureModes.join(' '),/purge|retention/i);
});

test('SAP SuccessFactors maps workforce value and names the real proof step',()=>{
  for(const object of [
    'people','employments','job-assignments','organisations','skills-and-qualifications',
    'work-schedules','time-and-absence','compensation-reference'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueReview.customerValue.join(' '),/skill|absence|overtime|labour/i);
  assert.match(patch.nextBuildAction,/authorised SAP SuccessFactors/i);
});
