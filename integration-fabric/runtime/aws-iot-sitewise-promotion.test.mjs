import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('AWS IoT SiteWise overlay promotes the existing provider without claiming a live connection',async()=>{
  const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-0846-aws-iot-sitewise.json',import.meta.url),'utf8'));
  assert.equal(overlay.systems.length,0);assert.equal(overlay.overrides.length,1);
  const entry=overlay.overrides[0];assert.equal(entry.id,'aws-iot-sitewise');
  assert.equal(entry.patch.researchStatus,'docs-verified');assert.equal(entry.patch.testLevel,'spec-verified');assert.equal(entry.patch.writeEnabled,false);
  assert.ok(entry.patch.evidenceSources.length>=7);assert.ok(entry.patch.evidenceSources.every(source=>source.url.startsWith('https://docs.aws.amazon.com/')));
  assert.equal(entry.patch.industrialSampleWindow.checkpointAdvanceAllowed,false);
  assert.equal(entry.patch.industrialSampleWindow.operationalDecisionAuthority,false);
  assert.equal(entry.patch.industrialSampleWindow.writeBackAuthority,false);
  assert.equal(entry.patch.industrialSampleWindow.providerWindowSemantics,'exclusive-start/inclusive-end');
  assert.equal(entry.patch.industrialSampleWindow.canonicalWindowSemantics,'inclusive-start/exclusive-end');
  assert.equal(entry.patch.industrialSampleWindow.batchSuccessEntryIdRequired,true);
  assert.equal(entry.patch.industrialSampleWindow.maximumBatchEntriesPerAuthority,1);
  assert.equal(entry.patch.industrialSampleWindow.batchEntryIdPattern,'^[A-Za-z0-9_-]{1,64}$');
  assert.deepEqual(entry.patch.industrialSampleWindow.nullValueTypes,['B','D','S','I','U']);
  assert.deepEqual(entry.patch.regionalEndpointAuthority.fipsDataRegions.sort(),['ca-central-1','us-east-1','us-east-2','us-gov-west-1','us-west-2']);
  assert.equal(entry.patch.regionalEndpointAuthority.customPortsAllowed,false);
  assert.ok(entry.patch.dataObjects.includes('asset-property-time-series'));
  assert.ok(entry.patch.canonicalObjects.includes('energy-observation'));
  assert.match(entry.patch.evidenceNote,/No sandbox/i);assert.match(entry.patch.nextBuildAction,/authorised AWS test account/i);
});
