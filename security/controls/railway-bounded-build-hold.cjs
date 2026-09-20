'use strict';

const HOLD_ROOT = /^\/__security_hold_[a-z0-9_-]+__\/?$/i;
const HOLD_DOCKERFILE = '__security_manual_redeploy_hold__/Dockerfile';
const CREDENTIAL_NAME = /(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)/i;

function credentialAliasCollisions(names) {
  const groups = new Map();
  for (const name of names) {
    const raw = String(name);
    const normalized = raw.toUpperCase();
    const entries = groups.get(normalized) || new Set();
    entries.add(raw);
    groups.set(normalized, entries);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.size > 1)
    .map(([normalized, entries]) => ({ normalized, names: [...entries].sort() }));
}

function evaluateBoundedBuildHold(config) {
  const rootDirectory = String(config?.build?.rootDirectory ?? config?.source?.rootDirectory ?? '');
  const dockerfilePath = String(config?.build?.dockerfilePath ?? '');
  const watchPatterns = Array.isArray(config?.build?.watchPatterns) ? config.build.watchPatterns : [];
  const credentialNames = Array.isArray(config?.variableNames)
    ? config.variableNames.filter(name => CREDENTIAL_NAME.test(String(name)))
    : [];

  if (credentialNames.length === 0) return { ok: true, reason: 'not-credential-bearing' };

  const findings = [];
  const aliasCollisions = credentialAliasCollisions(credentialNames);
  if (aliasCollisions.length > 0) findings.push('credential-name-alias-collision');
  if (!HOLD_ROOT.test(rootDirectory)) findings.push('root-directory-not-held');
  if (dockerfilePath !== HOLD_DOCKERFILE) findings.push('manual-redeploy-not-held');
  if (watchPatterns.length !== 1 || !String(watchPatterns[0]).includes('__security_hold_')) {
    findings.push('git-trigger-not-held');
  }

  return { ok: findings.length === 0, findings, credentialNames, aliasCollisions };
}

module.exports = { evaluateBoundedBuildHold, credentialAliasCollisions, HOLD_DOCKERFILE };
