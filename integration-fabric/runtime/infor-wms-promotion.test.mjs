import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Infor WMS overlay promotes the existing provider without claiming a live connection',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-0700-infor-wms.json',import.meta.url),'utf8'));
  assert.equal(overlay.systems.length,0);
  assert.equal(overlay.overrides.length,1);
  const entry=overlay.overrides[0];
  assert.equal(entry.id,'infor-wms');
  assert.equal(entry.patch.researchStatus,'docs-verified');
  assert.equal(entry.patch.testLevel,'spec-verified');
  assert.equal(entry.patch.writeEnabled,false);
  assert.match(entry.patch.evidenceUrl,/^https:\/\/docs\.infor\.com\/wms\//);
  assert.ok(entry.patch.evidenceSources.length>=5);
  assert.ok(entry.patch.evidenceSources.every(source=>source.url.startsWith('https://docs.infor.com/')));
  assert.equal(entry.patch.eventSnapshotRecovery.checkpointAdvanceAllowed,false);
  assert.equal(entry.patch.eventSnapshotRecovery.deletionAuthority,false);
  assert.equal(entry.patch.eventSnapshotRecovery.writeBackAuthority,false);
  assert.ok(entry.patch.dataObjects.includes('warehouse-labour-tasks-and-timesheets'));
  assert.ok(entry.patch.canonicalObjects.includes('work-assignment'));
  assert.match(entry.patch.evidenceNote,/No sandbox/i);
  assert.match(entry.patch.nextBuildAction,/authorised Infor WMS test tenant/i);
});
