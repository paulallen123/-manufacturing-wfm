import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateDegradedModeReadiness,recommendFallbackTraining,rarityOnlyAlternative} from '../../src/frontier/degraded-mode-readiness.mjs';

const input={
  siteId:'S1',
  people:[
    {id:'p1',siteId:'S1',shift:'day',competencies:['robot-manual-recovery'],eligibleTraining:['plc-local-control']},
    {id:'p2',siteId:'S1',shift:'night',competencies:[],eligibleTraining:['robot-manual-recovery','plc-local-control']}
  ],
  assets:[
    {id:'robot-cell',siteId:'S1',shift:'night',degradedModeApproved:true,requiredCompetency:'robot-manual-recovery',minimumOperators:1,riskWeight:.08,valueAtRisk:120000},
    {id:'plc-line',siteId:'S1',shift:'day',degradedModeApproved:true,requiredCompetency:'plc-local-control',minimumOperators:1,riskWeight:.02,valueAtRisk:40000},
    {id:'safety-plc',siteId:'S1',shift:'night',degradedModeApproved:false,riskWeight:.1,valueAtRisk:500000}
  ]
};

test('finds shift-specific fallback gaps without treating unapproved manual mode as staffable',()=>{
  const r=evaluateDegradedModeReadiness(input);
  assert.equal(r.status,'evaluated');
  assert.deepEqual(r.engineeringOnly,['safety-plc']);
  assert.equal(r.effects.find(x=>x.assetId==='robot-cell').state,'workforce_gap');
  assert.equal(r.effects.find(x=>x.assetId==='safety-plc').exposure,0);
});

test('prioritises the eligible training move with greatest risk-weighted exposure reduction',()=>{
  const r=recommendFallbackTraining(input,1);
  assert.equal(r.recommendations.length,1);
  assert.equal(r.recommendations[0].personId,'p2');
  assert.equal(r.recommendations[0].competency,'robot-manual-recovery');
  assert.ok(r.afterExposure<r.beforeExposure);
});

test('never borrows competence from another site',()=>{
  const x=structuredClone(input);
  x.people.push({id:'p3',siteId:'S2',shift:'night',competencies:['robot-manual-recovery'],eligibleTraining:[]});
  assert.equal(evaluateDegradedModeReadiness(x).reason,'invalid_people_scope');
});

test('unapproved degraded mode is never recommended as a workforce workaround',()=>{
  const r=recommendFallbackTraining(input,5);
  assert.ok(r.recommendations.every(x=>x.assetId!=='safety-plc'));
});

test('risk-weighted method beats rarity-only on a counterexample',()=>{
  const x={
    siteId:'S1',
    people:[
      {id:'a',siteId:'S1',shift:'day',competencies:[],eligibleTraining:['rare-low','common-high']},
      {id:'b',siteId:'S1',shift:'night',competencies:['common-high'],eligibleTraining:[]}
    ],
    assets:[
      {id:'low',siteId:'S1',shift:'day',degradedModeApproved:true,requiredCompetency:'rare-low',minimumOperators:1,riskWeight:.01,valueAtRisk:1000},
      {id:'high',siteId:'S1',shift:'day',degradedModeApproved:true,requiredCompetency:'common-high',minimumOperators:1,riskWeight:.1,valueAtRisk:100000},
      {id:'high2',siteId:'S1',shift:'night',degradedModeApproved:true,requiredCompetency:'common-high',minimumOperators:1,riskWeight:.1,valueAtRisk:100000}
    ]
  };
  const risk=recommendFallbackTraining(x,1);
  const rarity=rarityOnlyAlternative(x,1);
  assert.ok(risk.exposureReduction>rarity.exposureReduction);
});
