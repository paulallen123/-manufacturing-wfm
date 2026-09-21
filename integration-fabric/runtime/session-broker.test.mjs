import test from 'node:test';
import assert from 'node:assert/strict';
import {createSessionBroker} from './session-broker.mjs';

function statusError(status,message=`status ${status}`){
  const error=new Error(message);
  error.status=status;
  return error;
}

function brokerFor(options){
  return createSessionBroker({
    scopeAuthorizer:({scopeNamespace})=>scopeNamespace.startsWith('scope:'),
    requestAuthorizer:({request})=>request?.resource==='Items',
    ...options
  });
}

test('concurrent 401 responses cause one generation-fenced refresh',async()=>{
  let refreshes=0,arrived=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const broker=brokerFor({
    loginExecutor:async()=>({token:`private-${++refreshes}`,expiresAt:Date.now()+60_000}),
    readExecutor:async({generation})=>{
      if(generation===1){arrived++;if(arrived===20)release();await gate;throw statusError(401);}
      return `ok-${generation}`;
    }
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  const values=await Promise.all(Array.from({length:20},()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}})));
  assert.equal(refreshes,2,'initial login plus exactly one shared recovery');
  assert.deepEqual(new Set(values.map(x=>x.generation)),new Set([2]));
  assert.ok(values.every(x=>x.value==='ok-2'&&x.recoveryPerformed===true&&x.reconciliationRequired===true));
});

test('a stale 401 cannot invalidate or replace a newer session generation',async()=>{
  let refreshes=0,firstSeen,proceed;
  const seen=new Promise(resolve=>{firstSeen=resolve;});
  const waitForRotation=new Promise(resolve=>{proceed=resolve;});
  const broker=brokerFor({
    loginExecutor:async()=>({token:`private-${++refreshes}`,expiresAt:Date.now()+60_000}),
    readExecutor:async({generation})=>{
      if(generation===1){firstSeen();await waitForRotation;throw statusError(401);}
      return 'used-new-generation';
    }
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  const pending=broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}});
  await seen;
  await broker.rotate({scopeNamespace:'scope:a'});
  proceed();
  const result=await pending;
  assert.equal(result.generation,2);
  assert.equal(result.value,'used-new-generation');
  assert.equal(refreshes,2,'stale failure reuses the newer generation instead of logging in again');
});

test('403, 429 and server failures never trigger credential refresh',async()=>{
  for(const status of [403,429,503]){
    let refreshes=0;
    const broker=brokerFor({
      loginExecutor:async()=>({token:`private-${++refreshes}`,expiresAt:Date.now()+60_000}),
      readExecutor:async()=>{throw statusError(status);}
    });
    await broker.rotate({scopeNamespace:`scope:${status}`});
    await assert.rejects(()=>broker.execute({scopeNamespace:`scope:${status}`,request:{resource:'Items'}}),error=>error.status===status);
    assert.equal(refreshes,1,`status ${status} must not refresh`);
  }
});

test('a second 401 stops after one recovery attempt',async()=>{
  let refreshes=0,requests=0;
  const broker=brokerFor({
    loginExecutor:async()=>({token:`private-${++refreshes}`,expiresAt:Date.now()+60_000}),
    readExecutor:async()=>{requests++;throw statusError(401);}
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  await assert.rejects(()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}}),error=>error.code==='WFM_SESSION_REAUTH_EXHAUSTED');
  assert.equal(refreshes,2);
  assert.equal(requests,2);
});

test('one failed shared refresh is retained for its generation cohort',async()=>{
  let refreshes=0,arrived=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const broker=brokerFor({
    loginExecutor:async()=>{
      refreshes++;
      if(refreshes===1) return {token:'private-seed',expiresAt:Date.now()+60_000};
      throw statusError(503,'identity service unavailable');
    },
    readExecutor:async()=>{arrived++;if(arrived===12)release();await gate;throw statusError(401);}
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  const settled=await Promise.allSettled(Array.from({length:12},()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}})));
  assert.equal(refreshes,2,'failed shared recovery must not become one refresh per waiter');
  assert.ok(settled.every(x=>x.status==='rejected'&&x.reason.status===503));
});

