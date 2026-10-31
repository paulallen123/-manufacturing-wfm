'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createNangoCredentialProvider, createForMetadataProfiles } = require(path.join(process.env.VECTOR_NANGO_RUNTIME_ROOT || __dirname, 'nango-credential-provider.cjs'));

const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const KEY = 'fictional-nango-environment-api-key';
const TOKEN = 'fictional-provider-access-token-for-tests';
const ns = () => ({ tenant: 'tenant-a', profileId: 'netsuite-metadata-a', provider: 'netsuite', system: 'NetSuite',
  credentialRef: 'WFM_BROKER_TOKEN_NANGO_NS_A', integrationId: 'netsuite', connectionId: 'ns-connection-a',
  expectedConnectionConfig: { accountId: '1234567_SB1' } });
const sf = () => ({ tenant: 'tenant-a', profileId: 'sf-metadata-a', provider: 'successfactors', system: 'SAP SuccessFactors',
  credentialRef: 'WFM_BROKER_TOKEN_NANGO_SF_A', integrationId: 'sap-success-factors', connectionId: 'sf-connection-a',
  expectedConnectionConfig: { apiServer: 'api12.successfactors.eu', companyId: 'fixture-company-a' } });
const context = b => ({ tenant: b.tenant, profileId: b.profileId, provider: b.provider, system: b.system,
  credentialRef: b.credentialRef, actor: { tenant: b.tenant, email: 'admin@example.test' } });
function documentFor(b) {
  return { id: 42, connection_id: b.connectionId, provider_config_key: b.integrationId,
    provider: b.provider === 'netsuite' ? 'netsuite' : 'sap-success-factors', errors: [],
    tags: { vector_tenant_id: b.tenant, vector_profile_id: b.profileId },
    connection_config: { ...b.expectedConnectionConfig },
    credentials: { type: b.provider === 'netsuite' ? 'OAUTH2' : 'TWO_STEP',
      [b.provider === 'netsuite' ? 'access_token' : 'token']: TOKEN,
      expires_at: new Date(NOW + 3_600_000).toISOString(), refresh_token: 'must-not-be-returned', raw: { private: 'must-not-be-returned' } } };
}
function response(url, body, init = {}) {
  const r = new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...init });
  Object.defineProperty(r, 'url', { value: url });
  return r;
}
function factory(b, fetchImpl, extra = {}) {
  return createNangoCredentialProvider({ bindings: [b], apiKey: KEY, now: () => NOW, fetchImpl, ...extra });
}
function errorCode(code) { return error => error.code === code && !JSON.stringify(error).includes(TOKEN) && !error.cause; }

for (const make of [ns, sf]) test('documented credential shape supplies ' + make().provider + ' with only token and actual expiry', async () => {
  const b = make(); let calls = 0;
  const resolve = factory(b, async (url, options) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.nango.dev');
    assert.equal(u.pathname, '/connections/' + b.connectionId);
    assert.equal(u.searchParams.get('provider_config_key'), b.integrationId);
    assert.equal(u.searchParams.get('refresh_token'), 'false');
    assert.equal(u.searchParams.has('force_refresh'), false);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + KEY);
    assert.ok(options.signal instanceof AbortSignal);
    return response(url, documentFor(b));
  });
  const result = await resolve(context(b));
  assert.deepEqual(result, { accessToken: TOKEN, expiresAt: '2026-10-31T13:00:00.000Z' });
  assert.ok(Object.isFrozen(result)); assert.equal(calls, 1);
});

test('tenant, actor, profile, provider, system and credential-reference mismatches stop before network', async t => {
  const b = ns(); let calls = 0;
  const resolve = factory(b, async () => { calls++; throw Error('unexpected network'); });
  for (const [key, value] of [['tenant','tenant-b'],['profileId','other'],['provider','successfactors'],['system','other'],['credentialRef','WFM_BROKER_TOKEN_OTHER'],['actor',{tenant:'tenant-b'}],['tenant',{}]]) {
    await t.test(key + JSON.stringify(value), () => assert.rejects(resolve({ ...context(b), [key]: value }), errorCode('NANGO_CONTEXT_REJECTED')));
  }
  await assert.rejects(resolve(null), errorCode('NANGO_CONTEXT_REJECTED'));
  assert.equal(calls, 0);
});

