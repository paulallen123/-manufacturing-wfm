import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-27-0334-maintainx.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='maintainx')?.patch;

test('MaintainX is promoted only to documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/bearer.*API key/i);
  assert.match(patch.evidenceNote,/No Premium or Enterprise tenant|No customer tenant/i);
});

test('MaintainX pins one organization and exact poll scope',()=>{
  for(const dimension of [
    'wfm-tenant','connection','MaintainX-organization','api-origin','api-version','resource',
    'pagination-mode','query','schema'
  ]) assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  assert.equal(patch.mutablePollWindowAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.mutablePollWindowAuthority.deletionAuthority,false);
  assert.equal(patch.mutablePollWindowAuthority.writeBackAuthority,false);
});

test('MaintainX records and fails closed on pagination-contract disagreement',()=>{
  const evidence=[patch.paginationDeltaEventsFilesQueues.pagination,...patch.failureModes].join(' ');
  assert.match(evidence,/polling guide.*offset/i);
  assert.match(evidence,/OpenAPI.*cursor/i);
  assert.match(patch.schemaDrift,/pagination.*runtime|runtime.*pagination/i);
});

test('MaintainX webhooks remain signed hints with polling recovery',()=>{
  assert.match(patch.paginationDeltaEventsFilesQueues.events,/HMAC.*SHA-?256/i);
  assert.match(patch.paginationDeltaEventsFilesQueues.events,/hint/i);
  assert.match(patch.reconciliation,/webhook.*poll|poll.*webhook/i);
  assert.equal(patch.mutablePollWindowAuthority.attendanceAuthority,false);
  assert.equal(patch.mutablePollWindowAuthority.payrollAuthority,false);
});

test('MaintainX maps maintenance constraints to workforce and production value',()=>{
  for(const object of [
    'assets','asset-status-and-downtime','work-orders','work-order-assignees','work-order-time-and-labour-cost',
    'parts-and-inventory','purchase-orders','meters-and-readings','root-cause-reports'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueReview.customerValue.join(' '),/downtime|labour|maintenance|overtime/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/work order.*attendance|attendance.*work order/i);
});

test('MaintainX names an authorised tenant and denied mutations as next proof',()=>{
  assert.match(patch.nextBuildAction,/authorised MaintainX Premium or Enterprise test tenant/i);
  assert.match(patch.nextBuildAction,/denied mutation|denied write/i);
  assert.match(patch.nextBuildAction,/pagination/i);
  assert.match(patch.nextBuildAction,/multi-organization|multi-organisation/i);
});
