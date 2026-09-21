const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Browser startup is suspended; the real routing/model code consumes the
// same registered navigation button boundary as the existing application.
function load(routes, employee=false) {
  const visited=[];
  const buttons=routes.map(route=>({dataset:{page:route},textContent:route,click(){visited.push(route)}}));
  const ctx={window:{},document:{querySelectorAll:()=>buttons,addEventListener(){},documentElement:{}},MutationObserver:class{observe(){}},setTimeout(){},queueMicrotask(){},isEmployee:()=>employee,nav:r=>visited.push(r),ui:{page:'overview'}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../ux-overlay/vector-shell.js'),'utf8'),ctx);
  return {api:ctx.window.VectorWorkforceOperations,visited};
}

test('an unavailable payroll route cannot be invoked through the new shell',()=>{
  const {api,visited}=load(['overview','leave','shifts'],true);
  api.go('payroll');
  assert.deepEqual(visited,[]);
});

test('registered workflow is opened through its authoritative source control',()=>{
  const {api,visited}=load(['overview','leave','time-review']);
  api.go('leave');
  assert.deepEqual(visited,['leave']);
});

test('grouped navigation retains every registered workflow exactly once',()=>{
  const routes=['overview','organisation','leave','time-review','schedule-publication','readiness','costs','audit','integrations','new-extension'];
  const {api}=load(routes);
  const model=api.navigationModel();
  const actual=model.flatMap(g=>g.items.map(i=>i.route));
  assert.deepEqual(Array.from(actual).sort(),routes.sort());
  assert.equal(new Set(actual).size,actual.length);
});

test('employee navigation exposes only their registered self-service destinations',()=>{
  const {api}=load(['overview','shifts','leave','timesheet','availability','offers'],true);
  const actual=api.navigationModel().flatMap(g=>g.items.map(i=>i.route));
  assert.deepEqual(Array.from(actual).sort(),['availability','leave','offers','overview','shifts','timesheet']);
  assert.equal(actual.includes('org-admin'),false);
});
