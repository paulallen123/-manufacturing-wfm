'use strict';

const { createHash } = require('node:crypto');
const { normalizeNetSuiteAccountId } = require('./provider-proof-profiles.cjs');

const MAX_CLOCK_SKEW_MS = 5000;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeHeaders(input = {}) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[String(key).trim().toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '').trim();
  }
  return out;
}

function parseBoundedUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error(`${label} URL is invalid.`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw new Error(`${label} must use the reviewed HTTPS origin without user information or a custom port.`);
  }
  return parsed;
}

function sameRequestTarget(plan, finalUrl) {
  const expected = parseBoundedUrl(plan.request.path, 'Expected provider request');
  const actual = parseBoundedUrl(finalUrl, 'Observed provider response');
  return expected.origin === actual.origin && expected.pathname === actual.pathname && expected.search === actual.search;
}

function expectedRequestUrl(plan) {
  return new URL(plan.request.path, plan.targetOrigin).toString();
}

function validateCommon(plan, response = {}, now = Date.now()) {
  if (!plan || plan.nonMutating !== true || plan.boundedMetadataOnly !== true || plan.containsSensitiveData !== false) {
    throw new Error('Provider proof plan is not safe for bounded metadata verification.');
  }
  if (plan.followRedirects !== false || plan.request?.redirectPolicy !== 'error') {
    throw new Error('Provider proof must reject redirects.');
  }
  if (String(plan.request?.method || '').toUpperCase() !== 'GET' || plan.request?.recordsAllowed !== false) {
    throw new Error('Provider proof must remain a metadata-only GET with records disabled.');
  }

  const expectedUrl = expectedRequestUrl(plan);
  if (!sameRequestTarget({ ...plan, request: { ...plan.request, path: expectedUrl } }, response.finalUrl)) {
    throw new Error('Observed provider response does not match the exact pinned request target.');
  }

  const status = Number(response.status);
  if (!Number.isInteger(status) || status < 200 || status >= 300) throw new Error('Provider metadata request did not return a successful response.');

  const observedAtMs = Date.parse(String(response.observedAt || ''));
  if (!Number.isFinite(observedAtMs) || observedAtMs > now + MAX_CLOCK_SKEW_MS) throw new Error('Provider response observation time is invalid.');

  const elapsedMs = Number(response.elapsedMs);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Provider response latency is invalid.');

  const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(String(response.body ?? ''), 'utf8');
  if (!body.length) throw new Error('Provider metadata response body is empty.');
  if (!Number.isInteger(plan.request.maxResponseBytes) || body.length > plan.request.maxResponseBytes) {
    throw new Error('Provider metadata response exceeds the reviewed byte limit.');
  }

  const headers = normalizeHeaders(response.headers);
  const contentType = headers['content-type'] || '';
  return { body, headers, contentType, observedAtMs, elapsedMs };
}

function verifySuccessFactors(plan, common) {
  if (!/xml/i.test(common.contentType)) throw new Error('SuccessFactors metadata response is not XML metadata.');
  const text = common.body.toString('utf8');
  if (!/<(?:[A-Za-z0-9_-]+:)?Edmx\b/i.test(text) || !/<(?:[A-Za-z0-9_-]+:)?DataServices\b/i.test(text)) {
    throw new Error('SuccessFactors response is not recognisable OData metadata.');
  }

  const expectedCompanyId = String(plan.targetMetadata?.companyId || '').trim();
  const observedCompanyId = String(common.headers['company-id'] || '').trim();
  if (!expectedCompanyId || observedCompanyId !== expectedCompanyId) {
    throw new Error('SuccessFactors response company identity does not match the reviewed target.');
  }

  return Object.freeze({
    companyId: observedCompanyId,
    immutableCompanyId: String(common.headers['successfactors-immutable-companyid'] || '').trim() || null
  });
}

function verifyNetSuite(plan, common) {
  if (!/json/i.test(common.contentType)) throw new Error('NetSuite metadata response is not JSON metadata.');
  let parsed;
  try {
    parsed = JSON.parse(common.body.toString('utf8'));
  } catch {
    throw new Error('NetSuite metadata response is not valid JSON.');
  }
  if (!/^3\./.test(String(parsed?.openapi || '')) || !parsed.paths || typeof parsed.paths !== 'object') {
    throw new Error('NetSuite response is not recognisable OpenAPI 3 metadata.');
  }
  if (!Object.prototype.hasOwnProperty.call(parsed.paths, '/customer')) {
    throw new Error('NetSuite bounded metadata response does not contain the requested customer resource.');
  }

  const accountId = String(plan.targetMetadata?.accountId || '').trim();
  const expectedHost = `${normalizeNetSuiteAccountId(accountId)}.suitetalk.api.netsuite.com`;
  if (!accountId || plan.pinnedHost !== expectedHost) throw new Error('NetSuite response identity is not bound to the reviewed account-specific domain.');

  return Object.freeze({ accountId, accountSpecificDomain: plan.pinnedHost });
}

function verifyProviderProofResponse(plan, response = {}, now = Date.now()) {
  const common = validateCommon(plan, response, now);
  let providerIdentity;
  if (plan.providerKey === 'sap-successfactors') providerIdentity = verifySuccessFactors(plan, common);
  else if (plan.providerKey === 'netsuite') providerIdentity = verifyNetSuite(plan, common);
  else throw new Error('No provider response verifier is available.');

  return Object.freeze({
    status: 'PASS',
    providerKey: plan.providerKey,
    targetHost: plan.pinnedHost,
    observedAt: new Date(common.observedAtMs).toISOString(),
    measuredLatencyMs: common.elapsedMs,
    providerIdentity,
    metadataDigest: sha256(common.body),
    boundedMetadataOnly: true,
    containsSensitiveData: false,
    responseBodyRetained: false
  });
}

module.exports = { verifyProviderProofResponse };
