import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Paylocity is promoted with stable payroll coverage and no payroll mutation authority',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-28-1203-paylocity.json',import.meta.url),'utf8'));
  assert.equal(overlay.schemaVersion,1);
  assert.deepEqual(overlay.systems,[]);
  assert.deepEqual(overlay.protocolFamilies,[]);
  assert.equal(overlay.overrides.length,1);
  const provider=overlay.overrides[0];
  assert.equal(provider.id,'paylocity');
  assert.equal(provider.patch.researchStatus,'docs-verified');
  assert.equal(provider.patch.testLevel,'spec-verified');
  assert.equal(provider.patch.writeEnabled,false);
  assert.equal(provider.patch.payrollRunCoverageAuthority.twoStablePassesRequired,true);
  assert.equal(provider.patch.payrollRunCoverageAuthority.exactRosterCoverageRequired,true);
  assert.equal(provider.patch.payrollRunCoverageAuthority.webhookIsHintOnly,true);
  assert.equal(provider.patch.payrollRunCoverageAuthority.payrollAuthority,false);
  assert.equal(provider.patch.payrollRunCoverageAuthority.writeBackAuthority,false);
  assert.ok(provider.patch.evidenceSources.length>=10);
  assert.ok(provider.patch.evidenceSources.every(source=>source.url.startsWith('https://developer.paylocity.com/')||source.url.startsWith('https://www.paylocity.com/')));
  assert.ok(provider.patch.canonicalObjects.includes('payroll-run-observation'));
  assert.match(provider.patch.evidenceNote,/No Paylocity sandbox|No customer|No live/i);
  assert.match(provider.patch.nextBuildAction,/authorised Paylocity sandbox/i);
});
