'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { signPermit, signReceipt, recordDigest, verifyPair } = require('./portable-autonomy-evidence.cjs');

const authority = generateKeyPairSync('ed25519');
const executor = generateKeyPairSync('ed25519');
const digest = 'a'.repeat(64);
const now = Date.parse('2026-10-13T09:03:00.000Z');
function fixture() {
  const permit = { version: 'VECTOR_PORTABLE_AUTONOMY_L1_V1', permitId: 'permit-1', tenant: 'fixture-a',
    site: 'site-a', actionType: 'integration.retry', resource: 'connection-1', tool: 'retry-read', actorId: 'worker-1',
    authorityDigest: digest, eventDigest: digest, policyDigest: digest, buildDigest: digest, nonce: 'nonce-1',
    issuedAt: '2026-10-13T09:00:00.000Z', expiresAt: '2026-10-13T09:05:00.000Z',
    maxCalls: 2, keyId: 'authority-key', trustLevel: 'L1_SOFTWARE' };
  const p = signPermit(permit, authority.privateKey);
  const receipt = { version: permit.version, permitId: permit.permitId, permitDigest: recordDigest('permit', permit),
    tenant: permit.tenant, site: permit.site, executorId: 'executor-1', buildDigest: digest, tool: permit.tool,
    resource: permit.resource, startedAt: '2026-10-13T09:01:00.000Z', endedAt: '2026-10-13T09:02:00.000Z',
    callCount: 1, outcome: 'SUCCEEDED', transcriptDigest: digest, preStateDigest: digest,
    postStateDigest: digest, keyId: 'executor-key', trustLevel: 'L1_SOFTWARE' };
  const r = signReceipt(receipt, executor.privateKey);
  const context = { now, maxPermitTtlMs: 300000, maxCalls: 2,
    tenant: permit.tenant, site: permit.site, actionType: permit.actionType,
    actorId: permit.actorId, resource: permit.resource, tool: permit.tool, eventDigest: digest, policyDigest: digest,
    buildDigest: digest, authorityDigest: digest, revokedKeys: new Set(), nonceSeen: () => false,
    resolveKey: keyId => ({
      'authority-key': { publicKey: authority.publicKey, role: 'authority', principalId: 'authority-1', tenant: 'fixture-a', site: 'site-a' },
      'executor-key': { publicKey: executor.publicKey, role: 'executor', principalId: 'executor-1', tenant: 'fixture-a', site: 'site-a' },
    })[keyId] };
  return { p, r, context, permit, receipt };
}
const check = f => verifyPair(f.p, f.r, f.context);
test('signed L1 permit and receipt bind exact context without granting execution', () => {
  const f = fixture();
  assert.deepEqual(check(f), check(f));
  assert.equal(check(f).verified, true);
  assert.equal(check(f).executionAuthority, false);
  assert.equal(check(f).trustLevel, 'L1_SOFTWARE');
});
for (const [name, change] of [
  ['wrong tenant', f => { f.context.tenant = 'fixture-b'; }],
  ['wrong site', f => { f.context.site = 'site-b'; }],
  ['wrong build', f => { f.context.buildDigest = 'b'.repeat(64); }],
  ['wrong policy', f => { f.context.policyDigest = 'b'.repeat(64); }],
  ['wrong event', f => { f.context.eventDigest = 'b'.repeat(64); }],
  ['wrong authority', f => { f.context.authorityDigest = 'b'.repeat(64); }],
  ['expired permit', f => { f.context.now = Date.parse('2026-10-13T09:05:00.001Z'); }],
  ['overlong permit', f => { const p = { ...f.permit, expiresAt: '2026-10-13T09:06:00.000Z' };
    f.p = signPermit(p, authority.privateKey);
    f.r = signReceipt({ ...f.receipt, permitDigest: recordDigest('permit', p) }, executor.privateKey); }],
  ['permit over trusted call cap', f => { f.context.maxCalls = 1; }],
  ['replayed nonce', f => { f.context.nonceSeen = () => true; }],
  ['revoked authority key', f => { f.context.revokedKeys.add('authority-key'); }],
  ['revoked executor key', f => { f.context.revokedKeys.add('executor-key'); }],
  ['unbound executor identity', f => { f.r = signReceipt({ ...f.receipt, executorId: 'other-executor' }, executor.privateKey); }],
  ['unbound authority tenant', f => { const original = f.context.resolveKey;
    f.context.resolveKey = (...args) => ({ ...original(...args), tenant: 'fixture-b' }); }],
  ['unbound executor site', f => { const original = f.context.resolveKey;
    f.context.resolveKey = (...args) => args[1] === 'receipt' ? { ...original(...args), site: 'site-b' } : original(...args); }],
  ['authority signing its own receipt', f => { f.r = signReceipt({ ...f.receipt, keyId: 'authority-key' }, authority.privateKey); }],
  ['unavailable revocation', f => { f.context.revokedKeys = null; }],
  ['missing receipt', f => { f.r = null; }],
  ['tampered permit', f => { f.p.payload.resource = 'connection-2'; }],
  ['tampered receipt', f => { f.r.payload.outcome = 'FAILED'; }],
  ['wrong tool', f => { f.context.tool = 'payroll-write'; }],
  ['over-budget calls', f => { f.r = signReceipt({ ...f.receipt, callCount: 3 }, executor.privateKey); }],
  ['forged hardware level', f => { f.r.payload.trustLevel = 'L2_HARDWARE'; }],
  ['impossible expiry', f => { f.p = signPermit({ ...f.permit, expiresAt: '2026-02-30T11:00:00.000Z' }, authority.privateKey); }],
  ['non-data getter', f => { Object.defineProperty(f.p.payload, 'resource', { get() { return 'connection-1'; } }); }],
]) test(`rejects ${name}`, () => { const f = fixture(); assert.throws(() => { change(f); check(f); }, /Portable autonomy evidence invalid/); });

