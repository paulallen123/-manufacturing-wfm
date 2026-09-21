'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Exact original hosted journey statements from source-inspector deployment
// 2423d5cd-b0e7-4a78-9b8c-aba794b9a6ca, lines 23 and 85.
// Journey SHA256: 36d996c04079c1d6dd5ef33356972f2dc5bc56fabdbcae0c4531f067f9d0fdbc.
// These statements are not changed by wrapper blob 16b4d2c9778d83ae7cc3d6a0e183b51601d9c5e7.
// Extracted control-flow proof only: no product/browser/provider execution here.
const origin = 'https://vector-proof.invalid',out = '/private-synthetic-proof';
async function finish(role){if(!role)return;assert.deepEqual(role.errors,[]);await role.ctx.tracing.stop({path:out+'/'+role.label+'-private-trace.zip'});await role.ctx.request.post(origin+'/api/logout',{headers:{Origin:origin},data:{}});await role.ctx.close();}
async function finalise(employee,manager,other){
  await Promise.allSettled([employee,manager,other].map(finish));
}
function role(overrides={}) {
  return {label:'synthetic-role',errors:[],ctx:{tracing:{stop:async()=>{}},request:{post:async()=>({status:()=>200})},close:async()=>{}},...overrides};
}
for(const [name,makeRole,expected] of [
  ['uncaught leave-journey browser error',()=>role({errors:['SYNTHETIC_UNCAUGHT_PAGE_ERROR']}),/SYNTHETIC_UNCAUGHT_PAGE_ERROR/],
  ['failed private trace preservation',()=>{const r=role();r.ctx.tracing.stop=async()=>{throw Error('SYNTHETIC_TRACE_PRESERVATION_FAILED');};return r;},/SYNTHETIC_TRACE_PRESERVATION_FAILED/]
])test(name+' must prevent the caller reaching PASS',async()=>{
  let reachedPass=false;
  const exercise=async()=>{await finalise(role(),makeRole(),role());reachedPass=true;};
  await assert.rejects(exercise,expected);
  assert.equal(reachedPass,false);
});
