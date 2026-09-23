#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const p=JSON.parse(fs.readFileSync(new URL('../release/proof-lane-policy.json',import.meta.url),'utf8'));
assert.equal(p.schemaVersion,2);
assert.equal(p.name,'VECTOR_PROOF_LANE_INDEPENDENCE_V2');
assert.equal(p.rules.neverSkipTestsToUnblock,true);
assert.equal(p.rules.skippedNeverCountsAsPass,true);
assert.equal(p.rules.noRunnerNeverCountsAsProductFailure,true);
assert.equal(p.rules.providerFailureNeverCountsAsPass,true);
assert.equal(p.rules.exactSourceShaRequired,true);
assert.equal(p.rules.immutableEvidenceRequired,true);
assert.equal(p.rules.developmentContinuesIfAnyExecutableLaneExists,true);
assert.equal(p.rules.fallbackMustMatchRequiredProofScopes,true);
assert.equal(p.rules.weakerLaneMayNotSubstituteForStrongerProof,true);
assert.equal(p.rules.uncoveredRequiredScopeRemainsBlocked,true);
assert.equal(p.rules.deploymentSuccessNeverCountsAsHostedPass,true);
assert.equal(p.rules.publicIngressVerificationRequired,true);
assert.equal(p.rules.applicationIdentityVerificationRequired,true);
assert.equal(p.rules.proofLinkMayBeSharedOnlyAfterPublicVerification,true);
assert.ok(Number(p.rules.productionPromotionRequiresIndependentProviders)>=2);

const ids=new Set(),providers=new Set();
let exactImage=0;
for(const lane of p.lanes||[]){
  assert.ok(lane.id&&lane.provider&&lane.class);
  assert.ok(!ids.has(lane.id),'Duplicate proof lane: '+lane.id);ids.add(lane.id);
  providers.add(lane.provider);
  assert.equal(lane.exactSourceSha,true,'Every proof lane must bind the exact source SHA: '+lane.id);
  assert.equal(lane.sourceBinding,'must-match-candidate-sha','Lane must bind source operationally: '+lane.id);
  assert.ok(Array.isArray(lane.proofScopes)&&lane.proofScopes.length>0,'Lane proof scopes required: '+lane.id);
  assert.equal(new Set(lane.proofScopes).size,lane.proofScopes.length,'Duplicate proof scope: '+lane.id);
  assert.ok(lane.runtimeMode,'Runtime mode required: '+lane.id);
  if(lane.class==='exact-image') exactImage++;
}
assert.ok(providers.size>=3,'Proof topology must span at least three providers/signals.');
assert.ok(exactImage>=2,'At least two exact-image lanes are required.');
for(const id of p.fallbackOrder||[]) assert.ok(ids.has(id),'Unknown fallback lane: '+id);

const scopeCoverage=new Map();
for(const lane of p.lanes||[]) for(const scope of lane.proofScopes||[]){
  const providersForScope=scopeCoverage.get(scope)||new Set();
  providersForScope.add(lane.provider);
  scopeCoverage.set(scope,providersForScope);
}
assert.ok(scopeCoverage.get('exact-image')?.size>=2,'Exact-image proof must have at least two provider families.');
assert.ok(scopeCoverage.get('hosted-product-runtime')?.size>=1,'Hosted product runtime proof scope must exist.');
assert.ok(scopeCoverage.get('public-ingress-2xx')?.size>=1,'At least one hosted lane must prove public ingress.');
assert.ok(scopeCoverage.get('application-identity')?.size>=1,'At least one hosted lane must prove application identity.');
assert.match(p.developmentRule,/every required scope/);
assert.match(p.promotionRule,/cannot stand in for hosted product runtime proof/);
console.log('VECTOR_PROOF_LANE_INDEPENDENCE=PASS providers='+providers.size+' exactImageLanes='+exactImage+' scopes='+scopeCoverage.size);
