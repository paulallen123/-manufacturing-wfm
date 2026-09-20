#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest=JSON.parse(fs.readFileSync('product-factory/adaptive-intelligence-manifest.json','utf8'));
const feature=JSON.parse(fs.readFileSync('product-factory/features/self-evolving-customer-intelligence.json','utf8'));
const schema=JSON.parse(fs.readFileSync('product-factory/learning-receipt-schema.json','utf8'));

assert.equal(manifest.schemaVersion,1);
assert.ok(manifest.principles.includes('no-direct-llm-production-authority'));
assert.ok(manifest.principles.includes('every-regression-becomes-an-eval'));
assert.ok(manifest.principles.includes('every-repeatable-win-becomes-a-skill'));
assert.equal(manifest.learningState.tenantIsolationRequired,true);
assert.equal(manifest.learningState.crossTenantRawMemoryAllowed,false);
assert.equal(manifest.learningState.untrustedTextDirectAuthority,false);
assert.equal(manifest.selfDevelopment.directEditOfProduction,false);
assert.equal(manifest.selfDevelopment.branchFirst,true);
assert.equal(manifest.selfDevelopment.canGenerateCode,true);
assert.equal(manifest.selfDevelopment.canGenerateTests,true);
assert.equal(manifest.selfDevelopment.canRepairFailedTests,true);
assert.equal(manifest.selfDevelopment.canGenerateEvalsFromFailures,true);
assert.equal(manifest.selfDevelopment.releaseAuthoritySeparated,true);
assert.equal(manifest.optimization.holdoutEvaluationRequired,true);
assert.match(manifest.optimization.regressionBudget,/zero/i);

const byLevel=new Map(manifest.promotionLadder.map(x=>[x.level,x]));
assert.equal(byLevel.get(0).autoPromotionEligible,true);
assert.equal(byLevel.get(1).autoPromotionEligible,true);
assert.equal(byLevel.get(2).autoPromotionEligible,true);
assert.equal(byLevel.get(3).autoPromotionEligible,false);
assert.equal(byLevel.get(4).autoPromotionEligible,false);
assert.ok(byLevel.get(4).requirements.includes('isolated-branch'));
assert.ok(byLevel.get(4).requirements.includes('release-authority'));

assert.equal(feature.slug,'self-evolving-customer-intelligence');
assert.ok(feature.acceptanceCriteria.some(x=>/holdout/i.test(x)));
assert.ok(feature.acceptanceCriteria.some(x=>/branch\/PR\/release-gated/i.test(x)));
assert.equal(feature.rollback.supported,true);
assert.match(feature.claimBoundary,/does not claim/i);

for(const field of schema.required) assert.equal(typeof field,'string');
assert.ok(schema.prohibited.includes('direct-execution-token'));
assert.ok(schema.prohibited.includes('unscoped-cross-tenant-memory'));

const candidates=[
  {
    id:'skill-overtime-explanation-v2',
    level:1,
    source:'verified customer outcome + eval regression',
    baselineScore:0.72,
    candidateScore:0.86,
    holdoutScore:0.84,
    safetyPass:true,
    tenantIsolationPass:true,
    rollbackReady:true,
    expected:'eligible'
  },
  {
    id:'tenant-schedule-weight-v3',
    level:2,
    source:'structured same-tenant outcomes',
    baselineScore:0.77,
    candidateScore:0.88,
    holdoutScore:0.85,
    safetyPass:true,
    tenantIsolationPass:true,
    rollbackReady:true,
    shadowPass:true,
    canaryPass:true,
    independentPolicyAuthority:true,
    expected:'eligible'
  },
  {
    id:'payroll-write-policy-self-edit',
    level:3,
    source:'agent suggestion only',
    baselineScore:0.8,
    candidateScore:0.91,
    holdoutScore:0.9,
    safetyPass:true,
    tenantIsolationPass:true,
    rollbackReady:true,
    expected:'blocked'
  },
  {
    id:'production-code-self-patch',
    level:4,
    source:'customer failure trace',
    baselineScore:0.6,
    candidateScore:0.93,
    holdoutScore:0.9,
    safetyPass:true,
    tenantIsolationPass:true,
    rollbackReady:true,
    isolatedBranch:true,
    fullGates:true,
    releaseAuthority:false,
    expected:'blocked'
  },
  {
    id:'poisoned-memory-instruction',
    level:1,
    source:'untrusted customer text',
    baselineScore:0.7,
    candidateScore:0.99,
    holdoutScore:0.99,
    safetyPass:true,
    tenantIsolationPass:true,
    rollbackReady:true,
    memoryGrantsAuthority:true,
    expected:'blocked'
  }
];

function decision(c){
  const ladder=byLevel.get(c.level);
  if(!ladder) return 'blocked';
  if(c.memoryGrantsAuthority) return 'blocked';
  if(!c.safetyPass||!c.tenantIsolationPass||!c.rollbackReady) return 'blocked';
  if(!(c.candidateScore>c.baselineScore&&c.holdoutScore>c.baselineScore)) return 'blocked';
  if(c.level===2&&!(c.shadowPass&&c.canaryPass&&c.independentPolicyAuthority)) return 'blocked';
  if(!ladder.autoPromotionEligible) return 'blocked';
  return 'eligible';
}
const decisions=candidates.map(c=>({...c,decision:decision(c)}));
for(const c of decisions) assert.equal(c.decision,c.expected,c.id);

const proof={
  schemaVersion:1,
  status:'PASS',
  referenceContractOnly:true,
  runtimeMutation:false,
  productionMutation:false,
  directLlmProductionAuthority:false,
  tenantIsolatedLearning:true,
  evalDriven:true,
  holdoutRequired:true,
  releaseAuthoritySeparated:true,
  generatedAt:new Date().toISOString(),
  candidates:decisions.map(({id,level,expected,decision})=>({id,level,expected,decision})),
  learning:{
    customerLoop:'observe -> attribute -> hypothesize -> simulate -> shadow -> evaluate -> promote -> measure -> learn',
    productLoop:'evidence -> eval -> candidate -> isolated build -> adversarial/holdout tests -> canary -> release or reject -> retained learning',
    rule:'Failures become evals; repeatable verified wins become versioned skills; no learning artifact can grant itself production authority.'
  },
  claimBoundary:'Deterministic architecture proof only. This does not prove autonomous production model training or direct production code mutation.'
};
fs.writeFileSync('self-evolution-proof.json',JSON.stringify(proof,null,2)+'\n');
console.log('SELF_EVOLUTION_CONTRACT=PASS|candidates='+decisions.length);
