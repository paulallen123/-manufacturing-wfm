import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('UKG Pro WFM and HCM are hardened with replay plus snapshot recovery and no workforce authority',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-28-1337-ukg-pro-webhooks.json',import.meta.url),'utf8'));
  assert.equal(overlay.schemaVersion,1);
  assert.deepEqual(overlay.systems,[]);
  assert.deepEqual(overlay.protocolFamilies,[]);
  assert.deepEqual(overlay.overrides.map(item=>item.id).sort(),['ukg-pro-hcm','ukg-pro-wfm']);
  for(const provider of overlay.overrides){
    assert.equal(provider.patch.researchStatus,'docs-verified');
    assert.equal(provider.patch.testLevel,'spec-verified');
    assert.equal(provider.patch.writeEnabled,false);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.failedOnlyReplayRequired,true);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.completeFallbackSnapshotRequired,true);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.rawSourceIdsReturned,false);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.replayAuthority,false);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.payrollAuthority,false);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.attendanceAuthority,false);
    assert.equal(provider.patch.webhookReplaySnapshotAuthority.writeBackAuthority,false);
    assert.ok(provider.patch.evidenceSources.length>=10);
    assert.ok(provider.patch.evidenceSources.every(source=>source.url.startsWith('https://developer.ukg.com/')));
    assert.ok(provider.patch.canonicalObjects.includes('provider-delivery-diagnostic'));
    assert.match(provider.patch.evidenceNote,/No UKG tenant|No customer|No live/i);
    assert.match(provider.patch.nextBuildAction,/authorised UKG/i);
  }
});
