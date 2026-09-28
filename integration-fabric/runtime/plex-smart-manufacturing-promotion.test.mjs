import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Plex is promoted with capability-bound read authority and no mutation or plant-control authority',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-28-0717-plex-smart-manufacturing.json',import.meta.url),'utf8'));
  assert.equal(overlay.schemaVersion,1);
  assert.equal(overlay.systems.length,0);
  assert.equal(overlay.overrides.length,1);
  const provider=overlay.overrides[0];
  assert.equal(provider.id,'plex-smart-manufacturing');
  assert.equal(provider.patch.researchStatus,'docs-verified');
  assert.equal(provider.patch.testLevel,'spec-verified');
  assert.equal(provider.patch.writeEnabled,false);
  assert.equal(provider.patch.capabilityEntitlementAuthority.exactCollectionBindingRequired,true);
  assert.equal(provider.patch.capabilityEntitlementAuthority.exactReadOperationAllowlistRequired,true);
  assert.equal(provider.patch.capabilityEntitlementAuthority.mutationAuthority,false);
  assert.equal(provider.patch.capabilityEntitlementAuthority.checkpointAuthority,false);
  assert.ok(provider.patch.evidenceSources.length>=8);
  assert.ok(provider.patch.evidenceSources.every(x=>x.url.startsWith('https://')));
  assert.ok(provider.patch.canonicalObjects.includes('material-readiness-signal'));
  assert.match(provider.patch.evidenceNote,/No Plex customer application/i);
  assert.match(provider.patch.nextBuildAction,/authorised Plex non-production/i);
});
