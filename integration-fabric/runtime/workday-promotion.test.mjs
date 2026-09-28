import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Workday is hardened with bounded worker exports and no worker or payroll mutation authority',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-28-1445-workday.json',import.meta.url),'utf8'));
  assert.equal(overlay.schemaVersion,1);
  assert.deepEqual(overlay.systems,[]);
  assert.deepEqual(overlay.protocolFamilies,[]);
  assert.deepEqual(overlay.overrides.map(item=>item.id),['workday']);
  const provider=overlay.overrides[0].patch;
  assert.equal(provider.researchStatus,'docs-verified');
  assert.equal(provider.testLevel,'spec-verified');
  assert.equal(provider.writeEnabled,false);
  assert.equal(provider.workdayWorkerEvidenceAuthority.completedExportRequired,true);
  assert.equal(provider.workdayWorkerEvidenceAuthority.exactSourceWindowRequired,true);
  assert.equal(provider.workdayWorkerEvidenceAuthority.effectiveDatedSnapshotRequired,true);
  assert.equal(provider.workdayWorkerEvidenceAuthority.rawWorkerIdsReturned,false);
  assert.equal(provider.workdayWorkerEvidenceAuthority.workerMutationAuthority,false);
  assert.equal(provider.workdayWorkerEvidenceAuthority.payrollAuthority,false);
  assert.equal(provider.workdayWorkerEvidenceAuthority.attendanceAuthority,false);
  assert.equal(provider.workdayWorkerEvidenceAuthority.writeBackAuthority,false);
  assert.ok(provider.evidenceSources.length>=8);
  assert.ok(provider.evidenceSources.every(source=>{
    const host=new URL(source.url).hostname;
    return host==='developer.workday.com'||host==='doc.workday.com'||host==='community-content.workday.com'||host==='community.workday.com';
  }));
  assert.ok(provider.canonicalObjects.includes('worker-assignment-source-identity'));
  assert.match(provider.evidenceNote,/No Workday tenant|No customer|No live/i);
  assert.match(provider.nextBuildAction,/authorised Workday/i);
});
