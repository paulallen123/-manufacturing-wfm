import { send } from '@vercel/queue';
import { verifySignedPayload } from '../../../lib/security.js';

const MAX_EVENT_BYTES = 262144;
const ALLOWED_EVENT_TYPES = new Set([
  'PROOF_RECEIPT',
  'TASK_STARTED',
  'PROVIDER_DEGRADED',
  'PROVIDER_RECOVERED',
  'REOPEN_GATE',
  'CLEANUP_REQUEST',
  'PROVIDER_STATUS',
]);

export async function POST(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVENT_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_EVENT_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  const timestamp = request.headers.get('x-vector-timestamp');
  const signature = request.headers.get('x-vector-signature');
  const verification = verifySignedPayload({
    rawBody,
    timestamp,
    signature,
    secret: process.env.VECTOR_CONTROL_PLANE_INGEST_SECRET,
  });

  if (!verification.ok) return Response.json({ error: verification.reason }, { status: 401 });

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (!event?.eventId || !event?.type || !event?.candidateToken) {
    return Response.json({ error: 'eventId, type and candidateToken are required' }, { status: 400 });
  }
  if (typeof event.eventId !== 'string' || event.eventId.length > 256) {
    return Response.json({ error: 'eventId must be a string of at most 256 characters' }, { status: 400 });
  }
  if (!ALLOWED_EVENT_TYPES.has(event.type)) {
    return Response.json({ error: 'event type is not externally admissible' }, { status: 400 });
  }

  const { messageId } = await send('vector-control-events', event, {
    idempotencyKey: `${event.candidateToken}:${event.eventId}`,
    retentionSeconds: 604800,
  });
  return Response.json({ accepted: true, messageId }, { status: 202 });
}
