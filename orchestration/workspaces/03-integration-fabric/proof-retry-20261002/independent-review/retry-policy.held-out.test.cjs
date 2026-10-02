'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {proofRetryDecision:decide}=require(path.resolve(__dirname,'../lane03-retry-policy/source/integration/runtime/provider-proof-retry-policy.cjs'));
const now=1800000000000,review=(transport='api',extra={})=>({transport,reviewedDigest:'b'.repeat(64),...extra}),state=(extra={})=>({completedAttempts:1,firstFailureAt:now-1000,operation:'read-proof',authorizationValid:true,operationKey:'independent-key',...extra}),run=(r=review(),f={status:503},s=state(),n=now)=>decide(r,f,s,n),deny=x=>assert.notEqual(x.action,'RETRY');
const limits={api:[5,300000],webhook:[8,600000],'queue-stream':[10,900000],'secure-file':[6,900000],'read-only-db':[4,180000],identity:[4,180000],'on-prem-agent':[10,1800000],ipaas:[8,900000]};
for(const [transport,[attempts,window]] of Object.entries(limits)){
 test(transport+' exact total attempt ceiling and elapsed exhaustion',()=>{
  const last=run(review(transport),{status:503},state({completedAttempts:attempts-1}));assert.equal(last.action,'RETRY');assert.equal(last.nextAttempt,attempts);
  assert.equal(run(review(transport),{status:503},state({completedAttempts:attempts})).action,'QUARANTINE');
  assert.equal(run(review(transport),{status:503},state({firstFailureAt:now-window})).action,'QUARANTINE');
  assert.equal(run(review(transport),{status:503},state({firstFailureAt:now-window-1})).action,'QUARANTINE');
 });
 test(transport+' scheduling respects exact window and provider floor',()=>{
  for(const offset of [-1,0,1]){const result=run(review(transport),{status:429,retryAfterMs:window-1000+offset});if(offset>0)assert.equal(result.action,'QUARANTINE');else{assert.equal(result.action,'RETRY');assert.equal(result.retryAfterMs,window-1000+offset);assert.ok(Date.parse(result.nextAttemptAt)-result.firstFailureAt<=window);}}
 });
}
test('conflicting codes cannot hide auth or terminal authority',()=>{
 for(const [code,failureClass,action] of [['timeout','auth-revoked','REAUTHORIZE'],['invalid-credential','provider-timeout','REAUTHORIZE'],['provider-rate-limited','write-attempt','BLOCK'],['permission-denied','timeout','BLOCK']])assert.equal(run(review(),{code,failureClass,status:503,retryable:true}).action,action);
 for(const failure of [{code:'timeout',status:403},{code:'provider-unavailable',status:401},{status:429,statusCode:401},{httpStatus:503,statusCode:403},{status:500,httpStatus:502}])deny(run(review(),failure));
});
test('tightened budgets never loosen and arithmetic remains safe',()=>{
 for(const retryPolicy of [{maxAttempts:1},{maxElapsedMs:1},{maxAttempts:5,maxElapsedMs:250}])deny(run(review('api',{retryPolicy})));
 for(const retryPolicy of [{maxAttempts:Number.MAX_SAFE_INTEGER},{maxElapsedMs:Infinity},{maxElapsedMs:NaN},{maxAttempts:5.1},{maxElapsedMs:300000.1},{maxElapsedMs:-0},{constructor:1},{maxDelayMs:1}])deny(run(review('api',{retryPolicy})));
 const n=8640000000000000;assert.equal(run(review(),{status:503},state({firstFailureAt:n-1000}),n).action,'QUARANTINE');
 for(const count of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1,Number.MAX_SAFE_INTEGER+1]){const result=run(review(),{status:503},state({completedAttempts:count}));deny(result);if(result.nextAttempt!==undefined)assert.ok(Number.isSafeInteger(result.nextAttempt));}
});
test('authorization expires before or at scheduling target and no alternate operation gains authority',()=>{
 const base=run(),target=now+base.retryAfterMs;
 for(const expiry of [now-1,now,target-1,target])assert.equal(run(review(),{status:503},state({authorizationExpiresAt:expiry})).action,'REAUTHORIZE');
 assert.equal(run(review(),{status:503},state({authorizationExpiresAt:target+1})).action,'RETRY');
 for(const operation of [null,undefined,{},'oauth-token-exchange','write-proof','read-proof ','ack'])deny(run(review(),{status:503},state({operation})));
 for(const valid of [1,'true',{},false,null,undefined])deny(run(review(),{status:503},state({authorizationValid:valid})));
});
test('provider hints cannot coerce overflow, malformed dates or competing minima',()=>{
 for(const failure of [{status:429,retryAfter:1e308},{status:429,retryAfter:'9007199254740991'},{status:429,retryAfterMs:Number.MAX_SAFE_INTEGER},{status:429,retryAfter:'Sun, 30 Feb 2026 00:00:00 GMT'},{status:429,retryAfter:'Thu, 01 Jan 9999 00:00:00 GMT'},{status:429,retryAfterMs:-0.1,retryAfter:1}])deny(run(review(),failure));
 assert.equal(run(review(),{status:429,retryAfter:10,retryAfterMs:12345.001}).retryAfterMs,12346);
 assert.equal(run(review(),{status:429,retryAfter:new Date(now+20000).toUTCString(),retryAfterMs:25000}).retryAfterMs,25000);
});
test('payload descriptors, proxies, revoked proxies and nested coercion execute no user code',()=>{
 let calls=0;const trap=()=>{calls++;throw Error('USER_CODE');};const proxy=new Proxy({}, {get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap}),rev=Proxy.revocable({},{});rev.revoke();
 for(const hostile of [proxy,rev.proxy]){deny(run(hostile));deny(run(review(),hostile));deny(run(review(),{status:503},hostile));deny(run(review('api',{retryPolicy:hostile})));}
 for(const slot of ['review','failure','state','policy']){const bad={};Object.defineProperty(bad,'hidden',{get:trap,enumerable:false});deny(slot==='review'?run(bad):slot==='failure'?run(review(),bad):slot==='state'?run(review(),{status:503},bad):run(review('api',{retryPolicy:bad})));}
 const coercion={toString:trap,valueOf:trap,[Symbol.toPrimitive]:trap};for(const failure of [{code:coercion},{status:coercion},{status:503,retryAfter:coercion}])deny(run(review(),failure));
 assert.equal(run(review(),{status:503,payload:proxy,rawMessage:coercion}).action,'RETRY');
 assert.equal(calls,0);
});
test('null-prototype inert inputs work, symbol keys block, outputs neither echo nor mutate input',()=>{
 const r=Object.assign(Object.create(null),review()),f=Object.assign(Object.create(null),{status:503,payload:'private-payload-987'}),s=Object.assign(Object.create(null),state());const snapshot=JSON.stringify([r,f,s]);const result=run(r,f,s);assert.equal(result.action,'RETRY');assert.equal(JSON.stringify([r,f,s]),snapshot);assert.equal(Object.isFrozen(result),true);assert.ok(!JSON.stringify(result).includes('independent-key'));assert.ok(!JSON.stringify(result).includes('private-payload-987'));
 for(const obj of [r,f,s]){obj[Symbol('secret')]=1;}deny(run(r,f,s));
});
test('explicit clock and pure decision never arm timers or dispatch',()=>{
 const originals={now:Date.now,fetch:global.fetch,setTimeout:global.setTimeout,setInterval:global.setInterval};let calls=0;const forbidden=()=>{calls++;throw Error('DISPATCH_OR_CLOCK');};
 try{Date.now=forbidden;global.fetch=forbidden;global.setTimeout=forbidden;global.setInterval=forbidden;for(let i=0;i<100;i++)assert.equal(run().action,'RETRY');assert.equal(calls,0);}finally{Date.now=originals.now;global.fetch=originals.fetch;global.setTimeout=originals.setTimeout;global.setInterval=originals.setInterval;}
});
