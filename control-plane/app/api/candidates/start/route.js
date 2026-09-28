import { start } from 'workflow/api';
import { candidateControlWorkflow } from '../../../../workflows/candidate-control.js';
import { candidateToken, validateCandidateIdentity } from '../../../../lib/engine.js';
import { verifyAdminToken } from '../../../../lib/security.js';

export async function POST(request) {
  if (!verifyAdminToken(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const candidate = body?.candidate;
  const validation = validateCandidateIdentity(candidate);
  if (!validation.ok) {
    return Response.json({
      error: validation.reason,
      missingFields: validation.missingFields ?? [],
      claimBoundary: validation.claimBoundary ?? null,
    }, { status: 400 });
  }

  const token = candidateToken(candidate);
  const run = await start(candidateControlWorkflow, [{ candidate }]);
  return Response.json({
    mode: 'SHADOW',
    candidateToken: token,
    runId: run.runId,
    claimBoundary: candidate.claimBoundary,
    customerProofAuthority: false,
    productionAuthority: false,
    releaseAuthority: false,
  }, { status: 202 });
}
