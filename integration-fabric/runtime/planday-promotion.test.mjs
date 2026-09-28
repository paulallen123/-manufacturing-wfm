import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const url=new URL('../research-overlays/2026-09-27-0209-planday.json',import.meta.url);
const overlay=fs.existsSync(url)?JSON.parse(fs.readFileSync(url,'utf8')):{overrides:[]};
const patch=overlay.overrides.find(entry=>entry.id==='planday')?.patch;

test('Planday is promoted only to documentation-backed read-only evidence',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.auth,/OAuth/i);
  assert.match(patch.evidenceNote,/No demo portal|No customer portal/i);
});

test('Planday pins portal, site, department, route, time zone and query scope',()=>{
  for(const dimension of [
    'wfm-tenant','connection','Planday-portal','site','department','api-origin','api-version',
    'resource','query','schema','IANA-time-zone'
  ]) assert.ok(patch.sourceScope.requiredDimensions.includes(dimension),dimension);
  assert.equal(patch.shiftTimeAuthority.checkpointAdvanceAllowed,false);
  assert.equal(patch.shiftTimeAuthority.payrollAuthority,false);
  assert.equal(patch.shiftTimeAuthority.writeBackAuthority,false);
});

test('Planday records OAuth, pagination and portal/client rate boundaries',()=>{
  assert.match(patch.paginationDeltaEventsFilesQueues.pagination,/50.*page|page.*50/i);
  assert.match(patch.rateLimits,/20.*portal.*100.*client/i);
  assert.match(patch.rateLimits,/750.*portal.*2,?000.*client/i);
  assert.match(patch.retriesReconnect,/x-ratelimit-reset/i);
  assert.match(patch.failureModes.join(' '),/one-hour|1-hour/i);
});

test('Planday preserves DST-safe shifts and overlap evidence without payroll authority',()=>{
  assert.match(patch.reconciliation,/local wall.*UTC.*offset|UTC.*local wall.*offset/i);
  assert.match(patch.reconciliation,/ambiguous|nonexistent/i);
  assert.match(patch.reconciliation,/overlap/i);
  assert.equal(patch.shiftTimeAuthority.attendanceAuthority,false);
  assert.equal(patch.shiftTimeAuthority.deletionAuthority,false);
});

test('Planday maps workforce and cost value while excluding unsupported cost assumptions',()=>{
  for(const object of [
    'people','departments','employee-groups','contract-rules','shifts','shift-types',
    'punch-clock-shifts','absence-accounts-and-balances','time-and-cost','payroll-reference'
  ]) assert.ok(patch.dataObjects.includes(object),object);
  assert.match(patch.valueReview.customerValue.join(' '),/overtime|absence|labour-cost|schedule/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/daily.*weekly supplements|payroll/i);
});

test('Planday names an authorised demo or customer portal as the next proof step',()=>{
  assert.match(patch.nextBuildAction,/authorised Planday demo(?: or customer)? portal|authorised Planday customer portal/i);
  assert.match(patch.nextBuildAction,/denied mutation|denied write/i);
  assert.match(patch.nextBuildAction,/DST|ambiguous/i);
});
