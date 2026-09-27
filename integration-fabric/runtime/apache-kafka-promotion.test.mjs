import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Apache Kafka is promoted with bounded read reconciliation and no commit or mutation authority',async()=>{
 const overlay=JSON.parse(await readFile(new URL('../research-overlays/2026-09-27-1112-apache-kafka.json',import.meta.url),'utf8'));
 assert.equal(overlay.schemaVersion,1);assert.ok(Array.isArray(overlay.protocolFamilies));assert.equal(overlay.systems.length,0);assert.equal(overlay.overrides.length,1);
 const p=overlay.overrides[0];assert.equal(p.id,'apache-kafka');assert.equal(p.patch.researchStatus,'docs-verified');assert.equal(p.patch.testLevel,'spec-verified');assert.equal(p.patch.writeEnabled,false);
 assert.match(p.patch.docsUrl,/\/43\//);assert.equal(p.patch.partitionOffsetWindow.documentedClientVersion,'4.3.1');
 assert.equal(p.patch.partitionOffsetWindow.isolationLevel,'read_committed');assert.equal(p.patch.partitionOffsetWindow.manualAssignmentRequired,true);assert.equal(p.patch.partitionOffsetWindow.enableAutoCommit,false);
 assert.equal(p.patch.partitionOffsetWindow.offsetGapsAllowed,true);assert.equal(p.patch.partitionOffsetWindow.topicUuidRequired,true);assert.equal(p.patch.partitionOffsetWindow.clientAndBrokerCompatibilityBound,true);assert.equal(p.patch.partitionOffsetWindow.offsetCommitAuthority,false);assert.equal(p.patch.partitionOffsetWindow.checkpointAdvanceAllowed,false);
 assert.ok(p.patch.evidenceSources.length>=7);assert.ok(p.patch.evidenceSources.every(x=>x.url.startsWith('https://kafka.apache.org/')));
 assert.ok(p.patch.dataObjects.includes('topic-partition-offset-observations'));assert.ok(p.patch.canonicalObjects.includes('source-batch'));
 assert.match(p.patch.evidenceNote,/No Apache Kafka cluster/i);assert.match(p.patch.nextBuildAction,/authorised non-production Kafka cluster/i);
});
