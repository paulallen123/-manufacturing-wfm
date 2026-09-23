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
assert.ok(Array.isArray(catalog.systems) && catalog.systems.length >= 161, 'Expected >=161 effective systems after research overlays.');
assert.ok(Array.isArray(catalog.protocolFamilies) && catalog.protocolFamilies.length >= 22);
assert.equal(catalog.researchOverlay.newSystems, research.systems.length);
assert.equal(catalog.researchOverlay.overrides, research.overrides.length);
assert.ok(Array.isArray(research.sources) && research.sources.includes('systems-research.json'));
assert.ok(research.sources.some(source => source.startsWith('research-overlays/')), 'Expected at least one composable research overlay.');
assert.ok(Array.isArray(opportunities.profiles) && opportunities.profiles.length >= 14);
assert.ok(opportunities.systemOverrides && typeof opportunities.systemOverrides === 'object');

const allowedMaturity = new Set(catalog.maturityLevels);
const maturityIndex = new Map(catalog.maturityLevels.map((level,index)=>[level,index]));
const firstAuthenticatedIndex = maturityIndex.get('sandbox-authenticated');
const ids = new Set();
for (const s of catalog.systems) {
  assert.match(s.id, /^[a-z0-9][a-z0-9-]*$/);
  assert.ok(!ids.has(s.id), 'Duplicate system id: ' + s.id);
  ids.add(s.id);
  assert.ok(s.name && s.category && s.priority);
  assert.ok(Array.isArray(s.protocols));
  assert.ok(allowedMaturity.has(s.testLevel), 'Unknown test level for ' + s.id + ': ' + s.testLevel);
  assert.equal(s.writeEnabled, false, 'Registry write probes must be disabled by default: ' + s.id);
  if ('customerEdgeRequired' in s) assert.equal(typeof s.customerEdgeRequired, 'boolean', 'customerEdgeRequired must be boolean: ' + s.id);
  if ('securityEvidenceBlockers' in s) {
    assert.ok(Array.isArray(s.securityEvidenceBlockers) && s.securityEvidenceBlockers.length > 0, 'securityEvidenceBlockers must be a non-empty array: ' + s.id);
    for (const blocker of s.securityEvidenceBlockers) assert.ok(typeof blocker === 'string' && blocker.trim().length > 0, 'Invalid security evidence blocker: ' + s.id);
    assert.ok(maturityIndex.get(s.testLevel) < firstAuthenticatedIndex, 'Unresolved security evidence blockers forbid sandbox/tenant/round-trip/production evidence: ' + s.id);
  }
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
  'siemens-industrial-edge','highbyte-intelligence-hub','tulip','cognite-data-fusion',
  'oracle-jd-edwards-enterpriseone','oracle-ebusiness-suite','cornerstone-ondemand','docebo','moodle','intelex',
  'rockwell-factorytalk-datamosaix','aspentech-inmation','korber-werum-pas-x','seeq','canary-historian',
  'trendminer','honeywell-uniformance-phd','safetychain-qms'
]) assert.ok(ids.has(must), 'Required seed missing: ' + must);

for (const family of ['AMQP','Protobuf RPC/HTTP2','Schema Registry','JSON-2','JMS','Sparkplug B']) {
  assert.ok(catalog.protocolFamilies.includes(family), 'Research protocol family missing: ' + family);
}

