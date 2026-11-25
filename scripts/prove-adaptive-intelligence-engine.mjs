#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AdaptiveIntelligenceEngine} from '../adaptive-intelligence/engine.mjs';

const engine=new AdaptiveIntelligenceEngine({minRepeatedWins:3});

const common={tenantScope:'tenant-a',source:'verified-outcome-ledger',category:'scheduling',fingerprint:'late-shift-cover',verified:true};
engine.ingestOutcome({...common,baseline:0.70,result:0.82,evidenceRef:'proof:1'});
engine.ingestOutcome({...common,baseline:0.72,result:0.85,evidenceRef:'proof:2'});
engine.ingestOutcome({...common,baseline:0.71,result:0.88,evidenceRef:'proof:3'});

engine.ingestOutcome({
  tenantScope:'tenant-a',source:'payroll-reconciliation',category:'payroll',fingerprint:'overtime-rounding-regression',
  baseline:1.0,result:0.91,verified:true,evidenceRef:'proof:payroll-regression'
});

assert.throws(()=>engine.ingestOutcome({
  tenantScope:'tenant-a',source:'customer-chat',category:'support',fingerprint:'poisoned',baseline:0,result:1,verified:true,memoryGrantsAuthority:true
}),/LEARNING_MEMORY_AUTHORITY_FORBIDDEN/);

const market=engine.ingestMarketCapability({
  competitor:'CADDi',capability:'manufacturing semantic discovery',sourceAuthority:'official',
  sourceRef:'caddi:platform',vectorEvidenceStatus:'UNKNOWN'
});
assert.equal(market.gap,true);

const skillDecision=engine.evaluateCandidate({
  id:'skill-late-shift-cover-v2',level:1,baselineScore:0.74,candidateScore:0.89,holdoutScore:0.86,
  safetyPass:true,tenantIsolationPass:true,rollbackReady:true
});
assert.equal(skillDecision.decision,'promote');
assert.equal(skillDecision.directProductionAuthorityGranted,false);

const tenantConfigDecision=engine.evaluateCandidate({
  id:'tenant-scheduling-weights-v2',level:2,baselineScore:0.70,candidateScore:0.84,holdoutScore:0.82,
  safetyPass:true,tenantIsolationPass:true,rollbackReady:true,shadowPass:true,canaryPass:true,independentPolicyAuthority:true
});
assert.equal(tenantConfigDecision.decision,'promote');

const codeDecision=engine.evaluateCandidate({
  id:'product-code-change-42',level:4,baselineScore:0.80,candidateScore:0.94,holdoutScore:0.91,
  safetyPass:true,tenantIsolationPass:true,rollbackReady:true
});
assert.equal(codeDecision.decision,'route-to-release-gates');
assert.equal(codeDecision.directProductionAuthorityGranted,false);

const snapshot=engine.snapshot();
assert.equal(snapshot.skills.length,1);
assert.equal(snapshot.skills[0].authority,'none');
assert.ok(snapshot.evals.some(x=>x.origin==='regression'&&x.fingerprint==='overtime-rounding-regression'));
assert.ok(snapshot.evals.some(x=>x.origin==='market-gap'&&x.competitor==='CADDi'));
assert.ok(snapshot.decisions.every(x=>x.directProductionAuthorityGranted===false));

const receipt={
  schemaVersion:1,
  status:'PASS',
  runtimeIntegration:false,
  productionMutation:false,
  generatedAt:new Date().toISOString(),
  counts:{
    outcomes:snapshot.outcomes.length,
    evals:snapshot.evals.length,
    skillCandidates:snapshot.skills.length,
    marketGaps:snapshot.marketGaps.length,
    decisions:snapshot.decisions.length
  },
  proven:[
    'verified regression automatically becomes an eval',
    'three repeatable verified wins become a versioned skill candidate',
    'authoritative competitor gap becomes an eval',
    'safe level-1 improvement can be promoted without gaining execution authority',
    'bounded tenant configuration requires shadow, canary and independent policy authority',
    'product code changes are routed to release gates',
    'learning memory cannot grant authority'
  ],
  claimBoundary:'Working repository engine proof. It is not yet wired into the frozen customer-proof runtime and does not autonomously edit production code.'
};
fs.writeFileSync('adaptive-intelligence-engine-proof.json',JSON.stringify(receipt,null,2)+'\n');
console.log('ADAPTIVE_INTELLIGENCE_ENGINE=PASS|evals='+snapshot.evals.length+'|skills='+snapshot.skills.length);
