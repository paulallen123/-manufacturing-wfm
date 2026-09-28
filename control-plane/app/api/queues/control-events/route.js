import { handleCallback } from '@vercel/queue';
import { controlEventHook } from '../../../../workflows/candidate-control.js';

export const POST = handleCallback(async (event) => {
  if (!event?.candidateToken || !event?.eventId || !event?.type) {
    throw new Error('Invalid control event payload');
  }
  await controlEventHook.resume(event.candidateToken, event);
});
