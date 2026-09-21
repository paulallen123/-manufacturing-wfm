const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('late source evidence refreshes the visible attention total as well as the queue',async()=>{
  const count={textContent:'0'},badge={textContent:'0',hidden:true},queue={outerHTML:''};
  const source=fs.readFileSync(require.resolve('../ux-overlay/vector-shell.js'),'utf8').replace('window.VectorWorkforceOperations={marker:MARKER','window.VectorWorkforceOperations={loadTimeReviewEvidence,marker:MARKER');
  const selectors={'.vector-alerts':queue,'.vector-notification-count':badge,'[data-vector-attention-count]':count};
  const item={contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',sourceId:'time-1',reasonCode:'MISSING_CLOCK_OUT',authorityRequired:'manager',observedAt:'2026-09-21T00:00:00Z',freshness:{state:'unknown'},confirmation:{state:'action_required'},title:'Missing clock out'};
  const context={window:{},document:{querySelector:s=>selectors[s]||null,querySelectorAll:()=>[],addEventListener(){},documentElement:{}},MutationObserver:class{observe(){}},setTimeout(){},queueMicrotask(){},isEmployee:()=>false,fetch:async()=>({ok:true,json:async()=>({contractVersion:'WFM_WORKFLOW_ACTION_EVIDENCE_V1',workflow:'time-review',items:[item]})})};
  vm.runInNewContext(source,context);
  await context.window.VectorWorkforceOperations.loadTimeReviewEvidence();
  assert.equal(count.textContent,'1');
  assert.equal(badge.textContent,'1');
  assert.equal(badge.hidden,false);
  assert.match(queue.outerHTML,/Missing clock out/);
  assert.match(queue.outerHTML,/Authority: manager/);
  assert.match(queue.outerHTML,/<details class="vector-action-detail">/);
});
