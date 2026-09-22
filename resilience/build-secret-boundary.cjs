'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');

const SYNTHETIC_CANARY_PATH_PREFIX = 'security/railway-build-secret-canary/';
const SYNTHETIC_CANARY_ARG = 'SECURITY_BUILD_CANARY';
const SENSITIVE_NAME = /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY|CLIENT_SECRET|CREDENTIAL|CREDENTIALS)(?:_|$)/i;

function digest(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function normalizeRepoPath(value) {
  const raw = String(value ?? '').replaceAll('\\', '/').trim();
  if (!raw || raw.startsWith('/') || raw.includes('\0')) return null;
  const normalized = path.posix.normalize(raw);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized.replace(/^\.\//, '');
}

function isDockerfilePath(value) {
  const normalized = normalizeRepoPath(value);
  if (!normalized) return false;
  const base = path.posix.basename(normalized);
  return base === 'Dockerfile' || base.startsWith('Dockerfile.');
}

function parseDockerArgs(content = '') {
  const args = [];
  const malformed = [];
  const lines = String(content).replace(/\r\n?/g, '\n').split('\n');

  lines.forEach((line, index) => {
    if (!/^\s*ARG\b/i.test(line)) return;
    const match = line.match(/^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s*=.*)?\s*$/i);
    if (!match) {
      malformed.push({ line: index + 1 });
      return;
    }
    args.push({ name: match[1], line: index + 1 });
  });

  return { args, malformed };
}

function inspectDockerfile(file = {}) {
  const normalizedPath = normalizeRepoPath(file.path);
  if (!normalizedPath || !isDockerfilePath(normalizedPath)) {
    return {
      path: normalizedPath,
      dockerfile: false,
      safe: true,
      args: [],
      allowedSyntheticCanaryArgs: [],
      violations: [],
    };
  }

  const parsed = parseDockerArgs(file.content);
  const violations = parsed.malformed.map(({ line }) => ({
    code: 'WFM_BUILD_ARG_PARSE',
    path: normalizedPath,
    line,
    reason: 'malformed-docker-arg-instruction',
  }));
  const allowedSyntheticCanaryArgs = [];

  for (const arg of parsed.args) {
    if (arg.name === SYNTHETIC_CANARY_ARG) {
      const syntheticCanary = normalizedPath.startsWith(SYNTHETIC_CANARY_PATH_PREFIX);
      if (syntheticCanary) {
        allowedSyntheticCanaryArgs.push({ name: arg.name, line: arg.line });
        continue;
      }
      violations.push({
        code: 'WFM_BUILD_CANARY_SCOPE',
        path: normalizedPath,
        line: arg.line,
        argName: arg.name,
        reason: 'synthetic-build-canary-is-restricted-to-the-isolated-canary-path',
      });
      continue;
    }
    if (!SENSITIVE_NAME.test(arg.name)) continue;
    violations.push({
      code: 'WFM_BUILD_SECRET_ARG_FORBIDDEN',
      path: normalizedPath,
      line: arg.line,
      argName: arg.name,
      reason: 'secret-like-values-must-not-use-docker-build-args',
    });
  }

  return {
    path: normalizedPath,
    dockerfile: true,
    safe: violations.length === 0,
    args: parsed.args,
    allowedSyntheticCanaryArgs,
    violations,
  };
}

function scanDockerfiles(files = []) {
  if (!Array.isArray(files)) throw new TypeError('files must be an array.');
  const results = files.map(inspectDockerfile).filter((entry) => entry.dockerfile);
  const violations = results.flatMap((entry) => entry.violations);
  const allowedSyntheticCanaryArgs = results.flatMap((entry) =>
    entry.allowedSyntheticCanaryArgs.map((arg) => ({ path: entry.path, ...arg })));

  const core = {
    schemaVersion: 1,
    proof: 'docker-build-secret-arg-boundary',
    safe: violations.length === 0,
    dockerfileCount: results.length,
    violations,
    allowedSyntheticCanaryArgs,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
    releaseClaimAllowed: false,
    createsResources: false,
  };

  return Object.freeze({
    ...core,
    reportDigest: digest(JSON.stringify(core)),
  });
}

function normaliseBuildLogLines(entries = []) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array.');
  return entries.slice(0, 500).map((entry) => String(
    typeof entry === 'string' ? entry : entry?.message ?? '',
  ).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 12000));
}

function inspectRailwayBuildEnvironment(entries = []) {
  const lines = normaliseBuildLogLines(entries);
  const observed = new Set();

  for (const line of lines) {
    for (const match of line.matchAll(/--env\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
      observed.add(match[1]);
    }
  }

  const observedBuildEnvNames = [...observed].sort();
  const secretLikeBuildEnvNames = observedBuildEnvNames.filter((name) => SENSITIVE_NAME.test(name));
  const core = {
    schemaVersion: 1,
    proof: 'railway-build-secret-scope-boundary',
    buildSecretScopeRiskDetected: secretLikeBuildEnvNames.length > 0,
    observedBuildEnvNames,
    secretLikeBuildEnvNames,
    credentialValueExposureProven: false,
    productionMutation: false,
    customerMutation: false,
    payrollMutation: false,
    identityMutation: false,
    modelAuthorityGranted: false,
    executionAuthorityGranted: false,
    releaseClaimAllowed: false,
    automaticRedeployAllowed: false,
    createsResources: false,
  };

  return Object.freeze({
    ...core,
    reportDigest: digest(JSON.stringify(core)),
  });
}

module.exports = {
  SYNTHETIC_CANARY_ARG,
  SYNTHETIC_CANARY_PATH_PREFIX,
  inspectDockerfile,
  isDockerfilePath,
  parseDockerArgs,
  scanDockerfiles,
  inspectRailwayBuildEnvironment,
};
