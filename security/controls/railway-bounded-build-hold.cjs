'use strict';

const HOLD_ROOT = /^\/__security_hold_[a-z0-9_-]+__\/?$/i;
const HOLD_DOCKERFILE = '__security_manual_redeploy_hold__/Dockerfile';

function evaluateBoundedBuildHold(config) {
  const rootDirectory = String(config?.build?.rootDirectory ?? config?.source?.rootDirectory ?? '');
  const dockerfilePath = String(config?.build?.dockerfilePath ?? '');
  const watchPatterns = Array.isArray(config?.build?.watchPatterns) ? config.build.watchPatterns : [];
  const credentialNames = Array.isArray(config?.variableNames)
    ? config.variableNames.filter(name => /(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)/i.test(String(name)))
    : [];

  if (credentialNames.length === 0) return { ok: true, reason: 'not-credential-bearing' };

  const findings = [];
  if (!HOLD_ROOT.test(rootDirectory)) findings.push('root-directory-not-held');
  if (dockerfilePath !== HOLD_DOCKERFILE) findings.push('manual-redeploy-not-held');
  if (watchPatterns.length !== 1 || !String(watchPatterns[0]).includes('__security_hold_')) {
    findings.push('git-trigger-not-held');
  }

  return { ok: findings.length === 0, findings, credentialNames };
}

module.exports = { evaluateBoundedBuildHold, HOLD_DOCKERFILE };
