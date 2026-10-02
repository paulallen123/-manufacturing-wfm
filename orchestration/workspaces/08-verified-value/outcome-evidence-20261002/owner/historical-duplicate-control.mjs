import test from 'node:test';import assert from 'node:assert/strict';import {evaluateProjectedDecision,createOutcomeLedger} from './reference/savings-engine.mjs';
test('one supplied outcome is not counted twice by reminting attribution labels',()=>{
 const projected=evaluateProjectedDecision({baseline:{id:'baseline',currency:'GBP',costs:{labour:100}},alternatives:[{id:'alternative',currency:'GBP',costs:{labour:80}}]});
 const ledger=createOutcomeLedger(),actual={actualSelectedCost:85,evidenceRefs:['finance:same-measurement'],observedAt:'2026-09-22T16:00:00Z'};
 ledger.record(projected,{...actual,attributionKey:'label-a'});ledger.record(projected,{...actual,attributionKey:'label-b'});
 assert.equal(ledger.entries().length,1,'labels cannot establish distinct financial outcomes');
});
