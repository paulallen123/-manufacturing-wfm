import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Oracle Maintenance is promoted with dual-pass offset reconciliation and no mutation authority',async()=>{
 const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-1012-oracle-maintenance.json',import.meta.url),'utf8'));
 assert.equal(overlay.systems.length,0);assert.equal(overlay.overrides.length,1);const p=overlay.overrides[0];assert.equal(p.id,'oracle-maintenance');
 assert.equal(p.patch.researchStatus,'docs-verified');assert.equal(p.patch.testLevel,'spec-verified');assert.equal(p.patch.writeEnabled,false);
 assert.equal(p.patch.stableOffsetWindow.requiredPasses,2);assert.equal(p.patch.stableOffsetWindow.checkpointAdvanceAllowed,false);assert.equal(p.patch.stableOffsetWindow.writeBackAuthority,false);
 assert.equal(p.patch.stableOffsetWindow.orderBy,'LastUpdateDate:asc,WorkOrderId:asc');assert.equal(p.patch.stableOffsetWindow.windowSemantics,'inclusive-start/exclusive-end');
 assert.ok(p.patch.evidenceSources.length>=7);assert.ok(p.patch.evidenceSources.every(x=>x.url.startsWith('https://docs.oracle.com/')));
 assert.ok(p.patch.dataObjects.includes('maintenance-work-orders'));assert.ok(p.patch.canonicalObjects.includes('maintenance-signal'));
 assert.match(p.patch.evidenceNote,/No sandbox/i);assert.match(p.patch.nextBuildAction,/authorised Oracle/i);
});
