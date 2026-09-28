import { handleCallback } from '@vercel/queue';

export const POST = handleCallback(async (task, metadata) => {
  // Phase A shadow mode is deliberately non-mutating. Provider dispatch is added only
  // after deterministic policy/invariant tests pass and the preview deployment is proven.
  console.log(JSON.stringify({
    type: 'SHADOW_WOULD_DISPATCH',
    messageId: metadata.messageId,
    taskId: task.taskId,
    gateId: task.gateId,
    laneId: task.laneId,
    candidateSha: task.candidateSha,
    idempotencyKey: task.idempotencyKey,
  }));
});
