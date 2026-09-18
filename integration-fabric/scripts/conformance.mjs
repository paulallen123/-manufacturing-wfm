import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadCatalog} from './load-catalog.mjs';

const catalog=loadCatalog();
const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));
const matches=new Set(protocols.profiles.flatMap(p=>p.matches));

const p0=catalog.systems.filter(x=>x.priority==='P0');
const uncovered=p0.filter(x=>!x.protocols.some(p=>matches.has(p)));
assert.deepEqual(uncovered.map(x=>x.id),[], 'Every P0 system must map to at least one reusable protocol/vendor profile.');

const highConfidence=new Set(['tenant-authenticated','read-roundtrip-proven','write-roundtrip-proven','production-certified']);
for(const s of catalog.systems){
  assert.equal(s.writeEnabled,false,'Connector writes must remain disabled by default: '+s.id);
  assert.notEqual(s.testLevel,'external-connected','Ambiguous external-connected evidence is forbidden; use the explicit maturity ladder: '+s.id);
  if(highConfidence.has(s.testLevel)){
    assert.ok(s.evidenceRef,'High-confidence evidence requires evidenceRef: '+s.id);
  }
}

const ipaas=['mulesoft-anypoint','boomi','workato','sap-integration-suite','azure-logic-apps-power-automate','oracle-integration-cloud','google-cloud-application-integration','jitterbit-harmony'];
for(const id of ipaas) assert.ok(catalog.systems.some(x=>x.id===id),'iPaaS target missing: '+id);

for(const id of ['salto-nebula','azure-service-bus','confluent-cloud']){
  const system=catalog.systems.find(x=>x.id===id);
  assert.ok(system,'Research target missing: '+id);
  assert.ok(system.protocols.some(p=>matches.has(p)),'Research target has no reusable protocol mapping: '+id);
}

const requiredProfiles=['rest-openapi','odata','soap','graphql','scim','webhooks-events','files-sftp','database','opcua','mqtt','bacnet','modbus','edi','kafka','amqp','protobuf-rpc-http2','schema-registry','legacy-rpc'];
const profileIds=new Set(protocols.profiles.map(x=>x.id));
for(const id of requiredProfiles) assert.ok(profileIds.has(id),'Reusable protocol profile missing: '+id);

console.log(JSON.stringify({ok:true,p0:p0.length,profiles:protocols.profiles.length,uncoveredP0:uncovered.length,ipaasTargets:ipaas.length,tenantAuthenticated:catalog.systems.filter(x=>x.testLevel==='tenant-authenticated').length},null,2));