const byId = new Map(catalog.systems.map(x => [x.id, x]));
assert.equal(byId.get('github').testLevel, 'tenant-authenticated');
assert.equal(byId.get('railway').testLevel, 'tenant-authenticated');
assert.equal(byId.get('microsoft-sharepoint-onedrive').testLevel, 'tenant-authenticated');
assert.ok(byId.get('odoo').protocols.includes('JSON-2'), 'Odoo JSON-2 migration path missing.');
assert.match(byId.get('odoo').evidenceNote || '', /JSON-2/);
assert.match(byId.get('odoo').evidenceNote || '', /bearer API-key/i);
assert.ok(String(byId.get('odoo').docsUrl || '').startsWith('https://'), 'Odoo evidence requires HTTPS provider documentation.');
assert.match(byId.get('oracle-netsuite').evidenceNote || '', /2028\.2/);
assert.ok(byId.get('salto-nebula').protocols.includes('Protobuf RPC/HTTP2'));
assert.ok(byId.get('azure-service-bus').protocols.includes('AMQP 1.0'));
assert.ok(byId.get('ibm-mq').protocols.includes('JMS'));
// Evidence-bound integration promotion checks.
// Do not make the build green by claiming maturity that the catalog evidence does not support.
const evidenceBoundStrategicIds = [
  'jumpcloud','ptc-windchill','aws-iot-sitewise','azure-iot-operations','sap-digital-manufacturing',
  'siemens-industrial-edge','tulip','cognite-data-fusion',
  'oracle-jd-edwards-enterpriseone','oracle-ebusiness-suite',
  'cornerstone-ondemand','docebo','moodle','intelex',
  'rockwell-factorytalk-datamosaix','aspentech-inmation','korber-werum-pas-x',
  'seeq','canary-historian','trendminer','honeywell-uniformance-phd','safetychain-qms'
];
for (const id of evidenceBoundStrategicIds) {
  const system = byId.get(id);
  assert.ok(system, 'Evidence-bound strategic integration missing: ' + id);
  assert.equal(system.testLevel, 'spec-verified', 'Strategic integration is not evidence-promoted: ' + id);
  assert.ok(Array.isArray(system.protocols) && system.protocols.length > 0, 'Spec-verified integration needs a protocol surface: ' + id);
  assert.ok(typeof system.docsUrl === 'string' && system.docsUrl.startsWith('https://'), 'Spec-verified integration needs HTTPS vendor documentation: ' + id);
  assert.ok(
    (typeof system.evidenceUrl === 'string' && system.evidenceUrl.startsWith('https://')) ||
    (typeof system.evidenceNote === 'string' && system.evidenceNote.trim().length > 0) ||
    String(system.researchStatus || '').includes('docs-verified'),
    'Spec-verified integration needs explicit evidence: ' + id
  );
  assert.equal(system.writeEnabled, false, 'Documentation evidence must never silently enable writes: ' + id);
}

// These systems are commercially important but currently lack enough protocol/evidence detail for promotion.
// They may move beyond discovery-queued only when a future research overlay supplies explicit evidence.
const evidencePendingStrategicIds = [
  'ifs-cloud','epicor-kinetic','inductive-automation-ignition','highbyte-intelligence-hub',
  'sap-fieldglass','sap-business-one','microsoft-dynamics-365-business-central',
  'quickbooks-online','deputy','adp-workforce-suite'
];
for (const id of evidencePendingStrategicIds) {
  const system = byId.get(id);
  assert.ok(system, 'Evidence-pending strategic integration missing: ' + id);
  if (system.testLevel === 'spec-verified') {
    assert.ok(typeof system.evidenceUrl === 'string' && system.evidenceUrl.startsWith('https://'), 'Promotion requires evidenceUrl: ' + id);
    assert.ok(typeof system.evidenceNote === 'string' && system.evidenceNote.trim().length > 0, 'Promotion requires evidenceNote: ' + id);
    assert.ok(Array.isArray(system.protocols) && system.protocols.length > 0, 'Promotion requires protocol detail: ' + id);
  } else {
    assert.equal(system.testLevel, 'discovery-queued', 'Unproven strategic integration must remain fail-closed: ' + id);
  }
  assert.equal(system.writeEnabled, false, 'Unproven integration writes must remain disabled: ' + id);
}

