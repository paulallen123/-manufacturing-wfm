import { createHook } from 'workflow';
import { send } from '@vercel/queue';
import { applyControlEvent, createInitialState } from '../lib/engine.js';

export async function candidateControlWorkflow(seed) {
  'use workflow';

  let state = await initializeCandidate(seed.candidate);
  const bootstrap = await evaluateEvent(state, {
    eventId: `bootstrap:${state.candidateToken}`,
    type: 'CANDIDATE_STARTED',
    candidateToken: state.candidateToken,
  });
  state = bootstrap.state;
  await fanOut(bootstrap.emittedTasks);

  const events = createHook({ token: state.candidateToken });
  for await (const event of events) {
    const result = await evaluateEvent(state, event);
    state = result.state;
    await fanOut(result.emittedTasks);

    if (state.gates.production_authority.state === 'PASS') {
      return {
        candidateToken: state.candidateToken,
        status: 'PRODUCTION_AUTHORITY_PASS',
        finalState: state,
      };
    }
  }

  return { candidateToken: state.candidateToken, status: 'HOOK_CLOSED', finalState: state };
}

async function initializeCandidate(candidate) {
  'use step';
  return createInitialState(candidate);
}

async function evaluateEvent(state, event) {
  'use step';
  return applyControlEvent(state, event);
}

async function fanOut(tasks) {
  'use step';
  for (const task of tasks) {
    await send('vector-control-tasks', task, { idempotencyKey: task.idempotencyKey });
  }
  return { enqueued: tasks.length };
}
