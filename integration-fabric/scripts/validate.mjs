import fs from 'node:fs';
import assert from 'node:assert/strict';
import {loadCatalog, loadResearchDelta} from './load-catalog.mjs';

const catalog = loadCatalog();
const research = loadResearchDelta();
const contract = fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');
const opportunities = JSON.parse(fs.readFileSync(new URL('../opportunity-profiles.json', import.meta.url), 'utf8'));

assert.equal(catalog.schemaVersion, 1);
assert.equal(research.schemaVersion, 1);
assert.equal(opportunities.schemaVersion, 1);
assert.ok(Array.isArray(catalog.systems) && catalog.systems.length >= 155, 'Expected >=155 effective systems after research overlays.');
assert.ok(Array.isArray(catalog.protocolFamilies) && catalog.protocolFamilies.length >= 22);
assert.equal(catalog.researchOverlay.newSystems, research.systems.length);
assert.equal(catalog.researchOverlay.overrides, research.overrides.length);
assert.ok(Array.isArray(research.sources) && research.sources.includes('systems-research.json'));
assert.ok(research.sources.some(source => source.startsWith('research-overlays/')), 'Expected at least one composable research overlay.');
assert.ok(Array.isArray(opportunities.profiles) && opportunities.profiles.length >= 12);
assert.ok(opportunities.systemOverrides && typeof opportunities.systemOverrides === 'object');

