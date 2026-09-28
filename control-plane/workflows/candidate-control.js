import { defineHook } from 'workflow';
import { send } from '@vercel/queue';
import { applyControlEvent, createInitialState } from '../lib/engine.js';

export const controlEventHook = defineHook();

export async function candidateControlWorkflow(seed) {
  'use workflow';

  let state = await initialiseCandidate(seed.candidate);
  const bootstrap = await evaluateEvent(state, {
    eventId: `bootstrap:${state.candidateToken}`,
    type: 'CANDIDATE_STARTED',
    candidateToken: state.candidateToken,
  });
  state = bootstrap.state;
  await fanOut(bootstrap.emittedTasks);

  const events = controlEventHook.create({ token: state.candidateToken });
  for await (const event of events) {
    const result = await evaluateEvent(state, event);
    state = result.state;
    await fanOut(result.emittedTasks);

    if (state.gates.customer_proof_authority.state === 'PASS') {
      return {
        candidateToken: state.candidateToken,
        status: 'CUSTOMER_PROOF_AUTHORITY_PASS',
        claimBoundary: state.candidate.claimBoundary,
        productionAuthority: false,
        finalState: state,
      };
    }
  }

  return { candidateToken: state.candidateToken, status: 'HOOK_CLOSED', finalState: state };
}

async function initialiseCandidate(candidate) {
  'use step';
  return createInitialState(candidate);
}

async function evaluateEvent(state, event) {
  'use step';
  return applyControlEvent(state, event);
}

async function fanOut(tasks) {
  'use step';
  const results = await Promise.all(tasks.map(async (task) => {
    const result = await send('vector-control-tasks', task, {
      idempotencyKey: task.idempotencyKey,
      retentionSeconds: 604800,
    });
    return { taskId: task.taskId, messageId: result.messageId };
  }));
  return { enqueued: results.length, results };
}
