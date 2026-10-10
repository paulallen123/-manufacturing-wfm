import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';

const {handle} = await import(process.env.GUSTO_RECEIVER_TEST_MODULE
  ? pathToFileURL(process.env.GUSTO_RECEIVER_TEST_MODULE).href
  : './gusto-webhook-receiver.mjs');
const PATH = '/api/integrations/gusto/webhooks';
const endpoint = 'https://vector.example' + PATH;
const subscription = '00000000-0000-4000-8000-000000000001';
const otherSubscription = '00000000-0000-4000-8000-000000000002';
const sha = value => createHash('sha256').update(value).digest('hex');
const signature = (body, token) => createHmac('sha256', token).update(body).digest('hex');
const event = JSON.stringify({event_type:'company.provisioned', resource_type:'Company', resource_uuid:otherSubscription, timestamp:1671058841});

async function fixture(t, {status='pending', token=null, verified=false, environment='sandbox'}={}) {
  const dir = mkdtempSync(join(tmpdir(), 'vector-webhook-'));
  const names = ['WFM_DB','WFM_PUBLIC_ORIGIN','WFM_GUSTO_ENVIRONMENT','WFM_GUSTO_CLIENT_ID','WFM_GUSTO_CLIENT_SECRET'];
  const previous = Object.fromEntries(names.map(key => [key, process.env[key]]));
  Object.assign(process.env, {WFM_DB:join(dir,'state.sqlite'),WFM_PUBLIC_ORIGIN:'https://vector.example',WFM_GUSTO_ENVIRONMENT:'sandbox',WFM_GUSTO_CLIENT_ID:'synthetic-client',WFM_GUSTO_CLIENT_SECRET:'synthetic-secret'});
  const db = new DatabaseSync(process.env.WFM_DB);
  db.exec('CREATE TABLE gusto_webhook_subscriptions(endpoint_url TEXT PRIMARY KEY,subscription_uuid TEXT,environment TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT);CREATE TABLE gusto_webhook_tokens(id INTEGER PRIMARY KEY AUTOINCREMENT,endpoint_url TEXT NOT NULL,subscription_uuid TEXT,token TEXT NOT NULL,token_hash TEXT NOT NULL,received_at TEXT NOT NULL,verified_at TEXT);CREATE TABLE gusto_webhook_events(event_uuid TEXT PRIMARY KEY,event_type TEXT,resource_type TEXT,resource_uuid TEXT,payload_hash TEXT NOT NULL,received_at TEXT NOT NULL,status TEXT NOT NULL);');
  db.prepare('INSERT INTO gusto_webhook_subscriptions VALUES(?,?,?,?,?,?,NULL)').run(endpoint,subscription,environment,status,'2026-01-01','2026-01-01');
  if(token) db.prepare('INSERT INTO gusto_webhook_tokens(endpoint_url,subscription_uuid,token,token_hash,received_at,verified_at) VALUES(?,?,?,?,?,?)').run(endpoint,subscription,token,sha(token),'2026-01-01',verified?'2026-01-01':null);
  const providerCalls=[];
  const originalFetch=globalThis.fetch;
  let acceptVerification=false;
  let verificationResponse=null;
  globalThis.fetch=async(url,options)=>{
    providerCalls.push({url:String(url),options});
    assert.ok(String(url).startsWith('https://api.gusto-demo.com/'), 'fixed sandbox provider only');
    if(String(url).endsWith('/oauth/token')) return Response.json({access_token:'synthetic-system-token'});
    if(String(url).endsWith('/verify')) return verificationResponse?verificationResponse():Response.json({}, {status:acceptVerification?200:422});
    throw Error('Unexpected provider operation');
  };
  const server=http.createServer(async(req,res)=>{try{if(!await handle(req,res)){res.statusCode=404;res.end();}}catch{res.statusCode=503;res.end('{}');}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const request=(body,headers={},path=PATH,method='POST')=>new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:server.address().port,path,method,headers:{'content-type':'application/json',...headers}},res=>{
      const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>{const text=Buffer.concat(parts).toString();resolve({status:res.statusCode,body:text?JSON.parse(text):null,headers:res.headers});});
    });req.on('error',reject);req.end(body);
  });
  t.after(async()=>{
    // The captured legacy baseline schedules verification after returning 202.
    if(process.env.GUSTO_RECEIVER_TEST_MODULE) await new Promise(resolve=>setTimeout(resolve,40));
    await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=originalFetch;db.close();
    for(const key of names){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    rmSync(dir,{recursive:true,force:true});
  });
  return {db,request,providerCalls,acceptVerification:()=>{acceptVerification=true;},verificationResponse:fn=>{verificationResponse=fn;}};
}

