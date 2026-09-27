import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-27-0110-bamboohr.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='bamboohr')?.patch;

test('BambooHR is promoted only to documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/API-key|OAuth/i);
  assert.match(patch.evidenceNote,/No sandbox|No customer tenant/i);
});

test('BambooHR pins company, route, projection fields and schema',()=>{
  for(const dimension of [
    'wfm-tenant','connection','BambooHR-company','api-origin','api-version','resource',
    'route','method','projection','field-schema'
  ]) assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  assert.equal(patch.fieldProjectionAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.fieldProjectionAuthority.deletionAuthority,false);
  assert.equal(patch.fieldProjectionAuthority.writeBackAuthority,false);
});

test('BambooHR treats POST custom reports as read intent and keeps mutations denied',()=>{
  const reportRoute=patch.connectionRoutes.find(route=>route.type.includes('custom report'));
  assert.ok(reportRoute);
  assert.match(reportRoute.notes,/POST.*read|read.*POST/i);
  assert.match(patch.writeCapability,/denied|no create|no update/i);
  assert.match(patch.permissions.join(' '),/exact.*field|field.*allowlist/i);
});

test('BambooHR preserves restricted-field and cursor completeness semantics',()=>{
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/cursor/i);
  assert.match(patch.reconciliation,/restricted/i);
  assert.match(patch.reconciliation,/absence|deletion/i);
  assert.match(patch.failureModes.join(' '),/silent.*omit|omitted/i);
  assert.match(patch.failureModes.join(' '),/429.*503|503.*429/i);
});

test('BambooHR maps workforce value without treating HR as payroll or presence truth',()=>{
  for(const object of [
    'people','employment-status','departments-and-divisions','job-titles','locations',
    'skills-and-training','time-off','time-tracking','compensation-reference'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueReview.customerValue.join(' '),/skill|absence|overtime|labour/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/payroll|presence/i);
});

test('BambooHR records the exact next live proof step',()=>{
  assert.match(patch.nextBuildAction,/authorised BambooHR/i);
  assert.match(patch.nextBuildAction,/denied mutation|denied write/i);
  assert.match(patch.nextBuildAction,/429.*503|503.*429/i);
});