const allowedMaturity = new Set(catalog.maturityLevels);
const ids = new Set();
for (const s of catalog.systems) {
  assert.match(s.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(!ids.has(s.id), 'Duplicate system id: ' + s.id);
  ids.add(s.id);
  assert.ok(s.name && s.category && s.priority);
  assert.ok(Array.isArray(s.protocols));
  assert.ok(allowedMaturity.has(s.testLevel), 'Unknown test level for ' + s.id + ': ' + s.testLevel);
  assert.equal(s.writeEnabled, false, 'Registry write probes must be disabled by default: ' + s.id);
  if (s.docsUrl) {
    const u = new URL(s.docsUrl);
    assert.equal(u.protocol, 'https:', 'Documentation URLs must use HTTPS.');
  }
  const opportunityMatches=opportunities.profiles.filter(profile=>
    Array.isArray(profile.categoryIncludes) && profile.categoryIncludes.some(token=>s.category.includes(token))
  );
  assert.ok(opportunityMatches.length>0, 'Every catalogued system must map to at least one WFM opportunity profile: '+s.id+' ('+s.category+')');
}

for (const must of [
  'sap-s4hana','sap-successfactors','oracle-netsuite','workday','oracle-fusion-hcm',
  'microsoft-dynamics-365-finance-scm','sage-x3','adp-workforce-now','dayforce',
  'ukg-pro-wfm','xero','microsoft-entra-id','okta','google-workspace',
  'gallagher-command-centre','genetec-security-center','brivo','kisi',
  'mulesoft-anypoint','boomi','workato',
  'salto-nebula','infor-workforce-management','adp-workforce-suite',
  'google-cloud-application-integration','azure-service-bus','confluent-cloud',
  'jitterbit-harmony','ifs-ultimo','beckhoff-twincat-opcua','onelogin',
  'axway-b2bi','veeva-vault-quality','ibm-mq','jumpcloud','sap-fieldglass',
  'siemens-industrial-edge','highbyte-intelligence-hub','tulip','cognite-data-fusion'
]) assert.ok(ids.has(must), 'Required seed missing: ' + must);

for (const family of ['AMQP','Protobuf RPC/HTTP2','Schema Registry','JSON-2','JMS','Sparkplug B']) {
  assert.ok(catalog.protocolFamilies.includes(family), 'Research protocol family missing: ' + family);
}

const byId = new Map(catalog.systems.map(x => [x.id, x]));
assert.equal(byId.get('github').testLevel, 'tenant-authenticated');
assert.equal(byId.get('railway').testLevel, 'tenant-authenticated');
assert.equal(byId.get('microsoft-sharepoint-onedrive').testLevel, 'tenant-authenticated');
assert.ok(byId.get('odoo').protocols.includes('JSON-2'), 'Odoo JSON-2 migration path missing.');
assert.match(byId.get('odoo').evidenceNote || '', /Odoo 22/);
assert.match(byId.get('oracle-netsuite').evidenceNote || '', /2028\.2/);
assert.ok(byId.get('salto-nebula').protocols.includes('Protobuf RPC/HTTP2'));
assert.ok(byId.get('azure-service-bus').protocols.includes('AMQP 1.0'));
assert.ok(byId.get('ibm-mq').protocols.includes('JMS'));
assert.equal(byId.get('jumpcloud').testLevel,'spec-verified');
assert.equal(byId.get('ptc-windchill').testLevel,'spec-verified');
assert.equal(byId.get('aws-iot-sitewise').testLevel,'spec-verified');
assert.equal(byId.get('azure-iot-operations').testLevel,'spec-verified');
assert.equal(byId.get('sap-digital-manufacturing').testLevel,'spec-verified');
assert.equal(byId.get('ifs-cloud').testLevel,'spec-verified');
assert.equal(byId.get('epicor-kinetic').testLevel,'spec-verified');
assert.equal(byId.get('inductive-automation-ignition').testLevel,'spec-verified');
assert.equal(byId.get('siemens-industrial-edge').testLevel,'spec-verified');
assert.ok(byId.get('siemens-industrial-edge').protocols.includes('Protobuf RPC/HTTP2'));
assert.equal(byId.get('highbyte-intelligence-hub').testLevel,'spec-verified');
assert.ok(byId.get('highbyte-intelligence-hub').protocols.includes('Sparkplug B'));
assert.equal(byId.get('tulip').testLevel,'spec-verified');
assert.equal(byId.get('cognite-data-fusion').testLevel,'spec-verified');
assert.equal(byId.get('sap-fieldglass').testLevel,'spec-verified');
assert.ok(byId.get('sap-fieldglass').protocols.includes('REST'));
assert.ok(byId.get('sap-fieldglass').protocols.includes('SCIM'));

for(const id of ['sap-digital-manufacturing','ptc-windchill','aws-iot-sitewise','azure-iot-operations','jumpcloud','ibm-mq','sap-fieldglass']){
  assert.ok(opportunities.systemOverrides[id], 'System-specific value/data review missing: '+id);
}
for(const id of ['ifs-cloud','epicor-kinetic','inductive-automation-ignition','siemens-industrial-edge','highbyte-intelligence-hub','tulip','celigo-integrator-io','cognite-data-fusion','sap-fieldglass']){
  const review=byId.get(id).valueReview;
  assert.equal(review?.basis,'vendor-docs','Inline vendor value/data review missing vendor-doc basis: '+id);
  assert.ok(Array.isArray(review.customerValue)&&review.customerValue.length>0,'Inline customer value review missing: '+id);
  assert.ok(Array.isArray(review.savingsHypotheses)&&review.savingsHypotheses.length>0,'Inline savings hypotheses missing: '+id);
  assert.ok(Array.isArray(review.constraintsRisks)&&review.constraintsRisks.length>0,'Inline risk review missing: '+id);
}

assert.match(contract, /^openapi: 3\.0\.3/m);
for (const path of ['/connectors','/workers','/shifts','/time-events','/production-events','/access-events','/events','/webhooks/{connectorId}']) {
  assert.ok(contract.includes('  ' + path + ':'), 'OpenAPI path missing: ' + path);
}
const inlineVendorReviews=catalog.systems.filter(system=>system.valueReview?.basis==='vendor-docs').length;
console.log(JSON.stringify({
  ok:true,
  systems:catalog.systems.length,
  researchSources:research.sources.length,
  researchSystems:research.systems.length,
  researchOverrides:research.overrides.length,
  categories:[...new Set(catalog.systems.map(x=>x.category))].length,
  protocolFamilies:catalog.protocolFamilies.length,
  p0:catalog.systems.filter(x=>x.priority==='P0').length,
  specVerified:catalog.systems.filter(x=>x.testLevel==='spec-verified').length,
  tenantAuthenticated:catalog.systems.filter(x=>x.testLevel==='tenant-authenticated').length,
  opportunityProfiles:opportunities.profiles.length,
  centralSystemSpecificOpportunityReviews:Object.keys(opportunities.systemOverrides).length,
  inlineVendorValueReviews:inlineVendorReviews
}, null, 2));
