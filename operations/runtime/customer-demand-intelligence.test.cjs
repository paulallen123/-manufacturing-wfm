'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {normaliseDemandSignal,rankDemandProblems}=require('./customer-demand-intelligence.cjs');

function signal(id,account,decision,overrides={}){
  return {
    signalId:id,accountRef:account,segment:'mid-market',persona:'plant-manager',
    manufacturingArchetype:'discrete',geography:'UK',decisionKey:decision,
    sourceType:'workaround',evidenceType:'revealed',observedAt:'2026-09-22T08:00:00Z',
    severity:4,frequency:4,economicImpact:4,productionImpact:4,adminImpact:3,
    evidenceConfidence:0.9,strategicFit:0.9,differentiation:0.8,reusePotential:0.9,
    integrationReadiness:0.8,outcomeProvability:0.9,implementationEffort:2,adoptionBurden:1,risk:1,
    reversible:true,workaround:'Supervisor spreadsheet + calls',
    outcomeKpis:['decision-latency','plan-attainment'],falsification:'Reject if replay does not beat current decision time or outcome.',
    ...overrides
  };
}
test('silent demand is recognised',()=>{
  assert.equal(normaliseDemandSignal(signal('s1','a','absence-recovery')).silentDemand,true);
});
test('independent repeated demand outranks otherwise equal single-account noise',()=>{
  const ranked=rankDemandProblems([
    signal('a1','acct-a','single-request'),
    signal('m1','acct-a','multi-demand'),
    signal('m2','acct-b','multi-demand'),
    signal('m3','acct-c','multi-demand')
  ]);
  assert.equal(ranked[0].decisionKey,'multi-demand');
  const single=ranked.find(x=>x.decisionKey==='single-request');
  assert.equal(single.evidenceBoundary,'SINGLE_ACCOUNT_LIMITED');
});
test('mandatory high-risk demand remains visible even if evidence is narrow',()=>{
  const ranked=rankDemandProblems([
    signal('s1','acct-a','nice-to-have',{evidenceConfidence:1}),
    signal('r1','acct-z','safety-rule',{mandatory:true,risk:5,evidenceConfidence:0.4,sourceType:'rfp',evidenceType:'stated'})
  ]);
  assert.equal(ranked[0].decisionKey,'safety-rule');
  assert.equal(ranked[0].mandatory,true);
});
test('outcome KPI and falsification are required',()=>{
  assert.throws(()=>normaliseDemandSignal({...signal('x','a','x'),outcomeKpis:[]}),/outcomeKpis/);
});
