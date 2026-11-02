'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { loadLibrary } = require('../test-support/sealed-nango-broker.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts/compose-vector-local-runtime.mjs'), 'utf8');
const match = source.match(/^function composeNangoMetadata\(runtime, server\) \{[\s\S]*?^\}/m);
assert.ok(match, 'actual supported composer contains the Nango hook');
const runtime = path.dirname(loadLibrary());
const original = fs.readFileSync(path.join(runtime, 'server.cjs'), 'utf8');
const recorded = [];
const invoke = vm.compileFunction('return (' + match[0] + ')(runtime, server);', ['runtime','server'], {
  parsingContext: vm.createContext({ fs, path, root, recordInput: file => recorded.push(file) })
});
const hash = value => createHash('sha256').update(value).digest('hex');

test('actual composer hook installs resolver and presentation projection without changing provider transport or preview authority', () => {
  const result=invoke(runtime,original),installed=path.join(runtime,'integration-runtime/nango-credential-provider.cjs');
  assert.equal(hash(fs.readFileSync(installed)),hash(fs.readFileSync(path.join(root,'integration/runtime/nango-credential-provider.cjs'))));
  const reviewPath=path.join(runtime,'integration-runtime/provider-metadata-review.cjs');
  assert.equal(hash(fs.readFileSync(reviewPath)),hash(fs.readFileSync(path.join(root,'integration/runtime/provider-metadata-review.cjs'))));
  assert.deepEqual(recorded,['integration/runtime/nango-credential-provider.cjs','integration/runtime/provider-metadata-review.cjs']);
  assert.equal(result.includes("const NangoCredentialProvider=require('./integration-runtime/nango-credential-provider.cjs');"),true);
  assert.equal(result.includes('credentialProvider:NangoCredentialProvider.createForMetadataProfiles({profiles:providerMetadataProfiles,env:process.env})'),true);
  assert.equal(result.includes('transport:Nango'),false);
  assert.doesNotThrow(()=>new vm.Script(result,{filename:'composed-server.cjs'}));
  // Exercise the exact constructor expression emitted by the hook with real modules.
  const expression=result.split('providerMetadataBroker=')[1].split(',providerJobs=')[0];
  const PMB=require(path.join(runtime,'lib/provider-metadata-broker.cjs'));
  const NangoCredentialProvider=require(installed);
  const instantiate=(profiles,env)=>vm.runInNewContext(expression,{PMB,NangoCredentialProvider,providerMetadataProfiles:profiles,
    providerCollectionPermitRuntime:{verifier:null,permitProvider:null},process:{env}});
  assert.equal(instantiate([],{}).status().credentialMode,'isolated-env-reference');
  const profiles=PMB.parseProfiles([{id:'ns-fixture',tenant:'fixture-tenant',provider:'netsuite',system:'NetSuite',credentialEnv:'WFM_BROKER_TOKEN_NS_FIXTURE',
    accountId:'1234567_SB1',query:'SELECT id FROM customer ORDER BY id',uniqueOrderColumns:['id'],methods:[{method:'rest'}]}]);
  const binding={tenant:'fixture-tenant',profileId:'ns-fixture',provider:'netsuite',system:'NetSuite',credentialRef:'WFM_BROKER_TOKEN_NS_FIXTURE',
    integrationId:'netsuite',connectionId:'fixture-connection',expectedConnectionConfig:{accountId:'1234567_SB1'}};
  const enabled=instantiate(profiles,{WFM_NANGO_METADATA_BINDINGS_JSON:JSON.stringify([binding]),WFM_NANGO_API_KEY:'fictional-nango-environment-key'});
  assert.equal(enabled.status().credentialMode,'short-lived-provider-callback');
  assert.equal(enabled.status().profiles[0].activationAuthority,false);
  const controllerStart="if(url.pathname==='/api/integrations/discovery/broker-preview'&&req.method==='POST'){";
  const controllerEnd="if(url.pathname==='/api/integrations/discovery/preview'&&req.method==='POST'){";
  const controller=server=>server.slice(server.indexOf(controllerStart),server.indexOf(controllerEnd));
  assert.equal(controller(result),controller(original),'Existing configure/body/tenant/permit/preview contract is unchanged');
});