test('connection response must match every server-owned identity field', async t => {
  const b = ns();
  const mutations = [d=>d.connection_id='other', d=>d.provider_config_key='other', d=>d.provider='gusto',
    d=>d.tags.vector_tenant_id='tenant-b', d=>delete d.tags.vector_profile_id, d=>d.connection_config.accountId='OTHER',
    d=>delete d.connection_config, d=>{d.data={...d};delete d.connection_id;}];
  for (let i=0;i<mutations.length;i++) await t.test(String(i), async () => {
    const doc = documentFor(b); mutations[i](doc);
    await assert.rejects(factory(b, async url=>response(url,doc))(context(b)), errorCode('NANGO_CONNECTION_MISMATCH'));
  });
});

test('SuccessFactors company and API server changes are refused', async t => {
  const b=sf();
  for (const field of ['companyId','apiServer']) await t.test(field,async()=>{
    const doc=documentFor(b);doc.connection_config[field]='another-company.example';
    await assert.rejects(factory(b,async url=>response(url,doc))(context(b)),errorCode('NANGO_CONNECTION_MISMATCH'));
  });
});

test('unhealthy and unsupported credentials never become bearer tokens', async t => {
  const b=ns();
  for (const [name,mutate,code] of [
    ['error',d=>d.errors=[{type:'auth',message:TOKEN}], 'NANGO_CONNECTION_UNHEALTHY'],
    ['missing errors',d=>delete d.errors,'NANGO_CONNECTION_UNHEALTHY'],
    ['wrong type',d=>d.credentials.type='TWO_STEP','NANGO_CREDENTIAL_INVALID'],
    ['missing token',d=>delete d.credentials.access_token,'NANGO_CREDENTIAL_INVALID'],
    ['header injection',d=>d.credentials.access_token=TOKEN+'\r\nHeader: value','NANGO_CREDENTIAL_INVALID'],
    ['no credentials scope',d=>delete d.credentials,'NANGO_CREDENTIAL_INVALID']
  ]) await t.test(name,async()=>{const doc=documentFor(b);mutate(doc);await assert.rejects(factory(b,async url=>response(url,doc))(context(b)),errorCode(code));});
});

test('expiry must be present, real, unambiguous and bounded without inferred TTL', async t => {
  const b=ns();
  const invalid=[undefined,null,0,'never','2026-02-30T13:00:00.000Z','2026-10-31T13:00:00',
    '2026-10-31T12:00:00.000Z','2026-10-31T12:00:30.000Z',new Date(NOW+7*86400000+1).toISOString()];
  for(const expiry of invalid) await t.test(String(expiry),async()=>{
    const doc=documentFor(b);doc.credentials.expires_at=expiry;doc.credentials.raw.expires_in=3600;
    await assert.rejects(factory(b,async url=>response(url,doc))(context(b)),errorCode('NANGO_CREDENTIAL_EXPIRY_INVALID'));
  });
  for(const expiry of ['2026-10-31T13:00:00Z',new Date(NOW+7*86400000).toISOString()]){
    const doc=documentFor(b);doc.credentials.expires_at=expiry;
    assert.equal((await factory(b,async url=>response(url,doc))(context(b))).expiresAt,new Date(expiry).toISOString());
  }
});

test('binding snapshots cannot be retargeted while the request is pending', async () => {
  const b=ns(),original=structuredClone(b),doc=documentFor(b);let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const resolve=factory(b,async url=>{await gate;return response(url,doc);});
  const pending=resolve(context(original));
  b.connectionId='other';b.expectedConnectionConfig.accountId='OTHER';b.tenant='tenant-b';release();
  assert.equal((await pending).accessToken,TOKEN);
  await assert.rejects(resolve(context(b)),errorCode('NANGO_CONTEXT_REJECTED'));
});

test('configuration rejects alternate hosts, ambiguous bindings and invalid paths before network', async t => {
  for(const origin of ['http://api.nango.dev','https://evil.example','https://api.nango.dev/','https://api.nango.dev:444','https://api.nango.dev@evil.example'])
    await t.test(origin,()=>assert.throws(()=>factory(ns(),async()=>{}, {apiOrigin:origin}),errorCode('NANGO_CONFIGURATION_INVALID')));
  for(const mutate of [b=>b.connectionId='..',b=>b.connectionId='.',b=>b.connectionId='x/y',b=>b.provider='constructor',
    b=>b.credentialRef=['WFM_BROKER_TOKEN_NANGO_NS_A'],b=>b.apiKey=KEY,b=>delete b.expectedConnectionConfig.accountId]){
    const b=ns();mutate(b);assert.throws(()=>factory(b,async()=>{}),errorCode('NANGO_CONFIGURATION_INVALID'));
  }
  assert.throws(()=>createNangoCredentialProvider({bindings:[ns(),ns()],apiKey:KEY}),errorCode('NANGO_CONFIGURATION_INVALID'));
});

