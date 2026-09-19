'use strict';

const { createHash } = require('node:crypto');

const ENVIRONMENT_BINDING_VERSION = 'wfm-env-bind/v1';

function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
}

function fail(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  throw error;
}

function requireString(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') fail(code, message, 400);
  return value.trim();
}

function safeTenantSlug(value) {
  const source = requireString(value, 'WFM_ENV_BINDING_TENANT_REQUIRED', 'Tenant identity is required for environment binding.')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  if (!source) return 'tenant';
  return source.slice(0, 28).replace(/-+$/g, '') || 'tenant';
}

function deriveProvisioningEnvironmentBinding(record) {
  if (!record || typeof record !== 'object') {
    fail('WFM_ENV_BINDING_RECORD_REQUIRED', 'Provisioning queue record is required.', 400);
  }
  const plan = record.payload && record.payload.plan;
  const contract = record.payload && record.payload.contract;
  const queueKey = requireString(record.queueKey, 'WFM_ENV_BINDING_QUEUE_KEY_REQUIRED', 'Provisioning queue identity is required.');
  const intentDigest = requireString(record.intentDigest, 'WFM_ENV_BINDING_INTENT_REQUIRED', 'Provisioning intent digest is required.').toLowerCase();
  const providerRequestId = requireString(record.providerRequestId, 'WFM_ENV_BINDING_REQUEST_REQUIRED', 'Provider request identity is required.');
  const provider = requireString(plan && plan.provider, 'WFM_ENV_BINDING_PROVIDER_REQUIRED', 'Cloud provider is required.').toLowerCase();
  const region = requireString(plan && plan.region, 'WFM_ENV_BINDING_REGION_REQUIRED', 'Cloud region is required.');
  const tenantId = requireString(contract && contract.tenantId, 'WFM_ENV_BINDING_TENANT_REQUIRED', 'Tenant identity is required.');

  const identity = {
    bindingVersion: ENVIRONMENT_BINDING_VERSION,
    queueKey,
    intentDigest,
    providerRequestId,
    provider,
    region,
    tenantId
  };
  const suffix = sha256(identity).slice(0, 12);
  const environmentName = `wfm-${safeTenantSlug(tenantId)}-${suffix}`;
  const subject = { ...identity, environmentName };

  return Object.freeze({
    ...subject,
    bindingDigest: sha256(subject)
  });
}

function assertProvisioningEnvironmentBinding(record, supplied) {
  if (!supplied || typeof supplied !== 'object') {
    fail('WFM_ENV_BINDING_REQUIRED', 'Durable environment binding is required.', 400);
  }
  const expected = deriveProvisioningEnvironmentBinding(record);
  const actual = {
    bindingVersion: String(supplied.bindingVersion || ''),
    queueKey: String(supplied.queueKey || ''),
    intentDigest: String(supplied.intentDigest || '').toLowerCase(),
    providerRequestId: String(supplied.providerRequestId || ''),
    provider: String(supplied.provider || '').toLowerCase(),
    region: String(supplied.region || ''),
    tenantId: String(supplied.tenantId || ''),
    environmentName: String(supplied.environmentName || ''),
    bindingDigest: String(supplied.bindingDigest || '').toLowerCase()
  };
  if (canonical(actual) !== canonical(expected)) {
    fail('WFM_ENV_BINDING_MISMATCH', 'Environment recovery identity changed after the provider create request was committed.');
  }
  return expected;
}

module.exports = {
  ENVIRONMENT_BINDING_VERSION,
  deriveProvisioningEnvironmentBinding,
  assertProvisioningEnvironmentBinding,
  safeTenantSlug,
  sha256,
  canonical
};
