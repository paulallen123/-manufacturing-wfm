import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAasxEnvironment } from '../../src/frontier/aasx-package-selector.mjs';

const rootRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://admin-shell.io/aasx/relationships/aasx-origin" Target="aasx/aasx-origin"/></Relationships>`;
const originRels = (targets) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((t,i)=>`<Relationship Id="s${i}" Type="http://admin-shell.io/aasx/relationships/aas-spec" Target="${t}"/>`).join('')}</Relationships>`;
const supplementaryRels = (relationships) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map((rel,i)=>`<Relationship Id="${rel.id ?? `f${i}`}" Type="http://admin-shell.io/aasx/relationships/aas-suppl" Target="${rel.target}"${rel.targetMode ? ` TargetMode="${rel.targetMode}"` : ''}/>`).join('')}</Relationships>`;
const env = { assetAdministrationShells: [], submodels: [{ id: 'urn:sm:1', submodelElements: [] }], conceptDescriptions: [] };
const xmlEnv = `<environment xmlns="https://admin-shell.io/aas/3/2"><submodels><submodel><id>urn:sm:1</id></submodel></submodels></environment>`;
const entry = (path, content, extra={}) => ({ path, content, size: Buffer.byteLength(String(content)), ...extra });
const binaryEntry = (path, size, extra={}) => ({ path, size, ...extra });
const packageWith = (targets, payloads) => [
  entry('_rels/.rels', rootRels),
  entry('aasx/aasx-origin', 'Intentionally empty'),
  entry('aasx/_rels/aasx-origin.rels', originRels(targets)),
  ...payloads,
];

test('selects relationship-targeted JSON without assuming the filename', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.json'], [entry('models/site-a.aas.json', JSON.stringify(env))]));
  assert.equal(result.status, 'accepted');
  assert.equal(result.selectedPath, 'models/site-a.aas.json');
  assert.equal(result.environment.submodels[0].id, 'urn:sm:1');
  assert.equal(result.supplementaryArtifactCount, 0);
});

test('accepts relationship-targeted AAS 3.x XML and decodes it into the same environment contract', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [entry('models/site-a.aas.xml', xmlEnv)]));
  assert.equal(result.status, 'accepted');
  assert.equal(result.format, 'xml');
  assert.equal(result.environment.submodels[0].id, 'urn:sm:1');
  assert.equal(result.xmlNamespace, 'https://admin-shell.io/aas/3/2');
});

test('accepts JSON and XML serializations only when their decoded environments agree', () => {
  const result = selectAasxEnvironment(packageWith(['../models/data.json','../models/data.xml'], [
    entry('models/data.json', JSON.stringify(env)),
    entry('models/data.xml', xmlEnv),
  ]));
  assert.equal(result.status, 'accepted');
  assert.equal(result.equivalentSerializations, 2);
  assert.equal(result.jsonSerializations, 1);
  assert.equal(result.xmlSerializations, 1);
});

test('fails closed when JSON and XML serializations disagree', () => {
  const otherXml = `<environment xmlns="https://admin-shell.io/aas/3/2"><submodels><submodel><id>urn:sm:other</id></submodel></submodels></environment>`;
  const result = selectAasxEnvironment(packageWith(['../models/data.json','../models/data.xml'], [
    entry('models/data.json', JSON.stringify(env)),
    entry('models/data.xml', otherXml),
  ]));
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'conflicting_aas_serializations');
});

