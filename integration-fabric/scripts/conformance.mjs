import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadCatalog} from './load-catalog.mjs';

const catalog=loadCatalog();
const protocols=JSON.parse(fs.readFileSync(new URL('../protocol-profiles.json',import.meta.url),'utf8'));
const opportunities=JSON.parse(fs.readFileSync(new URL('../opportunity-profiles.json',import.meta.url),'utf8'));
const matches=new Set(protocols.profiles.flatMap(p=>p.matches));

const p0=catalog.systems.filter(x=>x.priority==='P0');
const uncovered=p0.filter(x=>!x.protocols.some(p=>matches.has(p)));
assert.deepEqual(uncovered.map(x=>x.id),[], 'Every P0 system must map to at least one reusable protocol/vendor profile.');
const uncoveredAll=catalog.systems.filter(x=>!x.protocols.some(p=>matches.has(p)));
assert.deepEqual(uncoveredAll.map(x=>x.id),[], 'Every catalogued system must map to at least one reusable protocol/vendor profile.');

const highConfidence=new Set(['tenant-authenticated','read-roundtrip-proven','write-roundtrip-proven','production-certified']);
for(const s of catalog.systems){
  assert.equal(s.writeEnabled,false,'Connector writes must remain disabled by default: '+s.id);
  assert.notEqual(s.testLevel,'external-connected','Ambiguous external-connected evidence is forbidden; use the explicit maturity ladder: '+s.id);
  if(highConfidence.has(s.testLevel)){
    assert.ok(s.evidenceRef,'High-confidence evidence requires evidenceRef: '+s.id);
  }
  const valueProfiles=opportunities.profiles.filter(profile=>profile.categoryIncludes.some(token=>s.category.includes(token)));
  assert.ok(valueProfiles.length>0,'Every system requires an explicit WFM data/value profile: '+s.id);
}

const ipaas=['mulesoft-anypoint','boomi','workato','sap-integration-suite','azure-logic-apps-power-automate','oracle-integration-cloud','google-cloud-application-integration','jitterbit-harmony'];
for(const id of ipaas) assert.ok(catalog.systems.some(x=>x.id===id),'iPaaS target missing: '+id);

for(const id of ['salto-nebula','azure-service-bus','confluent-cloud','ibm-mq','jumpcloud','highbyte-intelligence-hub','tulip','cognite-data-fusion','sap-fieldglass','oracle-jd-edwards-enterpriseone','oracle-ebusiness-suite','cornerstone-ondemand','docebo','moodle','intelex']){
  const system=catalog.systems.find(x=>x.id===id);
  assert.ok(system,'Research target missing: '+id);
  assert.ok(system.protocols.some(p=>matches.has(p)),'Research target has no reusable protocol mapping: '+id);
}

const requiredProfiles=['rest-openapi','odata','soap','graphql','scim','webhooks-events','files-sftp','database','opcua','mqtt','bacnet','modbus','edi','kafka','amqp','jms','protobuf-rpc-http2','schema-registry','legacy-rpc'];
const profileIds=new Set(protocols.profiles.map(x=>x.id));
for(const id of requiredProfiles) assert.ok(profileIds.has(id),'Reusable protocol profile missing: '+id);

const mq=catalog.systems.find(x=>x.id==='ibm-mq');
assert.ok(mq.protocols.includes('AMQP 1.0')&&mq.protocols.includes('JMS'),'IBM MQ must retain both standards paths.');
const highbyte=catalog.systems.find(x=>x.id==='highbyte-intelligence-hub');
assert.ok(highbyte.protocols.includes('Sparkplug B'),'HighByte must retain the explicit Sparkplug B route.');
assert.ok(matches.has('Sparkplug B'),'Sparkplug B must map to a reusable MQTT protocol profile.');
const fieldglass=catalog.systems.find(x=>x.id==='sap-fieldglass');
assert.equal(fieldglass.testLevel,'spec-verified','Fieldglass should be spec-verified from current SAP protocol documentation.');
assert.ok(fieldglass.protocols.includes('REST')&&fieldglass.protocols.includes('SCIM'),'Fieldglass must retain REST and SCIM integration paths.');
for (const id of ['cornerstone-ondemand','docebo','moodle']) {
  const system=catalog.systems.find(x=>x.id===id);
  assert.ok(system.category.includes('lms')||system.category.includes('learning'),'Learning platform category missing: '+id);
}
const adpSuite=catalog.systems.find(x=>x.id==='adp-workforce-suite');
assert.equal(adpSuite.testLevel,'spec-verified','ADP WorkForce Suite must retain product-specific protocol evidence.');
assert.ok(adpSuite.protocols.includes('REST')&&adpSuite.protocols.includes('SOAP')&&adpSuite.protocols.includes('files'),'ADP WorkForce Suite must retain REST, SOAP and file integration paths.');
const intelex=catalog.systems.find(x=>x.id==='intelex');
assert.ok(intelex.category.includes('ehs'),'Intelex must retain EHS opportunity coverage.');

console.log(JSON.stringify({
  ok:true,
  p0:p0.length,
  profiles:protocols.profiles.length,
  uncoveredP0:uncovered.length,
  uncoveredAll:uncoveredAll.length,
  ipaasTargets:ipaas.length,
  tenantAuthenticated:catalog.systems.filter(x=>x.testLevel==='tenant-authenticated').length,
  opportunityProfiles:opportunities.profiles.length,
  systemSpecificOpportunityReviews:Object.keys(opportunities.systemOverrides||{}).length
},null,2));
