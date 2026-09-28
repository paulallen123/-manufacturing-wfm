import crypto from 'node:crypto';

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifySignedPayload({ rawBody, timestamp, signature, secret, maxSkewSeconds = 300 }) {
  if (!secret) return { ok: false, reason: 'SIGNING_SECRET_NOT_CONFIGURED' };
  const timestampMs = Date.parse(timestamp || '');
  if (!Number.isFinite(timestampMs)) return { ok: false, reason: 'INVALID_TIMESTAMP' };
  const skew = Math.abs(Date.now() - timestampMs) / 1000;
  if (skew > maxSkewSeconds) return { ok: false, reason: 'STALE_SIGNATURE' };

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  if (!safeEqualHex(expected, signature)) return { ok: false, reason: 'INVALID_SIGNATURE' };
  return { ok: true };
}

export function verifyAdminToken(request) {
  const configured = process.env.VECTOR_CONTROL_PLANE_ADMIN_TOKEN;
  const header = request.headers.get('authorization') || '';
  if (!configured || !header.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length);
  const left = Buffer.from(configured);
  const right = Buffer.from(supplied);
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