test('an unverified callback token cannot authenticate a subsequent forged event',async t=>{
  const f=await fixture(t);
  await f.request(JSON.stringify({verification_token:'attacker-controlled'}));
  const result=await f.request(event,{'x-gusto-signature':signature(event,'attacker-controlled')});
  assert.equal(result.status,412);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_events').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,0);
});
test('rejected verification preserves the established subscription and verified token',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  const rejected=await f.request(JSON.stringify({verification_token:'attacker-controlled'}));
  assert.equal(rejected.status,401);
  assert.equal(f.db.prepare('SELECT status FROM gusto_webhook_subscriptions').get().status,'verified');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,1);
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'trusted-token')})).status,200);
});
test('callback cannot replace the locally registered subscription identifier',async t=>{
  const f=await fixture(t);
  const result=await f.request(JSON.stringify({verification_token:'candidate-token',subscription_uuid:otherSubscription}));
  assert.equal(result.status,409);
  assert.equal(f.db.prepare('SELECT subscription_uuid FROM gusto_webhook_subscriptions').get().subscription_uuid,subscription);
  assert.equal(f.providerCalls.length,0);
});
test('only successful provider verification makes the candidate token usable',async t=>{
  const f=await fixture(t);f.acceptVerification();
  const result=await f.request(JSON.stringify({verification_token:'trusted-token'}));
  assert.equal(result.status,202);
  const row=f.db.prepare('SELECT * FROM gusto_webhook_tokens').get();
  assert.ok(row.verified_at);
  assert.equal(row.subscription_uuid,subscription);
  assert.equal(f.db.prepare('SELECT status FROM gusto_webhook_subscriptions').get().status,'verified');
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'trusted-token')})).status,200);
  assert.equal(f.providerCalls.length,2);
  assert.ok(f.providerCalls.every(call=>call.options.redirect==='error'&&call.options.signal));
});
test('legacy unverified token rows are ignored even when newer than a trusted token',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  f.db.prepare('INSERT INTO gusto_webhook_tokens(endpoint_url,subscription_uuid,token,token_hash,received_at,verified_at) VALUES(?,?,?,?,?,NULL)').run(endpoint,subscription,'poisoned-token',sha('poisoned-token'),'2026-02-01');
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'poisoned-token')})).status,401);
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'trusted-token')})).status,200);
});
test('signatures bind the exact bytes and event retries are idempotent',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  const headers={'x-gusto-signature':signature(event,'trusted-token')};
  assert.equal((await f.request(event+' ',headers)).status,401);
  const first=await f.request(event,headers),second=await f.request(event,headers);
  assert.equal(first.status,200);assert.equal(first.body.duplicate,false);
  assert.equal(second.status,200);assert.equal(second.body.duplicate,true);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_events').get().n,1);
});
test('a subscription from another provider environment cannot authenticate events',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true,environment:'production'});
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'trusted-token')})).status,412);
  assert.equal(f.providerCalls.length,0);
});
test('public health discloses no subscription identifiers, token state or event counts',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  const result=await f.request(undefined,{},PATH,'GET');
  assert.equal(result.status,200);assert.deepEqual(result.body,{status:'ready'});
  assert.equal(result.headers['cache-control'],'no-store');
  assert.equal((await f.request(undefined,{},'/unrelated','GET')).status,404);
  assert.equal(f.providerCalls.length,0);
});
test('malformed bodies and oversized tokens fail without provider calls or persistence',async t=>{
  const f=await fixture(t);
  for(const body of ['null','[]','{',JSON.stringify({verification_token:'x'.repeat(4097)}),JSON.stringify({verification_token:{unexpected:true}})]){
    assert.equal((await f.request(body)).status,400);
  }
  assert.equal(f.providerCalls.length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,0);
});

