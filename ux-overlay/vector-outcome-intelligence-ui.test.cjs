'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'vector-shell.js'),'utf8');

test('outcome learning stays inside the existing five-section Improve experience',()=>{
  const nav=source.match(/const NAV=\[([\s\S]*?)\n\];/)?.[1]||'';
  for(const label of ['Today','People','Plan','Factory','Improve'])assert.match(nav,new RegExp("label:'"+label+"'"));
  assert.equal((nav.match(/label:'/g)||[]).length,5);
  assert.doesNotMatch(nav,/Outcome|Learning|Intelligence/);
  assert.match(source,/page\(\)!=='insights'\|\|employee\(\)/);
  assert.match(source,/data-vector-outcome-intelligence/);
});

test('Improve reads verified outcome summary but never writes learning or grants authority',()=>{
  assert.match(source,/fetch\('\/api\/learning\/outcomes\/summary'/);
  assert.doesNotMatch(source,/fetch\('\/api\/learning\/outcomes\/ingest'/);
  assert.match(source,/executionAuthority!=='NONE'/);
  assert.match(source,/Learning can recommend and block unsafe promotion; it cannot grant itself execution authority/);
  assert.doesNotMatch(source,/data-vector-route="(?:outcomes|learning|intelligence)"/);
});

test('outcome surface fails closed without verified evidence',()=>{
  assert.match(source,/Verified outcome learning is unavailable\. No fallback insight is being invented/);
  assert.match(source,/Only independently verified outcomes appear here/);
  assert.match(source,/releaseBlockingEvaluationCount/);
  assert.match(source,/verifiedWinCount/);
});
