import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCatalog} from '../scripts/load-catalog.mjs';

test('effective catalog contains unique provider ids after all research overlays',()=>{
  const catalog=loadCatalog();
  const ids=catalog.systems.map(x=>x.id);
  assert.equal(new Set(ids).size,ids.length,'effective catalog contains a duplicate provider id');
});

test('MRPeasy is an evidence promotion of the base record, not a duplicate addition',()=>{
  const catalog=loadCatalog();
  const matches=catalog.systems.filter(x=>x.id==='mrpeasy');
  assert.equal(matches.length,1);
  assert.equal(matches[0].testLevel,'spec-verified');
  assert.ok(matches[0].protocols.includes('OpenAPI'));
});

test('Katana is present once at spec verification only',()=>{
  const catalog=loadCatalog();
  const matches=catalog.systems.filter(x=>x.id==='katana-cloud-inventory');
  assert.equal(matches.length,1);
  assert.equal(matches[0].testLevel,'spec-verified');
  assert.equal(matches[0].writeEnabled,false);
});
