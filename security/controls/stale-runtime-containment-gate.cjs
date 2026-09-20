'use strict';

const CREDENTIAL_NAME = /(?:PASSWORD|TOKEN|SECRET|KEY|CREDENTIAL)/i;
const FAILED_REPLACEMENT = new Set(['FAILED', 'CRASHED']);

function parseTime(value) {
  const t = Date.parse(String(value ?? ''));
  return Number.isFinite(t) ? t : null;
}

function evaluateStaleRuntimeContainment(input = {}) {
  const latest = input.latestDeployment || {};
  const previous = input.previousSuccessfulDeployment || {};
  const variableNames = Array.isArray(input.variableNames) ? input.variableNames : [];
  const httpEvents = Array.isArray(input.httpEvents) ? input.httpEvents : [];
  const credentialNames = variableNames.filter(name => CREDENTIAL_NAME.test(String(name)));
  const findings = [];

  if (credentialNames.length === 0) {
    return { ok: true, reason: 'not-credential-bearing', findings, credentialNames };
  }

  const latestStatus = String(latest.status || '').toUpperCase();
  if (!FAILED_REPLACEMENT.has(latestStatus)) {
    return { ok: true, reason: 'latest-replacement-not-failed', findings, credentialNames };
  }

  const failureTime = parseTime(latest.updatedAt || latest.createdAt);
  if (failureTime === null) findings.push('failure-time-unverifiable');

  const previousStatus = String(previous.status || '').toUpperCase();
  if (previousStatus !== 'SUCCESS') findings.push('previous-success-unverifiable');

  if (input.telemetryComplete === false) findings.push('runtime-telemetry-incomplete');

  const postFailure = failureTime === null ? [] : httpEvents.filter(event => {
    const t = parseTime(event.timestamp);
    return t !== null && t > failureTime;
  });

  if (postFailure.length > 0) findings.push('stale-runtime-still-serving');
  if (postFailure.some(event => Number(event.httpStatus) >= 200 && Number(event.httpStatus) < 400)) {
    findings.push('stale-runtime-public-response');
  }
  if (postFailure.some(event => Number(event.httpStatus) === 401 || Number(event.httpStatus) === 403)) {
    findings.push('stale-runtime-auth-surface-live');
  }

  const ok = findings.length === 0;
  return {
    ok,
    findings,
    credentialNames,
    postFailureEventCount: postFailure.length,
    requiredAction: ok ? 'none' : 'block-release-and-require-live-runtime-containment'
  };
}

module.exports = { evaluateStaleRuntimeContainment };
