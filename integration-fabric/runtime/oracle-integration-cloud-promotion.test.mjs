import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Oracle Integration Cloud is promoted with observation plus delivery reconciliation and no mutation authority',async()=>{
 const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-1028-oracle-integration-cloud.json',import.meta.url),'utf8'));
 assert.equal(overlay.schemaVersion,1);assert.ok(Array.isArray(overlay.protocolFamilies));assert.equal(overlay.systems.length,0);assert.equal(overlay.overrides.length,1);const p=overlay.overrides[0];assert.equal(p.id,'oracle-integration-cloud');
 assert.equal(p.patch.researchStatus,'docs-verified');assert.equal(p.patch.testLevel,'spec-verified');assert.equal(p.patch.writeEnabled,false);
 assert.equal(p.patch.integrationInstanceObservation.providerCompletionSufficient,false);assert.equal(p.patch.integrationInstanceObservation.downstreamDeliveryReceiptRequired,true);
 assert.equal(p.patch.integrationInstanceObservation.checkpointAdvanceAllowed,false);assert.equal(p.patch.integrationInstanceObservation.providerRecoveryAuthority,false);assert.equal(p.patch.integrationInstanceObservation.writeBackAuthority,false);
 assert.ok(p.patch.evidenceSources.length>=8);assert.ok(p.patch.evidenceSources.every(x=>x.url.startsWith('https://docs.oracle.com/')));
 assert.ok(p.patch.dataObjects.includes('integration-instance-observations'));assert.ok(p.patch.canonicalObjects.includes('integration-delivery-signal'));
 assert.match(p.patch.evidenceNote,/No Oracle Integration tenant/i);assert.match(p.patch.nextBuildAction,/authorised Oracle Integration/i);
});
