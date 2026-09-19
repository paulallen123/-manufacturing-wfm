'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitizeSnapshot,createReport,parseCadence}=require('./vector-report-engine.cjs');

test('snapshot retains only bounded report evidence fields',()=>{
  const s=sanitizeSnapshot({
    role:'OPS_MANAGER',site:'All sites',currentScreen:'costs',
    metrics:[{label:'Labour vs plan',value:'-4.8%',detail:'Below plan'}],
    facts:[{label:'Agency dependency',value:'6.7%'}],
    secret:'do not retain'
  });
  assert.equal(s.role,'OPS_MANAGER');
  assert.equal(s.metrics.length,1);
  assert.equal(Object.hasOwn(s,'secret'),false);
});

test('report distinguishes evidence and recommendation without inventing savings',()=>{
  const r=createReport({
    title:'Weekly operations',
    request:'create a weekly report',
    snapshot:{
      site:'Plant A',role:'SITE_MANAGER',
      metrics:[{label:'Coverage',value:'96.2%',detail:'Current source value'}],
      decisionLens:{soWhat:'Coverage is below the agreed operating target.',nextAction:'Review the uncovered roles before adding external labour.'}
    }
  });
  assert.match(r.markdown,/Coverage: 96.2%/);
  assert.match(r.markdown,/Review the uncovered roles/);
  assert.doesNotMatch(r.markdown,/saved £|realised saving/i);
  assert.match(r.html,/Executive summary/);
});

test('recurring weekday email intent parses into weekly cadence',()=>{
  const c=parseCadence('Every Monday morning email the operations summary',new Date('2026-09-19T10:00:00Z'));
  assert.equal(c.frequency,'WEEKLY');
  assert.equal(c.dayOfWeek,1);
  assert.equal(c.hour,8);
  assert.equal(c.parsed,true);
});

test('one-off report does not invent a cadence',()=>{
  const c=parseCadence('Create a report for this screen');
  assert.equal(c.frequency,null);
  assert.equal(c.parsed,false);
});
