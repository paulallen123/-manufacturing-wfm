#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const runtime=path.resolve(process.argv[2]||'');
assert(process.argv[2]&&path.isAbsolute(runtime),'Usage: compose-vector-local-runtime.mjs /absolute/extracted/runtime');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const expected={
 'server.cjs':'1792f544d0fea25577f683f3df957b4f74b6a086cd0479b24b1fe77f58587dd0',
 'lib/outbound-integration.cjs':'7e7b3126ac7fdd5712fc5fc7299e3c75893bc699f7ed200dbba29b914c2bf9d4',
 'lib/transactional-outbound-bridge.cjs':'52f890d30bde3e657e8e95d2f4db25d075ebdc8c8cf3be3bd4331b40c072e81f'
};
const packageManifest=JSON.parse(await readFile(path.join(runtime,'PACKAGE_MANIFEST_SHA256.json'),'utf8'));
const runtimeManifestBytes=await readFile(path.join(runtime,'RUNTIME_MANIFEST.json'));
assert.equal(hash(runtimeManifestBytes),packageManifest.files?.['RUNTIME_MANIFEST.json'],'sealed runtime manifest digest changed');
const runtimeManifest=JSON.parse(runtimeManifestBytes);
assert.equal(Object.keys(runtimeManifest).length,133,'sealed runtime manifest coverage changed');
for(const [relative,digest] of Object.entries(expected))assert.equal(hash(await readFile(path.join(runtime,relative))),digest,`sealed source drift: ${relative}`);
for(const [relative,digest] of Object.entries(expected))assert.equal(runtimeManifest[relative],digest,`sealed manifest mismatch: ${relative}`);

const integrationDir=path.join(runtime,'integrations','staffology');
await mkdir(integrationDir,{recursive:true});
for(const file of ['staffology-adapter.cjs','canonical-runtime-bridge.cjs','canonical-production-boundaries.cjs'])await copyFile(path.join(root,'integrations','staffology',file),path.join(integrationDir,file));

const serverPath=path.join(runtime,'server.cjs');
let server=await readFile(serverPath,'utf8');
const importAnchor="const IG=require('./lib/integration-gateway.cjs')";
assert.equal(server.split(importAnchor).length,2,'server integration import anchor changed');
server=server.replace(importAnchor,"const StaffologyIntegration=require('./integrations/staffology/canonical-runtime-bridge.cjs');\nconst StaffologyBoundaries=require('./integrations/staffology/canonical-production-boundaries.cjs');\n"+importAnchor);
const runtimeAnchor="outboundSenders=new Map(outboundConfigs.map(cfg=>[cfg.id,OI.createRestSender(cfg)]));";
assert.equal(server.split(runtimeAnchor).length,2,'server integration construction anchor changed');
server=server.replace(runtimeAnchor,runtimeAnchor+"\nconst staffologyBoundaries=StaffologyBoundaries.createBoundaries({db});\nconst staffologyIntegration=StaffologyIntegration.createRuntime({loadState:load,productionBoundaries:staffologyBoundaries,stagePeople:(actor,envelope,receipt)=>{const cfg=inboundConnectorConfigs.find(row=>row.id===receipt.connectorId&&row.tenant===actor.tenant&&String(row.provider).toLowerCase()==='staffology'&&row.objectTypes.includes('people'));E.assert(cfg,'Reviewed Staffology people connector is unavailable.',503);return integrations.stage(cfg,envelope,receipt.idempotencyKey,(objectType,record)=>prepareInboundIntegration(objectType,record,cfg));}});");
const reportAnchor="return json(res,200,{...report,jobs:providerJobs.report(a)";
assert.equal(server.split(reportAnchor).length,2,'server integration report anchor changed');
server=server.replace(reportAnchor,"return json(res,200,{...report,staffology:staffologyIntegration.status(),jobs:providerJobs.report(a)");
await writeFile(serverPath,server);

const receipt={schemaVersion:1,sealedRuntimePreserved:true,activationAvailable:false,sourceHashes:expected,assembledFiles:{adapter:hash(await readFile(path.join(integrationDir,'staffology-adapter.cjs'))),bridge:hash(await readFile(path.join(integrationDir,'canonical-runtime-bridge.cjs'))),productionBoundaries:hash(await readFile(path.join(integrationDir,'canonical-production-boundaries.cjs'))),server:hash(await readFile(serverPath))}};
await writeFile(path.join(runtime,'STAFFOLOGY_ASSEMBLY.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
