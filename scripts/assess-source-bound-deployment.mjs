const SENSITIVE_NAME = /(TOKEN|SECRET|PASSWORD|API[_-]?KEY|CREDENTIAL|DATABASE_URL|(^|_)DB($|_))/i;

export function assessSourceBoundDeployment({
  source,
  variableNames = [],
  branchSnapshot,
  watchPatterns = [],
  holdMarker = '__security_hold__/DO_NOT_MATCH'
} = {}) {
  const failures = [];
  const sensitiveVariables = variableNames.filter((name) => SENSITIVE_NAME.test(String(name)));
  const hasGitSource = Boolean(source?.repo && source?.branch);
  const autoTriggerHoldActive = Array.isArray(watchPatterns)
    && watchPatterns.length === 1
    && watchPatterns[0] === holdMarker;

  if (!hasGitSource || sensitiveVariables.length === 0) {
    return {
      ok: true,
      contained: false,
      autoTriggerHoldActive: false,
      failures,
      sensitiveVariables
    };
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

  if (failures.length > 0 && autoTriggerHoldActive) {
    failures.push('automatic Git-triggered builds are held, but explicit redeploy can still rebuild repository source');
  }

  return {
    ok: failures.length === 0,
    contained: false,
    autoTriggerHoldActive,
    failures,
    sensitiveVariables
  };
}
