'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadBroker } = require('../../test-support/sealed-nango-broker.cjs');
const PMB = loadBroker();
const { createForMetadataProfiles } = require(path.join(process.env.VECTOR_NANGO_RUNTIME_ROOT || __dirname, 'nango-credential-provider.cjs'));
const NOW = Date.parse('2026-10-31T12:00:00.000Z');
const TOKEN = 'fictional-provider-access-token-for-broker-proof';
const KEY = 'fictional-nango-environment-key-for-broker-proof';
function setup(provider = 'netsuite') {
  const ns = provider === 'netsuite';
  const binding = { tenant: 'fixture-tenant', profileId: ns ? 'ns-metadata' : 'sf-metadata', provider,
    system: ns ? 'NetSuite' : 'SAP SuccessFactors', credentialRef: ns ? 'WFM_BROKER_TOKEN_NS_FIXTURE' : 'WFM_BROKER_TOKEN_SF_FIXTURE',
    integrationId: ns ? 'netsuite' : 'sap-success-factors', connectionId: ns ? 'fixture-ns-connection' : 'fixture-sf-connection',
    expectedConnectionConfig: ns ? {accountId:'1234567_SB1'} : {apiServer:'api12.successfactors.eu',companyId:'fictional-company'} };
  const profile = {id:binding.profileId,tenant:binding.tenant,provider,system:binding.system,credentialEnv:binding.credentialRef,
    methods:[{method:ns?'rest':'odata'}],objectTypes:[ns?'demand':'people'],providerVersion:'fixture-v1',
    ...(ns ? {accountId:'1234567_SB1',query:'SELECT id, companyName FROM customer ORDER BY id',uniqueOrderColumns:['id']}
      : {queryUrl:'https://api12.successfactors.eu/odata/v2/EmpJob?paging=snapshot&asOfDate=2026-10-31&$orderby=userId,startDate,seqNumber'})};
  const profiles=PMB.parseProfiles([profile]);
  const env={WFM_NANGO_METADATA_BINDINGS_JSON:JSON.stringify([binding]),WFM_NANGO_API_KEY:KEY};
  const doc={connection_id:binding.connectionId,provider_config_key:binding.integrationId,provider:ns?'netsuite':'sap-success-factors',
    tags:{vector_tenant_id:binding.tenant,vector_profile_id:binding.profileId},connection_config:{...binding.expectedConnectionConfig},errors:[],
    credentials:{type:ns?'OAUTH2':'TWO_STEP',[ns?'access_token':'token']:TOKEN,expires_at:'2026-10-31T13:00:00.000Z'}};
  let nangoCalls=0,providerCalls=0;const events=[];
  const fetchImpl=async(url,options)=>{nangoCalls++;events.push('credential');assert.equal(new URL(url).origin,'https://api.nango.dev');
    assert.equal(options.headers.Authorization,'Bearer '+KEY);const r=new Response(JSON.stringify(doc),{headers:{'content-type':'application/json'}});
    Object.defineProperty(r,'url',{value:url});return r;};
  const credentialProvider=createForMetadataProfiles({profiles,env,fetchImpl,now:()=>NOW});
  const transport=async({url,pinnedAddress,headers,maxBytes})=>{providerCalls++;events.push('provider');
    assert.equal(url.origin,profiles[0].allowedOrigin);assert.equal(pinnedAddress.address,'8.8.8.8');
    assert.equal(headers.authorization,'Bearer '+TOKEN);assert.equal(maxBytes,5*1024*1024);
    assert.ok(!Object.values(headers).includes(KEY));
    assert.equal(url.pathname,ns?'/services/rest/record/v1/metadata-catalog/customer':'/odata/v2/EmpJob/$metadata');
    return {status:200,headers:{},elapsedMs:2,text:ns?JSON.stringify({properties:{id:{type:'integer'},companyName:{type:'string'}}}):
      '<Edmx><DataServices><Schema><EntityType Name="EmpJob"><Key><PropertyRef Name="userId"/><PropertyRef Name="startDate"/><PropertyRef Name="seqNumber"/></Key><Property Name="userId" Type="Edm.String"/><Property Name="startDate" Type="Edm.DateTime"/><Property Name="seqNumber" Type="Edm.Int64"/></EntityType></Schema></DataServices></Edmx>'};};
  const options={profiles,env:{},credentialProvider,lookupImpl:async()=>[{address:'8.8.8.8',family:4}],transport,now:()=>new Date(NOW).toISOString(),
    permitProvider:async()=>{events.push('permit');return 'fictional-signed-permit';},permitVerifier:{verifyAndConsume(permit,p){
      assert.equal(permit,'fictional-signed-permit');assert.equal(p.id,binding.profileId);events.push('verify-permit');
      return {keyId:'fixture-key',permitSha256:'a'.repeat(64),jtiSha256:'b'.repeat(64),issuedAt:'2026-10-31T11:59:00.000Z',expiresAt:'2026-10-31T12:01:00.000Z'};}}};
  return {binding,doc,profiles,options,events,calls:()=>({nangoCalls,providerCalls}),actor:{tenant:binding.tenant,email:'admin@example.test'}};
}

