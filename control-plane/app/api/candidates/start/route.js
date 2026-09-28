import { start } from 'workflow/api';
import { candidateControlWorkflow } from '../../../../workflows/candidate-control.js';
import { candidateToken } from '../../../../lib/engine.js';
import { verifyAdminToken } from '../../../../lib/security.js';

const REQUIRED_FIELDS = [
  'repository',
  'ref',
  'commitSha',
  'deploymentId',
  'runtimeSha',
  'releaseId',
  'environment',
  'provider',
  'failureDomainId',
];

export async function POST(request) {
  if (!verifyAdminToken(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const candidate = body?.candidate;
  if (!candidate || REQUIRED_FIELDS.some((field) => !candidate[field])) {
    return Response.json({ error: 'candidate identity is incomplete' }, { status: 400 });
  }

  const token = candidateToken(candidate);
  const run = await start(candidateControlWorkflow, [{ candidate }]);
  return Response.json({
    mode: 'SHADOW',
    candidateToken: token,
    runId: run.runId,
    releaseAuthority: false,
  }, { status: 202 });
}
