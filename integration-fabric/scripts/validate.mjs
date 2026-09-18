import fs from 'node:fs';
import assert from 'node:assert/strict';

const catalog = JSON.parse(fs.readFileSync(new URL('../systems.json', import.meta.url), 'utf8'));
const contract = fs.readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8');

assert.equal(catalog.schemaVersion, 1);
assert.ok(Array.isArray(catalog.systems) && catalog.systems.length >= 100, 'Expected >=100 seeded systems.');
assert.ok(Array.isArray(catalog.protocolFamilies) && catalog.protocolFamilies.length >= 12);

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
}
for (const must of [
  'sap-s4hana','sap-successfactors','oracle-netsuite','workday','oracle-fusion-hcm',
  'microsoft-dynamics-365-finance-scm','sage-x3','adp-workforce-now','dayforce',
  'ukg-pro-wfm','xero','microsoft-entra-id','okta','google-workspace',
  'gallagher-command-centre','genetec-security-center','brivo','kisi',
  'mulesoft-anypoint','boomi','workato'
]) assert.ok(ids.has(must), 'Required seed missing: ' + must);

assert.match(contract, /^openapi: 3\.0\.3/m);
for (const path of ['/connectors','/workers','/shifts','/time-events','/production-events','/access-events','/events','/webhooks/{connectorId}']) {
  assert.ok(contract.includes('  ' + path + ':'), 'OpenAPI path missing: ' + path);
}
console.log(JSON.stringify({
  ok:true,
  systems:catalog.systems.length,
  categories:[...new Set(catalog.systems.map(x=>x.category))].length,
  protocolFamilies:catalog.protocolFamilies.length,
  p0:catalog.systems.filter(x=>x.priority==='P0').length,
  specVerified:catalog.systems.filter(x=>x.testLevel==='spec-verified').length
}, null, 2));