// Preserve protocol-specific evidence where it is known.
assert.ok(byId.get('siemens-industrial-edge').protocols.includes('Protobuf RPC/HTTP2'));
assert.ok(byId.get('highbyte-intelligence-hub').protocols.includes('Sparkplug B'));
assert.ok(byId.get('sap-business-one').protocols.includes('OData'));
assert.deepEqual(byId.get('rockwell-factorytalk-datamosaix').protocols,['REST','OpenAPI']);
assert.ok(byId.get('aspentech-inmation').protocols.includes('REST'));
assert.ok(byId.get('aspentech-inmation').protocols.includes('OPC UA'));
assert.ok(byId.get('korber-werum-pas-x').protocols.includes('REST'));
assert.ok(byId.get('korber-werum-pas-x').protocols.includes('industrial-integration'));
assert.deepEqual(byId.get('seeq').protocols,['REST','OData']);
assert.deepEqual(byId.get('canary-historian').protocols,['REST','Protobuf RPC/HTTP2']);
assert.equal(byId.get('canary-historian').customerEdgeRequired,true);
assert.deepEqual(byId.get('trendminer').protocols,['REST']);
assert.ok(byId.get('honeywell-uniformance-phd').protocols.includes('REST'));
assert.ok(byId.get('honeywell-uniformance-phd').protocols.includes('OPC UA'));
assert.ok(byId.get('honeywell-uniformance-phd').protocols.includes('JDBC/ODBC'));
assert.equal(byId.get('honeywell-uniformance-phd').customerEdgeRequired,true);
assert.deepEqual(byId.get('safetychain-qms').protocols,['REST']);
assert.equal(byId.get('safetychain-qms').customerEdgeRequired,false);
assert.ok(Array.isArray(byId.get('safetychain-qms').securityEvidenceBlockers) && byId.get('safetychain-qms').securityEvidenceBlockers.length >= 2);

for(const id of ['sap-digital-manufacturing','ptc-windchill','aws-iot-sitewise','azure-iot-operations','jumpcloud','ibm-mq','sap-fieldglass']){
  assert.ok(opportunities.systemOverrides[id], 'System-specific value/data review missing: '+id);
}

// Inline customer-value reviews are evidence artefacts, not a prerequisite for claiming unsupported maturity.
// Validate every review that does exist and protect the current reviewed baseline from regression.
const inlineVendorReviewed = catalog.systems.filter(system=>system.valueReview?.basis==='vendor-docs');
assert.ok(inlineVendorReviewed.length >= 16, 'Vendor-reviewed integration baseline regressed.');
for (const system of inlineVendorReviewed) {
  const review = system.valueReview;
  assert.ok(Array.isArray(review.customerValue) && review.customerValue.length > 0, 'Inline customer value review missing: ' + system.id);
  const valueActions = [
    ...(Array.isArray(review.savingsHypotheses) ? review.savingsHypotheses : []),
    ...(Array.isArray(review.automationOpportunities) ? review.automationOpportunities : [])
  ];
  assert.ok(valueActions.length > 0, 'Inline value/action hypotheses missing: ' + system.id);
  const riskEvidence = [
    ...(Array.isArray(review.constraintsRisks) ? review.constraintsRisks : []),
    ...(Array.isArray(system.securityEvidenceBlockers) ? system.securityEvidenceBlockers : []),
    ...(Array.isArray(system.failureModes) ? system.failureModes : [])
  ];
  assert.ok(riskEvidence.length > 0, 'Inline integration risk evidence missing: ' + system.id);
}

const specVerifiedCount = catalog.systems.filter(system=>system.testLevel==='spec-verified').length;
assert.ok(specVerifiedCount >= 60, 'Spec-verified integration coverage unexpectedly regressed.');

assert.match(contract, /^openapi: 3\.0\.3/m);
for (const path of ['/connectors','/workers','/shifts','/time-events','/production-events','/access-events','/qualifications','/training-completions','/worker-restrictions','/safety-signals','/events','/webhooks/{connectorId}']) {
  assert.ok(contract.includes('  ' + path + ':'), 'OpenAPI path missing: ' + path);
}
for (const schema of ['Qualification','TrainingCompletion','WorkerRestriction','SafetySignal']) assert.ok(contract.includes('    '+schema+':'), 'Canonical schema missing: '+schema);
assert.ok(!/\n\s+(?:medicalDetail|medicalRecord|incidentNarrative|investigationNarrative):/i.test(contract), 'Canonical contract must not add raw medical or investigation narrative fields.');
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
