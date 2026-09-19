'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  normalizeRole,classifyCommand,executionPolicy,buildDecisionInsight,
  metricShouldRender,roleView,assistantEnvelope
}=require('./vector-intelligence-layer.cjs');

test('site managers get site/today decision scope',()=>{
  const v=roleView({jobTitle:'Production Manager',siteCount:1});
  assert.equal(v.role,'SITE_MANAGER');
  assert.equal(v.scope,'SITE');
  assert.equal(v.horizon,'TODAY');
  assert.match(v.principle,/today/i);
});

test('multi-site operations managers get cross-site scope',()=>{
  const v=roleView({jobTitle:'Operations Manager',siteCount:5});
  assert.equal(v.role,'OPS_MANAGER');
  assert.equal(v.scope,'MULTI_SITE');
  assert.ok(v.priorities.includes('CROSS_SITE_VARIANCE'));
});

test('site count upgrades otherwise generic manager to ops scope',()=>{
  assert.equal(normalizeRole({jobTitle:'Manager',siteCount:4}).key,'OPS_MANAGER');
});

test('assistant distinguishes report, email, task, automation and widget commands',()=>{
  assert.equal(classifyCommand('create a weekly labour report').intent,'CREATE_REPORT');
  assert.equal(classifyCommand('email this report to me').intent,'EMAIL_REPORT');
  assert.equal(classifyCommand('set a task to review agency spend').intent,'CREATE_TASK');
  assert.equal(classifyCommand('every Monday send an operations summary').intent,'CREATE_AUTOMATION');
  assert.equal(classifyCommand('add a savings widget to this dashboard').intent,'CHANGE_WIDGET');
  assert.equal(classifyCommand('change this graph to a line chart').intent,'CHANGE_CHART');
});

test('user-requested low-risk writes are auditable scoped writes',()=>{
  const c=classifyCommand('email this report to me');
  assert.deepEqual(executionPolicy(c,{jobTitle:'Operations Manager',siteCount:3}),{
    mode:'USER_SCOPED_WRITE',reason:'USER_REQUESTED_ACTION'
  });
});

test('high impact operational mutations require explicit confirmation',()=>{
  const c=classifyCommand('create a task then publish schedule and change pay rate');
  const p=executionPolicy(c,{jobTitle:'Production Manager'});
  assert.equal(p.mode,'EXPLICIT_CONFIRMATION');
});

test('so-what contract refuses a naked metric',()=>{
  const x=buildDecisionInsight({metric:'absence_rate',statement:'Absence is 6.8%'});
  assert.equal(x.publishable,false);
  assert.deepEqual(x.missing,['soWhat','recommendation']);
  assert.equal(metricShouldRender(x),false);
});

test('complete decision insight is publishable and preserves evidence',()=>{
  const x=buildDecisionInsight({
    metric:'agency_dependency',
    statement:'Agency dependency rose to 12.4%.',
    soWhat:'Warehouse coverage is increasingly dependent on external labour.',
    cause:'Two late-shift critical roles lack internal backup.',
    impactValue:31000,
    recommendation:'Cross-train three existing employees.',
    expectedOutcome:'Reduce agency dependency to roughly 7%.',
    confidence:94,
    evidence:['payroll','attendance','skills']
  });
  assert.equal(x.publishable,true);
  assert.equal(x.financialImpact.value,31000);
  assert.equal(x.confidence,94);
  assert.equal(metricShouldRender(x),true);
});

test('assistant envelope binds role, scope and current screen',()=>{
  const x=assistantEnvelope('why is overtime high?',{
    jobTitle:'Regional Operations Manager',siteCount:6,currentScreen:'costs',siteIds:['A','B']
  });
  assert.equal(x.command.intent,'ANALYSE');
  assert.equal(x.role,'OPS_MANAGER');
  assert.equal(x.scope,'MULTI_SITE');
  assert.equal(x.currentScreen,'costs');
  assert.deepEqual(x.siteIds,['A','B']);
});