test('provider failure cannot replace an established signing token',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  f.verificationResponse(()=>Response.json({error:'sensitive provider diagnostic'},{status:500}));
  const result=await f.request(JSON.stringify({verification_token:'candidate-token'}));
  assert.equal(result.status,503);assert.equal(result.body.error,'GUSTO_PROVIDER_UNAVAILABLE');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,1);
  assert.equal((await f.request(event,{'x-gusto-signature':signature(event,'trusted-token')})).status,200);
});
test('provider response must be bounded before accepting a token',async t=>{
  const f=await fixture(t);
  f.verificationResponse(()=>new Response('x'.repeat(65537)));
  assert.equal((await f.request(JSON.stringify({verification_token:'candidate-token'}))).status,413);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,0);
});
test('a subscription change during provider verification cannot bind the old response',async t=>{
  const f=await fixture(t);
  f.verificationResponse(()=>{
    f.db.prepare('UPDATE gusto_webhook_subscriptions SET subscription_uuid=?').run(otherSubscription);
    return Response.json({});
  });
  assert.equal((await f.request(JSON.stringify({verification_token:'candidate-token'}))).status,409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,0);
  assert.equal(f.db.prepare('SELECT status FROM gusto_webhook_subscriptions').get().status,'pending');
});
test('a verified token callback retry neither calls the provider nor adds token rows',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  assert.equal((await f.request(JSON.stringify({verification_token:'trusted-token'}))).status,202);
  assert.equal(f.providerCalls.length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM gusto_webhook_tokens').get().n,1);
});
test('conflicting signed payloads sharing an event identifier cannot overwrite a receipt',async t=>{
  const f=await fixture(t,{status:'verified',token:'trusted-token',verified:true});
  const original=JSON.stringify({...JSON.parse(event),uuid:otherSubscription});
  const changed=JSON.stringify({...JSON.parse(event),uuid:otherSubscription,timestamp:1671058842});
  assert.equal((await f.request(original,{'x-gusto-signature':signature(original,'trusted-token')})).status,200);
  assert.equal((await f.request(changed,{'x-gusto-signature':signature(changed,'trusted-token')})).status,409);
  assert.equal(f.db.prepare('SELECT payload_hash FROM gusto_webhook_events').get().payload_hash,sha(original));
});
test('unknown environment fails closed without provider requests',async t=>{
  const f=await fixture(t);process.env.WFM_GUSTO_ENVIRONMENT='unexpected';
  assert.equal((await f.request(JSON.stringify({verification_token:'candidate-token'}))).status,503);
  assert.equal(f.providerCalls.length,0);
});
test('the actual Node preload handles its route and preserves ordinary HTTP listeners',async t=>{
  const f=await fixture(t);
  const program="import http from 'node:http';const server=http.createServer({keepAliveTimeout:100},(req,res)=>{res.end(JSON.stringify({originalListener:true}));});server.listen(0,'127.0.0.1',()=>console.log('PORT='+server.address().port));";
  const child=spawn(process.execPath,['--import',new URL('./gusto-webhook-preload.mjs',import.meta.url).href,'--input-type=module','--eval',program],{env:{...process.env,NODE_OPTIONS:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
  const port=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('preload child did not listen')),5000);
    let output='';child.stdout.on('data',bytes=>{output+=bytes;const match=/PORT=(\d+)/.exec(output);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',code=>{clearTimeout(timer);reject(Error('preload child exited '+code));});
  });
  const request=path=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port,path},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve(JSON.parse(Buffer.concat(parts))));}).on('error',reject);});
  assert.deepEqual(await request(PATH),{status:'ready'});
  assert.deepEqual(await request('/api/runtime-identity'),{originalListener:true});
  assert.equal(f.providerCalls.length,0);
});
