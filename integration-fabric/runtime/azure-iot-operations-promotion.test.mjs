import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Azure IoT Operations is promoted with key-frame recovery and no completeness or control authority',async()=>{
 const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-1321-azure-iot-operations.json',import.meta.url),'utf8'));
 assert.equal(overlay.schemaVersion,1);assert.equal(overlay.systems.length,0);assert.equal(overlay.overrides.length,1);
 const provider=overlay.overrides[0];assert.equal(provider.id,'azure-iot-operations');
 assert.equal(provider.patch.researchStatus,'docs-verified');assert.equal(provider.patch.testLevel,'spec-verified');assert.equal(provider.patch.writeEnabled,false);
 assert.equal(provider.patch.keyframeReconciliation.stateSnapshotCandidate,true);
 assert.equal(provider.patch.keyframeReconciliation.sourceCompletenessProven,false);
 assert.equal(provider.patch.keyframeReconciliation.deliveryCompletenessProven,false);
 assert.equal(provider.patch.keyframeReconciliation.checkpointAdvanceAllowed,false);
 assert.equal(provider.patch.keyframeReconciliation.controlAuthority,false);
 assert.equal(provider.patch.keyframeReconciliation.writeBackAuthority,false);
 assert.ok(provider.patch.evidenceSources.length>=10);assert.ok(provider.patch.evidenceSources.every(source=>source.url.startsWith('https://learn.microsoft.com/')));
 assert.ok(provider.patch.dataObjects.includes('opc-ua-keyframes'));
 assert.ok(provider.patch.canonicalObjects.includes('industrial-state-snapshot-candidate'));
 assert.match(provider.patch.evidenceNote,/No Azure subscription/i);assert.match(provider.patch.nextBuildAction,/authorised Azure IoT Operations/i);
});
