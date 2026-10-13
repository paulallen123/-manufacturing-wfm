import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Read-only proof using approved, disposable payroll-role sessions from different fixture tenants.
export async function proveCrossTenantPayrollExport({ origin, ownerCookie, otherCookie, batchId,
  ownerTenant, otherTenant, expectedSha, fetchImpl = fetch }) {
  const target = new URL(origin);
  assert.equal(target.origin, origin, 'Exact origin is required');
  assert.ok(target.protocol === 'https:' ||
    (target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)),
  'Session cookies require HTTPS or local loopback');
  for (const cookie of [ownerCookie, otherCookie]) {
    if (typeof cookie !== 'string' || !/^wfm_session=[A-Za-z0-9_-]+$/.test(cookie)) {
      throw new Error('A single session cookie is required');
    }
  }
  if (ownerCookie === otherCookie) throw new Error('Distinct sessions are required');
  assert.match(expectedSha, /^[a-f0-9]{40}$/);
  assert.ok(typeof batchId === 'string' && batchId.length > 0, 'Released batch identity is required');
  assert.ok(ownerTenant && otherTenant && ownerTenant !== otherTenant, 'Distinct tenant identities are required');
  async function get(path, cookie) {
    const response = await fetchImpl(origin + path, { redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { cookie, accept: 'application/json,text/csv', origin, 'cache-control': 'no-store' } });
    assert.equal(response.headers.get('x-wfm-source-sha'), expectedSha, `Source drift at ${path}`);
    return response;
  }
  async function actor(cookie, tenant) {
    const response = await get('/api/bootstrap', cookie);
    assert.equal(response.status, 200, 'Proof session is not authenticated');
    const body = await response.json();
    assert.equal(body?.actor?.tenant, tenant, 'Tenant identity mismatch');
    assert.equal(body.actor.role, 'payroll_admin', 'Payroll-admin proof identity is required');
  }
  await actor(ownerCookie, ownerTenant);
  await actor(otherCookie, otherTenant);
  const path = '/api/payroll-export/' + encodeURIComponent(batchId);
  const owner = await get(path, ownerCookie);
  assert.equal(owner.status, 200, 'Owning payroll role cannot read released export');
  assert.match(owner.headers.get('content-type') || '', /^text\/csv(?:;|$)/i, 'Owning export is not CSV');
  const bytes = Buffer.from(await owner.arrayBuffer());
  assert.ok(bytes.length > 0, 'Released export is empty');
  assert.ok(bytes.includes(10) && bytes.includes(44), 'Released export lacks CSV rows');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  assert.equal(owner.headers.get('x-export-sha256'), checksum, 'Owning export checksum mismatch');
  const other = await get(path, otherCookie);
  assert.ok([403, 404].includes(other.status), 'Other tenant could read released export');
  assert.equal(other.headers.get('x-export-sha256'), null, 'Denied response disclosed export checksum');
  assert.equal(other.headers.get('content-disposition'), null, 'Denied response offered download');
  assert.match(other.headers.get('content-type') || '', /^application\/json(?:;|$)/i,
    'Denied response is not a JSON error');
  const deniedBytes = Buffer.from(await other.arrayBuffer());
  assert.ok(deniedBytes.length <= 256, 'Denied error body is unexpectedly large');
  let denied;
  try { denied = JSON.parse(deniedBytes.toString('utf8')); }
  catch { throw new Error('Denied response is not valid JSON'); }
  assert.deepEqual(Object.keys(denied).sort(), ['error'], 'Denied response contains export fields');
  const genericErrors = other.status === 404 ? ['Not found', 'Not Found'] : ['Forbidden', 'Access denied'];
  assert.ok(genericErrors.includes(denied.error), 'Denied response contains export details');
  return { status: 'PASS', sourceSha: expectedSha, ownerTenant, otherTenant, batchId, checksum,
    checks: ['distinct-payroll-tenant-identities', 'owning-export-checksum', 'other-tenant-export-denied'],
    boundary: 'Read-only synthetic tenant proof; no payroll release or customer proof claim.' };
}
