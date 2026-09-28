import { handleCallback } from '@vercel/queue';
import { resumeHook } from 'workflow/api';

export const POST = handleCallback(async (event) => {
  if (!event?.candidateToken || !event?.eventId || !event?.type) {
    throw new Error('Invalid control event payload');
  }
  await resumeHook(event.candidateToken, event);
});
