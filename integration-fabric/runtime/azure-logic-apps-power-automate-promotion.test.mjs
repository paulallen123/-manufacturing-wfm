import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Azure Logic Apps and Power Automate is promoted with run plus delivery reconciliation and no workflow mutation authority',async()=>{
 const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-1216-azure-logic-apps-power-automate.json',import.meta.url),'utf8'));
 assert.equal(overlay.schemaVersion,1);
 assert.equal(overlay.systems.length,0);
 assert.equal(overlay.overrides.length,1);
 const provider=overlay.overrides[0];
 assert.equal(provider.id,'azure-logic-apps-power-automate');
 assert.equal(provider.patch.researchStatus,'docs-verified');
 assert.equal(provider.patch.testLevel,'spec-verified');
 assert.equal(provider.patch.writeEnabled,false);
 assert.equal(provider.patch.workflowRunReconciliation.providerRunSuccessSufficient,false);
 assert.equal(provider.patch.workflowRunReconciliation.downstreamDeliveryReceiptRequired,true);
 assert.equal(provider.patch.workflowRunReconciliation.checkpointAdvanceAllowed,false);
 assert.equal(provider.patch.workflowRunReconciliation.workflowMutationAuthority,false);
 assert.equal(provider.patch.workflowRunReconciliation.workflowResubmitAuthority,false);
 assert.equal(provider.patch.workflowRunReconciliation.connectionMutationAuthority,false);
 assert.ok(provider.patch.evidenceSources.length>=10);
 assert.ok(provider.patch.evidenceSources.every(source=>source.url.startsWith('https://learn.microsoft.com/')));
 assert.ok(provider.patch.dataObjects.includes('workflow-run-actions'));
 assert.ok(provider.patch.canonicalObjects.includes('integration-delivery-signal'));
 assert.match(provider.patch.evidenceNote,/No Azure subscription/i);
 assert.match(provider.patch.nextBuildAction,/authorised Azure Logic Apps/i);
});
