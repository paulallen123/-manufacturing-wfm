import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyAdminToken, verifySignedPayload } from '../lib/security.js';

function signature(secret, timestamp, rawBody) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

test('signed ingest accepts a current HMAC-authenticated payload', () => {
  const secret = 'test-secret';
  const timestamp = new Date().toISOString();
  const rawBody = JSON.stringify({ eventId: 'evt-1' });
  const result = verifySignedPayload({
    rawBody,
    timestamp,
    signature: signature(secret, timestamp, rawBody),
    secret,
  });
  assert.deepEqual(result, { ok: true });
});

test('signed ingest rejects stale replayed payloads', () => {
  const secret = 'test-secret';
  const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rawBody = '{}';
  const result = verifySignedPayload({
    rawBody,
    timestamp,
    signature: signature(secret, timestamp, rawBody),
    secret,
  });
  assert.deepEqual(result, { ok: false, reason: 'STALE_SIGNATURE' });
});

test('signed ingest rejects a forged signature', () => {
  const timestamp = new Date().toISOString();
  const result = verifySignedPayload({
    rawBody: '{}',
    timestamp,
    signature: '00'.repeat(32),
    secret: 'test-secret',
  });
  assert.deepEqual(result, { ok: false, reason: 'INVALID_SIGNATURE' });
});

test('admin start endpoint token is exact and fail closed', () => {
  const previous = process.env.VECTOR_CONTROL_PLANE_ADMIN_TOKEN;
  process.env.VECTOR_CONTROL_PLANE_ADMIN_TOKEN = 'admin-secret';
  try {
    const okRequest = { headers: new Headers({ authorization: 'Bearer admin-secret' }) };
    const badRequest = { headers: new Headers({ authorization: 'Bearer admin-secret-wrong' }) };
    assert.equal(verifyAdminToken(okRequest), true);
    assert.equal(verifyAdminToken(badRequest), false);
  } finally {
    if (previous === undefined) delete process.env.VECTOR_CONTROL_PLANE_ADMIN_TOKEN;
    else process.env.VECTOR_CONTROL_PLANE_ADMIN_TOKEN = previous;
  }
});
