const SENSITIVE_NAME = /(TOKEN|SECRET|PASSWORD|API[_-]?KEY|CREDENTIAL|DATABASE_URL|(^|_)DB($|_))/i;

export function assessSourceBoundDeployment({
  source,
  variableNames = [],
  branchSnapshot,
  watchPatterns = [],
  dockerfilePath,
  holdMarker = '__security_hold__/DO_NOT_MATCH',
  buildHoldMarker = '__security_hold__/NO_DOCKERFILE'
} = {}) {
  const failures = [];
  const sensitiveVariables = variableNames.filter((name) => SENSITIVE_NAME.test(String(name)));
  const hasGitSource = Boolean(source?.repo && source?.branch);
  const sourceTriggerHoldActive = Array.isArray(watchPatterns)
    && watchPatterns.length === 1
    && watchPatterns[0] === holdMarker;
  const manualBuildHoldActive = dockerfilePath === buildHoldMarker;

  if (!hasGitSource || sensitiveVariables.length === 0) {
    return { ok: true, contained: false, failures, sensitiveVariables };
  }

  if (sourceTriggerHoldActive && manualBuildHoldActive) {
    return { ok: true, contained: true, failures, sensitiveVariables };
  }

  if (sourceTriggerHoldActive && !manualBuildHoldActive) {
    failures.push('security hold is incomplete: repository pushes are blocked but a manual/redeploy build can still execute repository build instructions');
  }

  if (!sourceTriggerHoldActive && manualBuildHoldActive) {
    failures.push('security hold is incomplete: repository source triggers are still armed');
  }

  if (branchSnapshot?.protected !== true) {
    failures.push('credential-bearing service is sourced from an unprotected branch');
  }

  if (branchSnapshot?.commit?.commit?.verification?.verified !== true) {
    failures.push('credential-bearing service is sourced from an unsigned or unverified branch head');
  }

  if (source?.checkSuites !== true) {
    failures.push('deployment source does not require successful checks before Railway can build it');
  }

  return {
    ok: failures.length === 0,
    contained: false,
    failures,
    sensitiveVariables
  };
}
