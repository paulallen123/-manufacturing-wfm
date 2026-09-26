import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const overlay=JSON.parse(fs.readFileSync(new URL('../research-overlays/2026-09-26-2016-deputy.json',import.meta.url),'utf8'));
const patch=overlay.overrides.find(entry=>entry.id==='deputy')?.patch;

test('Deputy remains documentation-only and mutation-denying',()=>{
  assert.ok(patch);
  assert.equal(patch.testLevel,'spec-verified');
  assert.equal(patch.writeEnabled,false);
  assert.match(patch.evidenceNote,/No trial|No customer tenant/i);
  assert.match(patch.auth,/OAuth/i);
});

test('Deputy OAuth rotation is installation and region bound',()=>{
  assert.equal(patch.rotatingOAuthAuthority.accessTokenTtlSeconds,86400);
  assert.equal(patch.rotatingOAuthAuthority.refreshTokenRotatesOnUse,true);
  assert.equal(patch.rotatingOAuthAuthority.storeWriteAuthority,'compare-and-swap-only');
  assert.deepEqual(patch.rotatingOAuthAuthority.supportedRegions,['AU','EU','UK','US']);
  for(const dimension of ['wfmTenant','connection','installation','region','apiHost','clientRevision','credentialGeneration']){
    assert.ok(patch.rotatingOAuthAuthority.exactScopeDimensions.includes(dimension),dimension);
  }
});

test('Deputy Resource API paging and webhook recovery fail closed',()=>{
  assert.equal(patch.resourceReadAuthority.readViaPostAllowed,true);
  assert.equal(patch.resourceReadAuthority.maximumRecordsPerResponse,500);
  assert.equal(patch.resourceReadAuthority.mutationAuthorityAllowed,false);
  assert.equal(patch.webhookAuthority.recordAuthority,false);
  assert.equal(patch.webhookAuthority.deletionAuthority,false);
  assert.match(patch.reconciliation,/overlap|re-query/i);
});

test('Deputy maps workforce operations without claiming payroll or production authority',()=>{
  for(const object of ['employees','rosters-and-shifts','timesheets','leave-and-availability','payroll-ready-time-and-cost','locations-and-areas']){
    assert.ok(patch.dataObjects.includes(object),object);
  }
  assert.match(patch.valueReview.customerValue.join(' '),/overtime|labour|payroll/i);
  assert.match(patch.valueReview.constraintsRisks.join(' '),/production|payroll/i);
  assert.match(patch.nextBuildAction,/authorised Deputy trial/i);
});
