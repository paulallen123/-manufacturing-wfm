'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const bootstrap=fs.readFileSync(path.join(__dirname,'bootstrap.cjs'),'utf8');
const handlerSource=bootstrap.slice(bootstrap.indexOf('function serveCanonicalVectorAsset('),bootstrap.indexOf('\nfunction cookieValue('));
const script=fs.readFileSync(path.join(__dirname,'passkey-session-ui.js'));
function request(method,url='/passkey-session-ui.js') {
  const handler=vm.runInNewContext(handlerSource+';serveCanonicalVectorAsset',{
    requestPath:req=>req.url.split('?')[0],serveRetiredPresentation:()=>false,
    fs:{readFileSync(file){assert.equal(file,'/app/public/passkey-session-ui.js');return script;}}
  });
  const res={headers:{},setHeader(k,v){this.headers[k]=v;},end(body){this.body=body;}};
  return {handled:handler({method,url},res),res};
}
test('the deployed bootstrap serves the session recovery script with JavaScript MIME and no cache',()=>{
  const {handled,res}=request('GET','/passkey-session-ui.js?v=1');
  assert.equal(handled,true);assert.equal(res.statusCode,200);assert.equal(res.body,script);
  assert.match(res.headers['Content-Type'],/^text\/javascript/);assert.match(res.headers['Cache-Control'],/no-store/);
});
test('session asset supports HEAD and rejects writes or unrecognised paths',()=>{
  const head=request('HEAD');assert.equal(head.handled,true);assert.equal(head.res.statusCode,200);assert.equal(head.res.body,undefined);
  const post=request('POST');assert.equal(post.res.statusCode,405);assert.equal(post.res.headers.Allow,'GET, HEAD');
  assert.equal(request('GET','/passkey-session-ui.js/extra').handled,false);
});
