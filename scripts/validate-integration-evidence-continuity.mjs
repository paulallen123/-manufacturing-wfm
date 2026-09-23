#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { loadCatalog, loadResearchDeltas } from '../integration-fabric/scripts/load-catalog.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../integration-fabric/evidence-continuity.json',import.meta.url),'utf8'));
const catalog=loadCatalog();
const deltas=loadResearchDeltas().filter(delta=>String(delta.source||'').startsWith('research-overlays/'));
const byId=new Map(catalog.systems.map(system=>[system.id,system]));

assert.equal(manifest.schemaVersion,1);
assert.equal(manifest.contract,'VECTOR_INTEGRATION_EVIDENCE_CONTINUITY_V1');
assert.ok(deltas.length>=manifest.minimumOverlayFiles,
  'Integration evidence continuity regression: overlays='+deltas.length+' required>='+manifest.minimumOverlayFiles);
assert.ok(catalog.systems.length>=manifest.minimumEffectiveSystems,
  'Effective integration catalog shrank below continuity floor.');

const missing=[];
for(const id of manifest.requiredProviders||[]) if(!byId.has(id)) missing.push(id);
assert.deepEqual(missing,[],'Required provider evidence lost during convergence: '+missing.join(', '));

for(const [id,expected] of Object.entries(manifest.requiredPromotions||{})){
  const actual=byId.get(id)?.testLevel;
  assert.equal(actual,expected,'Provider promotion drifted: '+id+' expected='+expected+' actual='+actual);
}

for(const family of manifest.requiredProtocolFamilies||[]){
  assert.ok(catalog.protocolFamilies.includes(family),'Required protocol family lost: '+family);
}

const proof={
  contract:manifest.contract,
  overlayFiles:deltas.length,
  effectiveSystems:catalog.systems.length,
  requiredProviders:(manifest.requiredProviders||[]).length,
  requiredPromotions:Object.keys(manifest.requiredPromotions||{}).length,
  protocolFamilies:catalog.protocolFamilies.length,
  result:'PASS'
};
console.log('VECTOR_INTEGRATION_EVIDENCE_CONTINUITY='+JSON.stringify(proof));