for(const provider of ['netsuite','successfactors']) test('actual sealed metadata broker consumes Nango '+provider+' credentials through existing direct transport',async()=>{
  const f=setup(provider),broker=PMB.createBroker(f.options);
  const result=await broker.collect(f.actor,f.binding.profileId);
  assert.equal(result.observation.provider,provider);assert.ok(result.observation.fields.length>=2);
  assert.equal(result.evidence.credentialSource,'short-lived-provider-callback');assert.equal(result.evidence.credentialExpiresAt,'2026-10-31T13:00:00.000Z');
  assert.equal(result.evidence.dnsPinned,true);assert.equal(result.evidence.redirectsAllowed,false);
  assert.equal(result.evidence.collectionPermit.verified,true);assert.equal(broker.status().profiles[0].activationAuthority,false);
  assert.deepEqual(f.events,['permit','verify-permit','credential','provider']);assert.deepEqual(f.calls(),{nangoCalls:1,providerCalls:1});
  assert.ok(!JSON.stringify(result).includes(TOKEN));assert.ok(!JSON.stringify(result).includes(KEY));
});

test('baseline broker without callback still refuses absent credentials; no new activation is implied',async()=>{
  const f=setup();delete f.options.credentialProvider;const broker=PMB.createBroker(f.options);
  await assert.rejects(broker.collect(f.actor,f.binding.profileId),e=>e.code==='WFM_METADATA_BROKER_CREDENTIAL');
  assert.deepEqual(f.calls(),{nangoCalls:0,providerCalls:0});
});

test('disabled Nango loader preserves successful legacy server-token collection through the same broker',async()=>{
  const f=setup();f.options.credentialProvider=createForMetadataProfiles({profiles:f.profiles,env:{}});
  f.options.env={[f.binding.credentialRef]:TOKEN};
  const broker=PMB.createBroker(f.options),result=await broker.collect(f.actor,f.binding.profileId);
  assert.equal(broker.status().credentialMode,'isolated-env-reference');
  assert.equal(result.evidence.credentialSource,'isolated-env-reference');
  assert.equal(result.evidence.dnsPinned,true);assert.equal(result.evidence.redirectsAllowed,false);
  assert.deepEqual(f.events,['permit','verify-permit','provider']);
  assert.deepEqual(f.calls(),{nangoCalls:0,providerCalls:1});
  assert.ok(!JSON.stringify(result).includes(TOKEN));
});

test('wrong tenant and missing permit both stop before credential retrieval',async()=>{
  const f=setup(),broker=PMB.createBroker(f.options);
  await assert.rejects(broker.collect({tenant:'other-tenant'},f.binding.profileId),e=>e.code==='WFM_METADATA_BROKER_PROFILE');
  f.options.permitProvider=async()=>null;
  await assert.rejects(PMB.createBroker(f.options).collect(f.actor,f.binding.profileId),e=>e.code==='WFM_METADATA_BROKER_PERMIT_REQUIRED');
  assert.deepEqual(f.calls(),{nangoCalls:0,providerCalls:0});
});

test('credential ownership refusal never falls back to a legacy token or contacts the provider',async()=>{
  const f=setup();f.doc.tags.vector_tenant_id='another-tenant';f.options.env={[f.binding.credentialRef]:'fictional-legacy-token-that-must-not-be-used'};
  await assert.rejects(PMB.createBroker(f.options).collect(f.actor,f.binding.profileId),e=>e.code==='NANGO_CONNECTION_MISMATCH');
  assert.deepEqual(f.calls(),{nangoCalls:1,providerCalls:0});
});

test('existing private-address egress rejection is preserved after Nango credential resolution',async()=>{
  const f=setup();f.options.lookupImpl=async()=>[{address:'127.0.0.1',family:4}];
  await assert.rejects(PMB.createBroker(f.options).collect(f.actor,f.binding.profileId),e=>e.code==='WFM_METADATA_BROKER_EGRESS_BLOCKED');
  assert.deepEqual(f.calls(),{nangoCalls:1,providerCalls:0});
});
