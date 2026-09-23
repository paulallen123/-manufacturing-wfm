#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { loadCatalog, loadResearchDeltas } from '../integration-fabric/scripts/load-catalog.mjs';

const manifest=JSON.parse(fs.readFileSync(new URL('../integration-fabric/evidence-continuity.json',import.meta.url),'utf8'));
const catalog=loadCatalog();
const deltas=loadResearchDeltas().filter(delta=>String(delta.source||'').startsWith('research-overlays/'));
const byId=new Map(catalog.systems.map(system=>[system.id,system]));

assert.equal(manifest.schemaVersion,2);
assert.equal(manifest.contract,'VECTOR_INTEGRATION_EVIDENCE_CONTINUITY_V2');
assert.equal(manifest.continuityMode,'effective-capability-set');
assert.equal(manifest.invariants?.rawOverlayCountIsAdmissionGate,false);

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

const capabilitySnapshot={
  systems:catalog.systems
    .map(system=>({
      id:system.id,
      testLevel:system.testLevel,
      protocols:[...(system.protocols||[])].sort()
    }))
    .sort((a,b)=>a.id.localeCompare(b.id)),
  protocolFamilies:[...catalog.protocolFamilies].sort()
};
const capabilityFingerprint=crypto
  .createHash('sha256')
  .update(JSON.stringify(capabilitySnapshot))
  .digest('hex');

const overlayDiagnostic={
  observed:deltas.length,
  baseline:Number(manifest.diagnosticOverlayBaseline||0),
  delta:deltas.length-Number(manifest.diagnosticOverlayBaseline||0),
  admissionGate:false,
  state:deltas.length<Number(manifest.diagnosticOverlayBaseline||0)?'SHAPE_CHANGED_BELOW_BASELINE':'OK'
};

const proof={
  contract:manifest.contract,
  continuityMode:manifest.continuityMode,
  overlayDiagnostic,
  effectiveSystems:catalog.systems.length,
  requiredProviders:(manifest.requiredProviders||[]).length,
  requiredPromotions:Object.keys(manifest.requiredPromotions||{}).length,
  protocolFamilies:catalog.protocolFamilies.length,
  capabilityFingerprint,
  result:'PASS'
};
console.log('VECTOR_INTEGRATION_EVIDENCE_CONTINUITY='+JSON.stringify(proof));