test('session tokens cannot escape results, errors or diagnostics',async()=>{
  const token='synthetic-private-cookie';
  let mode='result';
  const broker=brokerFor({
    loginExecutor:async()=>({token,expiresAt:Date.now()+60_000}),
    readExecutor:async()=>{
      if(mode==='result') return {echo:token};
      throw statusError(500,`upstream echoed ${token}`);
    }
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  await assert.rejects(()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}}),error=>error.code==='WFM_SESSION_SECRET_EGRESS');
  mode='error';
  await assert.rejects(()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}}),error=>error.status===500&&!error.message.includes(token)&&error.message==='session read failed');
  assert.ok(!JSON.stringify(broker.diagnostics()).includes(token));
});

test('unknown login secrets and non-plain read results cannot cross the broker boundary',async()=>{
  const unknown='synthetic-new-secret';
  const failedLogin=brokerFor({
    loginExecutor:async()=>{throw statusError(503,`Set-Cookie: B1SESSION=${unknown}`);},
    readExecutor:async()=>null
  });
  await assert.rejects(
    ()=>failedLogin.rotate({scopeNamespace:'scope:a'}),
    error=>error.status===503&&error.message==='session login failed'&&!JSON.stringify(error).includes(unknown)
  );

  const token='synthetic-private-cookie';
  for(const result of [new Map([['secret',token]]),Buffer.from(token),{toJSON(){return {secret:token};}}]){
    const broker=brokerFor({
      loginExecutor:async()=>({token,expiresAt:Date.now()+60_000}),
      readExecutor:async()=>result
    });
    await broker.rotate({scopeNamespace:'scope:a'});
    await assert.rejects(()=>broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}}),error=>error.code==='WFM_SESSION_RESULT_INVALID');
  }
});

test('expired sessions refresh before use and idle scopes are bounded without evicting active leases',async()=>{
  let now=1000,refreshes=0,releaseActive;
  const broker=brokerFor({
    now:()=>now,maxScopes:2,
    loginExecutor:async({scopeNamespace})=>({token:`private-${scopeNamespace}-${++refreshes}`,expiresAt:now+100}),
    readExecutor:async({generation,request})=>request.hold?new Promise(resolve=>{releaseActive=resolve;}):generation
  });
  await broker.rotate({scopeNamespace:'scope:a'});
  now=1200;
  const refreshed=await broker.execute({scopeNamespace:'scope:a',request:{resource:'Items'}});
  assert.equal(refreshed.value,2);
  assert.equal(refreshed.recoveryPerformed,true);
  assert.equal(refreshed.reconciliationRequired,true,'proactive expiry rotation breaks page-chain continuity too');
  await broker.rotate({scopeNamespace:'scope:b'});
  const active=broker.execute({scopeNamespace:'scope:a',request:{resource:'Items',hold:true}});
  await new Promise(resolve=>setImmediate(resolve));
  await broker.rotate({scopeNamespace:'scope:c'});
  const scopes=broker.diagnostics().scopes.map(x=>x.scopeNamespace).sort();
  assert.deepEqual(scopes,['scope:a','scope:c']);
  releaseActive('done');
  await active;
});

test('closing a scope fences late refresh completion and cannot resurrect credentials',async()=>{
  let finishLogin;
  const broker=brokerFor({
    loginExecutor:async()=>new Promise(resolve=>{finishLogin=resolve;}),
    readExecutor:async()=>{throw new Error('must not read');}
  });
  const pending=broker.rotate({scopeNamespace:'scope:a'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(broker.close({scopeNamespace:'scope:a',force:true}),true);
  finishLogin({token:'late-private',expiresAt:Date.now()+60_000});
  await assert.rejects(()=>pending,error=>error.code==='WFM_SESSION_SCOPE_CLOSED');
  assert.equal(broker.diagnostics().scopeCount,0);
});

test('scope and request authority are checked before login and again before recovery',async()=>{
  let logins=0,reads=0,requestAllowed=true;
  const broker=createSessionBroker({
    scopeAuthorizer:({scopeNamespace})=>scopeNamespace==='scope:approved',
    requestAuthorizer:()=>requestAllowed,
    loginExecutor:async()=>({token:`private-${++logins}`,expiresAt:Date.now()+60_000}),
    readExecutor:async()=>{reads++;requestAllowed=false;throw statusError(401);}
  });
  await assert.rejects(()=>broker.rotate({scopeNamespace:'scope:denied'}),/not authorised/i);
  assert.equal(logins,0);
  await broker.rotate({scopeNamespace:'scope:approved'});
  await assert.rejects(()=>broker.execute({scopeNamespace:'scope:approved',request:{resource:'Items'}}),/request is not authorised/i);
  assert.equal(logins,1,'revoked request authority stops before reauthentication');
  assert.equal(reads,1);
});