test('the emitted status expression projects only the trusted actor tenant before HTTP exposure',()=>{
  const result=invoke(runtime,original),PMB=require(path.join(runtime,'lib/provider-metadata-broker.cjs'));
  const ProviderMetadataReview=require(path.join(runtime,'integration-runtime/provider-metadata-review.cjs'));
  const expression=result.match(/providerMetadataBroker:(ProviderMetadataReview\.statusForActor\(providerMetadataBroker\.status\(\),a\))/);
  assert.ok(expression,'Projection must wrap the existing response field using authenticated actor a');
  const base={provider:'netsuite',system:'NetSuite',credentialEnv:'WFM_BROKER_TOKEN_PRIVATE',accountId:'1234567_SB1',
    query:'SELECT id FROM customer ORDER BY id',uniqueOrderColumns:['id'],methods:[{method:'rest'}]};
  const providerMetadataBroker=PMB.createBroker({profiles:PMB.parseProfiles([
    {...base,id:'own-profile',tenant:'own-tenant'},{...base,id:'foreign-profile',tenant:'foreign-tenant'}])});
  const run=a=>vm.runInNewContext(expression[1],{ProviderMetadataReview,providerMetadataBroker,a});
  const value=run({tenant:'own-tenant',permissions:['company.configure']});
  assert.deepEqual(JSON.parse(JSON.stringify(value.profiles)),[{id:'own-profile',provider:'netsuite',system:'NetSuite'}]);
  assert.equal(value.configured,true);
  assert.doesNotMatch(JSON.stringify(value),/foreign|tenant|credential|origin|WFM_/i);
  assert.equal(run({tenant:'empty-tenant',permissions:['company.configure']}).configured,false);
  assert.throws(()=>run({tenant:'own-tenant',role:'admin',permissions:[]}),error=>error.status===403);
  assert.equal(providerMetadataBroker.status().profiles.length,2,'Private broker state and existing internal consumers stay unchanged');
});

test('composer refuses drift, duplicate anchors and repeat application',()=>{
  assert.throws(()=>invoke(runtime,original.replace('providerMetadataBroker=PMB.createBroker','renamedBroker=PMB.createBroker')),/NANGO_METADATA_BROKER_ANCHOR_CHANGED/);
  assert.throws(()=>invoke(runtime,original.replace('providerMetadataBroker:providerMetadataBroker.status()','providerMetadataBroker:{}')),/NANGO_METADATA_BROKER_ANCHOR_CHANGED/);
  assert.throws(()=>invoke(runtime,original+'\n'+original),/NANGO_METADATA_BROKER_ANCHOR_CHANGED/);
  assert.throws(()=>invoke(runtime,invoke(runtime,original)),/NANGO_METADATA_BROKER_ANCHOR_CHANGED/);
});

test('both assembly entry paths invoke the hook before server write, and Docker admits source plus installed tests',()=>{
  assert.equal((source.match(/server = composeNangoMetadata\(runtime, server\);/g)||[]).length,1);
  assert.ok(source.indexOf('server = composeNangoMetadata(runtime, server);')<source.indexOf('fs.writeFileSync(serverPath, server);'));
  assert.ok(source.includes('const result=composeStaffology(output)'));
  assert.ok(source.includes('\ncomposeStaffology(output);'));
  const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
  const copy='COPY integration/runtime/nango-credential-provider.cjs /workspace/integration/runtime/';
  assert.ok(docker.includes(copy));assert.ok(docker.indexOf(copy)<docker.indexOf('RUN node /workspace/scripts/compose-vector-local-runtime.mjs /app'));
  assert.ok(docker.includes('RUN node integration/runtime/nango-credential-provider.test.cjs'));
  assert.ok(docker.includes('node integration/runtime/nango-metadata-broker.test.cjs'));
  assert.ok(docker.includes('node scripts/nango-metadata-wiring.test.cjs'));
  assert.ok(docker.includes('VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime node /tmp/wfm-nango/integration/runtime/nango-credential-provider.test.cjs'));
  assert.ok(docker.includes('VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime VECTOR_NANGO_BROKER_ROOT=/app/lib node /tmp/wfm-nango/integration/runtime/nango-metadata-broker.test.cjs'));
  assert.ok(docker.includes('COPY integration/runtime/provider-metadata-review.cjs /workspace/integration/runtime/'));
  assert.ok(docker.includes('node integration/runtime/provider-metadata-review.test.cjs'));
  assert.ok(docker.includes('node ux-overlay/vector-provider-metadata.test.cjs'));
  assert.ok(docker.includes('VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime node /tmp/wfm-nango/integration/runtime/provider-metadata-review.test.cjs'));
  const installed='RUN VECTOR_METADATA_UI_SOURCE=/app/public/vector-ui.js VECTOR_NANGO_RUNTIME_ROOT=/app/integration-runtime VECTOR_NANGO_BROKER_ROOT=/app/lib node /tmp/vector-metadata/ux-overlay/vector-provider-metadata.test.cjs';
  assert.ok(docker.includes(installed));
  assert.ok(docker.indexOf(installed)>docker.indexOf('&& node /tmp/sanitize-customer-public-bundle.mjs /app/public'),'Installed UI test follows final public bundle composition and sanitation');
  const forge=fs.readFileSync(path.join(root,'scripts/run-forge-ci.mjs'),'utf8');
  assert.ok(forge.includes("['node', ['integration/runtime/provider-metadata-review.test.cjs']]"));
  assert.ok(forge.includes("['node', ['ux-overlay/vector-provider-metadata.test.cjs']]"));
});
