import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAasxEnvironment } from '../../src/frontier/aasx-package-selector.mjs';

const rootRels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://admin-shell.io/aasx/relationships/aasx-origin" Target="aasx/aasx-origin"/></Relationships>`;
const originRels = (targets) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map((t,i)=>`<Relationship Id="s${i}" Type="http://admin-shell.io/aasx/relationships/aas-spec" Target="${t}"/>`).join('')}</Relationships>`;
const env = { assetAdministrationShells: [], submodels: [{ id: 'urn:sm:1', submodelElements: [] }], conceptDescriptions: [] };
const entry = (path, content, extra={}) => ({ path, content, size: Buffer.byteLength(String(content)), ...extra });
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
});

test('accepts duplicate JSON serializations only when they are semantically equivalent', () => {
  const envReordered = { conceptDescriptions: [], submodels: [{ submodelElements: [], id: 'urn:sm:1' }], assetAdministrationShells: [] };
  const result = selectAasxEnvironment(packageWith(['data.json','copy.json'], [
    entry('aasx/data.json', JSON.stringify(env)),
    entry('aasx/copy.json', JSON.stringify(envReordered)),
  ]));
  assert.equal(result.status, 'accepted');
  assert.equal(result.equivalentJsonSerializations, 2);
});

test('fails closed when two AAS JSON serializations disagree', () => {
  const other = { ...env, submodels: [{ id: 'urn:sm:other', submodelElements: [] }] };
  const result = selectAasxEnvironment(packageWith(['data.json','copy.json'], [
    entry('aasx/data.json', JSON.stringify(env)),
    entry('aasx/copy.json', JSON.stringify(other)),
  ]));
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'conflicting_aas_serializations');
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

test('does not pretend XML ingestion is complete', () => {
  const result = selectAasxEnvironment(packageWith(['data.xml'], [entry('aasx/data.xml', '<environment/>')]));
  assert.equal(result.status, 'review_required');
  assert.equal(result.reason, 'xml_aas_spec_not_supported_yet');
});
