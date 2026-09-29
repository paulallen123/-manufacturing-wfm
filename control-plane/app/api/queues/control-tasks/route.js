import { handleCallback } from '@vercel/queue';
import { dispatchProofTask } from '../../../../lib/dispatch.js';

export const POST = handleCallback(async (task, metadata) => {
  const result = await dispatchProofTask(task);
  console.log(JSON.stringify({
    type: result.status,
    messageId: metadata.messageId,
    taskId: task.taskId,
    gateId: task.gateId,
    laneId: task.laneId,
    candidateSha: task.candidateSha,
    idempotencyKey: task.idempotencyKey,
  }));
  return result;
});
