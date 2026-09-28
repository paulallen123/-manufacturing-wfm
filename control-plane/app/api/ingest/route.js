import { send } from '@vercel/queue';
import { verifySignedPayload } from '../../../lib/security.js';

export async function POST(request) {
  const rawBody = await request.text();
  const timestamp = request.headers.get('x-vector-timestamp');
  const signature = request.headers.get('x-vector-signature');
  const verification = verifySignedPayload({
    rawBody,
    timestamp,
    signature,
    secret: process.env.VECTOR_CONTROL_PLANE_INGEST_SECRET,
  });

  if (!verification.ok) return Response.json({ error: verification.reason }, { status: 401 });

  const event = JSON.parse(rawBody);
  if (!event?.eventId || !event?.type || !event?.candidateToken) {
    return Response.json({ error: 'eventId, type and candidateToken are required' }, { status: 400 });
  }

  const { messageId } = await send('vector-control-events', event);
  return Response.json({ accepted: true, messageId }, { status: 202 });
}