test('inventories declared supplementary FMU assets as metadata without reading or executing binary content', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [
    entry('models/site-a.aas.xml', xmlEnv),
    entry('models/_rels/site-a.aas.xml.rels', supplementaryRels([{ id: 'fmu1', target: '../files/cell-model.fmu' }])),
    binaryEntry('files/cell-model.fmu', 4096, { compressedSize: 2048, contentType: 'application/octet-stream' }),
  ]));
  assert.equal(result.status, 'accepted');
  assert.equal(result.supplementaryArtifactCount, 1);
  assert.equal(result.fmuArtifactCount, 1);
  assert.equal(result.supplementaryArtifacts[0].path, 'files/cell-model.fmu');
  assert.equal(result.supplementaryArtifacts[0].kind, 'fmu');
  assert.equal(result.supplementaryArtifacts[0].size, 4096);
  assert.equal(Object.hasOwn(result.supplementaryArtifacts[0], 'content'), false);
  assert.equal(result.supplementaryExecutionPolicy, 'metadata_only_never_execute');
});

test('rejects external supplementary simulation relationships', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [
    entry('models/site-a.aas.xml', xmlEnv),
    entry('models/_rels/site-a.aas.xml.rels', supplementaryRels([{ target: 'https://example.invalid/model.fmu', targetMode: 'External' }])),
  ]));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'external_aas_supplementary_forbidden');
});

test('rejects supplementary relationship traversal outside the package', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [
    entry('models/site-a.aas.xml', xmlEnv),
    entry('models/_rels/site-a.aas.xml.rels', supplementaryRels([{ target: '../../../escape.fmu' }])),
  ]));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'unsafe_aas_supplementary_target');
});

test('requires review when a declared supplementary target is missing', () => {
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [
    entry('models/site-a.aas.xml', xmlEnv),
    entry('models/_rels/site-a.aas.xml.rels', supplementaryRels([{ target: '../files/missing.fmu' }])),
  ]));
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'aas_supplementary_target_missing');
  assert.equal(result.path, 'files/missing.fmu');
});

test('rejects duplicate relationship identifiers rather than accepting ambiguous package metadata', () => {
  const duplicate = `<?xml version="1.0"?><Relationships><Relationship Id="dup" Type="http://admin-shell.io/aasx/relationships/aas-suppl" Target="../files/a.fmu"/><Relationship Id="dup" Type="http://admin-shell.io/aasx/relationships/aas-suppl" Target="../files/b.fmu"/></Relationships>`;
  const result = selectAasxEnvironment(packageWith(['../models/site-a.aas.xml'], [
    entry('models/site-a.aas.xml', xmlEnv),
    entry('models/_rels/site-a.aas.xml.rels', duplicate),
    binaryEntry('files/a.fmu', 100),
    binaryEntry('files/b.fmu', 100),
  ]));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'duplicate_relationship_id');
});

test('rejects traversal in relationship targets', () => {
  const result = selectAasxEnvironment(packageWith(['../../../escape.json'], [entry('escape.json', JSON.stringify(env))]));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'unsafe_aas_spec_target');
});

test('rejects external AAS specification relationships', () => {
  const external = `<?xml version="1.0"?><Relationships><Relationship Id="s1" Type="http://admin-shell.io/aasx/relationships/aas-spec" Target="https://example.invalid/data.json" TargetMode="External"/></Relationships>`;
  const entries = [entry('_rels/.rels', rootRels), entry('aasx/aasx-origin',''), entry('aasx/_rels/aasx-origin.rels', external)];
  const result = selectAasxEnvironment(entries);
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'external_aas_spec_forbidden');
});

test('rejects suspicious compression ratios before parsing content', () => {
  const big = 'x'.repeat(5000);
  const result = selectAasxEnvironment([entry('_rels/.rels', big, { compressedSize: 1 })], { limits: { maxCompressionRatio: 10 } });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'aasx_compression_ratio_limit_exceeded');
});

test('rejects unsafe XML constructs instead of attempting entity expansion', () => {
  const xml = `<!DOCTYPE x [<!ENTITY a "b">]><environment xmlns="https://admin-shell.io/aas/3/2"><submodels/></environment>`;
  const result = selectAasxEnvironment(packageWith(['../models/data.xml'], [entry('models/data.xml', xml)]));
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'xml_dtd_or_entity_forbidden');
});
