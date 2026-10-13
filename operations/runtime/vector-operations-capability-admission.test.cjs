'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createCapabilityAdmission: createAdmission,
  verifyCapabilityAdmission: verifyAdmission
} = require('./vector-operations-capability-admission.cjs');

const AUTHORITY_KEY = Buffer.from('synthetic-vecta-admission-key-for-tests');

function createCapabilityAdmission(input) {
  return createAdmission({ ...input, authorityKey: AUTHORITY_KEY });
}

function verifyCapabilityAdmission(input) {
  return verifyAdmission({ ...input, authorityKey: AUTHORITY_KEY });
}

function readiness(overrides = {}) {
  return {
    contractVersion: 'VECTOR_CAPABILITY_READINESS_V1',
    tenant: 'tenant-a',
    revision: 'readiness-r7',
    capabilities: [
      { id: 'leave.request', status: 'ALLOW', reasonCodes: [] },
      { id: 'payroll.release', status: 'BLOCK', reasonCodes: ['PAYROLL_NOT_READY'] }
    ],
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    tenant: 'tenant-a',
    actorId: 'manager@example.test',
    capabilityId: 'leave.request',
    locale: 'en-GB',
    ...overrides
  };
}

test('BLOCK readiness refuses admission before a plan binding exists', () => {
  const result = createCapabilityAdmission({
    readiness: readiness(),
    request: request({ capabilityId: 'payroll.release' })
  });

  assert.equal(result.admitted, false);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, ['PAYROLL_NOT_READY']);
  assert.equal(result.binding, null);
  assert.equal(result.authorityFingerprint, null);
});

test('ALLOW readiness creates an exact server-side plan binding', () => {
  const result = createCapabilityAdmission({ readiness: readiness(), request: request() });

  assert.equal(result.admitted, true);
  assert.equal(result.status, 'ADMITTED');
  assert.deepEqual(result.binding, {
    tenant: 'tenant-a',
    actorId: 'manager@example.test',
    capabilityId: 'leave.request',
    readinessRevision: 'readiness-r7'
  });
  assert.match(result.authorityFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes('locale'), false);
  assert.equal(JSON.stringify(result).includes('questionnaire'), false);
});

test('locale variants cannot change the authority result or fingerprint', () => {
  const en = createCapabilityAdmission({ readiness: readiness(), request: request({ locale: 'en-GB' }) });
  const fr = createCapabilityAdmission({ readiness: readiness(), request: request({ locale: 'fr-FR' }) });

  assert.deepEqual(fr, en);
});

test('execution recheck refuses readiness revision drift', () => {
  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });
  const result = verifyCapabilityAdmission({
    admission,
    readiness: readiness({ revision: 'readiness-r8' }),
    request: request()
  });

  assert.equal(result.verified, false);
  assert.deepEqual(result.reasonCodes, ['READINESS_REVISION_CHANGED']);
});

test('execution recheck refuses tenant, actor, or capability scope drift', () => {
  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });

  for (const changed of [
    request({ tenant: 'tenant-b' }),
    request({ actorId: 'other@example.test' }),
    request({ capabilityId: 'payroll.release' })
  ]) {
    const result = verifyCapabilityAdmission({ admission, readiness: readiness(), request: changed });
    assert.equal(result.verified, false);
    assert.deepEqual(result.reasonCodes, ['REQUEST_SCOPE_CHANGED']);
  }
});

test('execution recheck refuses a capability that is no longer admitted', () => {
  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });
  const result = verifyCapabilityAdmission({
    admission,
    readiness: readiness({
      capabilities: [{ id: 'leave.request', status: 'BLOCK', reasonCodes: ['POLICY_CHANGED'] }]
    }),
    request: request()
  });

  assert.equal(result.verified, false);
  assert.deepEqual(result.reasonCodes, ['POLICY_CHANGED']);
});

test('execution recheck detects a forged admission fingerprint', () => {
  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });
  const result = verifyCapabilityAdmission({
    admission: { ...admission, authorityFingerprint: '0'.repeat(64) },
    readiness: readiness(),
    request: request()
  });

  assert.equal(result.verified, false);
  assert.deepEqual(result.reasonCodes, ['ADMISSION_FINGERPRINT_MISMATCH']);
});

test('admission requires a server-held authority key and rejects a different key', () => {
  assert.throws(
    () => createAdmission({ readiness: readiness(), request: request() }),
    /authority key/i
  );

  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });
  const result = verifyAdmission({
    admission,
    readiness: readiness(),
    request: request(),
    authorityKey: Buffer.from('different-synthetic-authority-key')
  });
  assert.equal(result.verified, false);
  assert.deepEqual(result.reasonCodes, ['ADMISSION_FINGERPRINT_MISMATCH']);
});

test('raw questionnaire data and undeclared fields are rejected', () => {
  assert.throws(
    () => createCapabilityAdmission({
      readiness: readiness({ questionnaireAnswers: { payroll: true } }),
      request: request()
    }),
    /undeclared field/i
  );
  assert.throws(
    () => createCapabilityAdmission({ readiness: readiness(), request: request({ permit: true }) }),
    /undeclared field/i
  );
});

