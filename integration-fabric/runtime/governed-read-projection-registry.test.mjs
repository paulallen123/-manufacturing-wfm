import test from 'node:test';
import assert from 'node:assert/strict';
import {governedReadProjectionProfile} from './governed-read-projection-registry.mjs';

test('Epicor governed projection profile is fail-closed',()=>{
  const profile=governedReadProjectionProfile('epicor-kinetic');
  assert.ok(profile);
  assert.equal(profile.evidenceLevel,'spec-verified');
  assert.equal(profile.requireExactProjectionAllowlist,true);
  assert.equal(profile.providerReadOnlySemanticsRequired,true);
  assert.equal(profile.arbitraryQueryAllowed,false);
  assert.equal(profile.directSqlAllowed,false);
  assert.equal(profile.mutationProjectionAllowed,false);
  assert.equal(profile.schemaFingerprintRequired,true);
  assert.equal(profile.pageContinuityRequired,true);
  assert.equal(profile.coverageSemanticsRequired,true);
});