for (const field of ['resolveKey', 'maxPermitTtlMs', 'maxCalls', 'now', 'nonceSeen']) {
  test(`rejects accessor-backed context ${field}`, () => {
    const f = fixture();
    const value = f.context[field];
    Object.defineProperty(f.context, field, { enumerable: true, get() { return value; } });
    assert.throws(() => check(f), /Portable autonomy evidence invalid/);
  });
}

test('rejects Set subclasses even when caller-dispatched has lies about revocation', () => {
  const f = fixture();
  class LyingRevocations extends Set { has() { return false; } }
  f.context.revokedKeys = new LyingRevocations(['authority-key', 'executor-key']);
  assert.throws(() => check(f), /Portable autonomy evidence invalid/);
});

test('uses the single context snapshot when a registry callback mutates the caller record', () => {
  const f = fixture();
  const original = f.context.resolveKey;
  f.context.resolveKey = (...args) => {
    f.context.now = Date.parse('2026-10-13T09:06:00.000Z');
    f.context.maxCalls = 0;
    return original(...args);
  };
  assert.equal(check(f).verified, true);
});

test('uses captured freeze even if a callback tampers with the global intrinsic', () => {
  const f = fixture();
  const originalResolve = f.context.resolveKey;
  const originalFreeze = Object.freeze;
  try {
    f.context.resolveKey = (...args) => {
      Object.freeze = value => value;
      return originalResolve(...args);
    };
    assert.equal(Object.isFrozen(check(f)), true);
  } finally {
    Object.freeze = originalFreeze;
  }
});

test('rejects an expired permit even if a registry callback tampers with date and number intrinsics', () => {
  const f = fixture();
  f.context.now = Date.parse('2026-10-13T09:06:00.000Z');
  const originalResolve = f.context.resolveKey;
  const originalParse = Date.parse;
  const originalToISOString = Date.prototype.toISOString;
  const originalIsFinite = Number.isFinite;
  try {
    f.context.resolveKey = (...args) => {
      Date.parse = () => 0;
      Date.prototype.toISOString = () => '2026-10-13T09:05:00.000Z';
      Number.isFinite = () => true;
      return originalResolve(...args);
    };
    assert.throws(() => check(f), /Portable autonomy evidence invalid/);
  } finally {
    Date.parse = originalParse;
    Date.prototype.toISOString = originalToISOString;
    Number.isFinite = originalIsFinite;
  }
});

test('rejects accessor-backed key-registry bindings', () => {
  const f = fixture();
  const original = f.context.resolveKey;
  f.context.resolveKey = (...args) => {
    const binding = original(...args);
    const role = binding.role;
    Object.defineProperty(binding, 'role', { enumerable: true, get() { return role; } });
    return binding;
  };
  assert.throws(() => check(f), /Portable autonomy evidence invalid/);
});

test('1,000 deterministic synthetic adversarial verifications never accept wrong scope or replay', () => {
  for (let i = 0; i < 1000; i++) {
    const f = fixture();
    if (i % 4 === 0) f.context.tenant = 'fixture-b';
    else if (i % 4 === 1) f.context.nonceSeen = () => true;
    else if (i % 4 === 2) f.context.policyDigest = 'b'.repeat(64);
    else f.r.payload.callCount = 3;
    assert.throws(() => check(f), /Portable autonomy evidence invalid/);
  }
});
