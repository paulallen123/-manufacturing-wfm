'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'passkey-session-ui.js'),'utf8');
async function exercise(url,status){
  const redirects=[];const response={status,ok:status>=200&&status<300};
  const window={fetch:async()=>response};
  vm.runInNewContext(source,{window,URL,location:{href:'https://vector.test/',origin:'https://vector.test',replace:p=>redirects.push(p)},document:{addEventListener(){}}});
  assert.equal(await window.fetch(url),response);return redirects;
}
test('expired in-app API sessions return to passwordless entry',async()=>assert.deepEqual(await exercise('/api/bootstrap',401),['/']));
test('successful logout returns to passwordless entry',async()=>assert.deepEqual(await exercise('/api/logout',200),['/']));
test('role denials and external response failures preserve the current screen',async()=>{
  assert.deepEqual(await exercise('/api/payroll-run',403),[]);
  assert.deepEqual(await exercise('https://elsewhere.test/api/bootstrap',401),[]);
});