test('accessor-backed or inherited inputs are rejected without invoking behavior', () => {
  let invoked = false;
  const active = readiness();
  Object.defineProperty(active, 'revision', {
    enumerable: true,
    get() {
      invoked = true;
      return 'readiness-r7';
    }
  });
  assert.throws(
    () => createCapabilityAdmission({ readiness: active, request: request() }),
    /plain data/i
  );
  assert.equal(invoked, false);

  const inherited = Object.create({ tenant: 'tenant-a' });
  Object.assign(inherited, request());
  assert.throws(
    () => createCapabilityAdmission({ readiness: readiness(), request: inherited }),
    /plain data/i
  );
});

test('duplicate capability identities and malformed revisions fail closed', () => {
  assert.throws(
    () => createCapabilityAdmission({
      readiness: readiness({
        capabilities: [
          { id: 'leave.request', status: 'ALLOW', reasonCodes: [] },
          { id: 'leave.request', status: 'BLOCK', reasonCodes: ['CONFLICT'] }
        ]
      }),
      request: request()
    }),
    /duplicate capability/i
  );
  assert.throws(
    () => createCapabilityAdmission({ readiness: readiness({ revision: ' ' }), request: request() }),
    /revision/i
  );
});

test('duplicate blocking reasons stay rejected when inherited array methods are polluted', () => {
  const original = Object.getOwnPropertyDescriptor(Array.prototype, 'includes');
  Object.defineProperty(Array.prototype, 'includes', {
    configurable: true,
    writable: true,
    value: () => false
  });
  let error = null;
  try {
    createCapabilityAdmission({
      readiness: readiness({
        capabilities: [{
          id: 'leave.request',
          status: 'BLOCK',
          reasonCodes: ['POLICY_CHANGED', 'POLICY_CHANGED']
        }]
      }),
      request: request()
    });
  } catch (caught) {
    error = caught;
  } finally {
    Object.defineProperty(Array.prototype, 'includes', original);
  }
  assert.match(String(error && error.message), /reason codes must be unique/i);
});

test('ambient Map prototype pollution cannot convert a BLOCK capability to ALLOW', () => {
  const original = Object.getOwnPropertyDescriptor(Map.prototype, 'get');
  Object.defineProperty(Map.prototype, 'get', {
    configurable: true,
    writable: true,
    value: () => Object.freeze({ id: 'payroll.release', status: 'ALLOW', reasonCodes: Object.freeze([]) })
  });
  let result;
  try {
    result = createCapabilityAdmission({
      readiness: readiness(),
      request: request({ capabilityId: 'payroll.release' })
    });
  } finally {
    Object.defineProperty(Map.prototype, 'get', original);
  }
  assert.equal(result.admitted, false);
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.reasonCodes, ['PAYROLL_NOT_READY']);
});

test('Proxy records and arrays are rejected before reflective traps execute', () => {
  let recordTraps = 0;
  const record = new Proxy(readiness(), {
    getPrototypeOf() {
      recordTraps += 1;
      return Object.prototype;
    }
  });
  assert.throws(
    () => createCapabilityAdmission({ readiness: record, request: request() }),
    /plain[- ]data|proxy/i
  );
  assert.equal(recordTraps, 0);

  let arrayTraps = 0;
  const capabilities = new Proxy(readiness().capabilities, {
    getPrototypeOf() {
      arrayTraps += 1;
      return Array.prototype;
    }
  });
  assert.throws(
    () => createCapabilityAdmission({
      readiness: readiness({ capabilities }),
      request: request()
    }),
    /plain[- ]data|proxy/i
  );
  assert.equal(arrayTraps, 0);

  let keyTraps = 0;
  const authorityKey = new Proxy(new Uint8Array(32), {
    getPrototypeOf() {
      keyTraps += 1;
      return Uint8Array.prototype;
    }
  });
  assert.throws(
    () => createAdmission({ readiness: readiness(), request: request(), authorityKey }),
    /authority key|plain[- ]data|proxy/i
  );
  assert.equal(keyTraps, 0);
});

test('admission output is immutable and detached from caller mutation', () => {
  const source = readiness();
  const admission = createCapabilityAdmission({ readiness: source, request: request() });
  source.revision = 'readiness-r999';
  source.capabilities[0].status = 'BLOCK';

  assert.equal(admission.binding.readinessRevision, 'readiness-r7');
  assert.equal(Object.isFrozen(admission), true);
  assert.equal(Object.isFrozen(admission.binding), true);
  assert.throws(() => { admission.binding.tenant = 'tenant-b'; }, TypeError);
});

test('unchanged current readiness verifies the exact admitted plan binding', () => {
  const admission = createCapabilityAdmission({ readiness: readiness(), request: request() });
  const result = verifyCapabilityAdmission({ admission, readiness: readiness(), request: request({ locale: 'cy-GB' }) });

  assert.deepEqual(result, {
    contractVersion: 'VECTOR_CAPABILITY_ADMISSION_V1',
    verified: true,
    status: 'VERIFIED',
    reasonCodes: [],
    binding: admission.binding,
    authorityFingerprint: admission.authorityFingerprint
  });
});