test('responses and thrown failures cannot reveal upstream bodies or secrets', async t => {
  const b=ns();
  for(const status of [400,401,403,404,424,429,500]) await t.test(String(status),async()=>{
    const resolve=factory(b,async url=>response(url,KEY+' '+TOKEN,{status}));
    await assert.rejects(resolve(context(b)),error=>{
      assert.equal(error.code,'NANGO_CREDENTIAL_UNAVAILABLE');
      assert.ok(!String(error.stack).includes(KEY));assert.ok(!String(error.stack).includes(TOKEN));
      assert.equal(error.cause,undefined);return true;
    });
  });
  await assert.rejects(factory(b,async()=>{throw Error(KEY+' '+TOKEN);})(context(b)),errorCode('NANGO_TRANSPORT_UNAVAILABLE'));
});

test('redirects and unexpected successful response endpoints are rejected', async t => {
  const b=ns();
  for(const kind of ['status','redirected','url','missing-url']) await t.test(kind,async()=>{
    const resolve=factory(b,async url=>{
      const r=response(kind==='url'?'https://api.nango.dev/connections/other':kind==='missing-url'?'':url,documentFor(b),kind==='status'?{status:302}:{});
      if(kind==='redirected')Object.defineProperty(r,'redirected',{value:true});return r;
    });
    await assert.rejects(resolve(context(b)),errorCode('NANGO_REDIRECT_REJECTED'));
  });
});

test('byte limit counts actual stream bytes independently of Content-Length',async()=>{
  const b=ns();
  const resolve=factory(b,async url=>response(url,' '.repeat(1000),{headers:{'content-type':'application/json','content-length':'1'}}),{maxResponseBytes:256});
  await assert.rejects(resolve(context(b)),errorCode('NANGO_RESPONSE_TOO_LARGE'));
});

test('deadline covers fetch and a stalled body even when cancellation is ignored',async t=>{
  const b=ns();
  await t.test('fetch',()=>assert.rejects(factory(b,()=>new Promise(()=>{}),{timeoutMs:20})(context(b)),errorCode('NANGO_REQUEST_TIMEOUT')));
  let cancelled=false;
  await t.test('stream',()=>assert.rejects(factory(b,async url=>({status:200,url,redirected:false,headers:new Headers({'content-type':'application/json'}),
    body:{getReader(){return{read:()=>new Promise(()=>{}),cancel(){cancelled=true;return new Promise(()=>{});},releaseLock(){}};}}}),{timeoutMs:20})(context(b)),errorCode('NANGO_REQUEST_TIMEOUT')));
  assert.equal(cancelled,true);
});

test('optional loader is disabled with no bindings and refuses partial or mismatched profile coverage',()=>{
  assert.equal(createForMetadataProfiles({profiles:[],env:{}}),null);
  assert.equal(createForMetadataProfiles({profiles:[],env:{WFM_NANGO_METADATA_BINDINGS_JSON:'[]'}}),null);
  const b=ns();
  const p={id:b.profileId,tenant:b.tenant,provider:b.provider,system:b.system,credentialEnv:b.credentialRef,
    accountId:'1234567_SB1',allowedOrigin:'https://1234567-sb1.suitetalk.api.netsuite.com',restOrigin:'https://1234567-sb1.suitetalk.api.netsuite.com'};
  const env={WFM_NANGO_METADATA_BINDINGS_JSON:JSON.stringify([b]),WFM_NANGO_API_KEY:KEY};
  assert.equal(typeof createForMetadataProfiles({profiles:[p],env,fetchImpl:async()=>{},now:()=>NOW}),'function');
  for(const profiles of [[],[p,{...p,id:'other'}],[{...p,credentialEnv:'WFM_BROKER_TOKEN_OTHER'}],[{...p,restOrigin:'https://evil.example'}]])
    assert.throws(()=>createForMetadataProfiles({profiles,env}),errorCode('NANGO_CONFIGURATION_INVALID'));
});
