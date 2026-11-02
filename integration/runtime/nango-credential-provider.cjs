'use strict';

// Server-only credential adapter for the existing provider-metadata-broker.
// Provider requests still use that broker's direct, DNS-pinned transport.
const { performance } = require('node:perf_hooks');

const NANGO_ORIGIN = 'https://api.nango.dev';
const MIN_TTL_MS = 30_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PROVIDERS = Object.freeze({
  netsuite: Object.freeze({ nango: 'netsuite', type: 'OAUTH2', token: 'access_token', config: ['accountId'] }),
  successfactors: Object.freeze({ nango: 'sap-success-factors', type: 'TWO_STEP', token: 'token', config: ['apiServer', 'companyId'] })
});
const MESSAGES = Object.freeze({
  NANGO_CONFIGURATION_INVALID: 'Nango credential bindings are invalid or incomplete.',
  NANGO_CONTEXT_REJECTED: 'Nango credentials are not bound to this tenant and provider profile.',
  NANGO_CONNECTION_MISMATCH: 'Nango returned a connection outside the approved binding.',
  NANGO_CONNECTION_UNHEALTHY: 'Nango reports a connection error; reconnect the approved source.',
  NANGO_CREDENTIAL_INVALID: 'Nango did not return the required provider credential.',
  NANGO_CREDENTIAL_EXPIRY_INVALID: 'Nango credential expiry is missing, invalid or outside the permitted lifetime.',
  NANGO_CREDENTIAL_UNAVAILABLE: 'Nango could not provide the approved connection credentials.',
  NANGO_RESPONSE_INVALID: 'Nango returned an invalid credential response.',
  NANGO_RESPONSE_TOO_LARGE: 'Nango credential response exceeded the permitted size.',
  NANGO_REDIRECT_REJECTED: 'Nango credential request did not remain at its exact approved endpoint.',
  NANGO_REQUEST_TIMEOUT: 'Nango credential request exceeded its deadline.',
  NANGO_TRANSPORT_UNAVAILABLE: 'Nango credential transport is unavailable.'
});

class CredentialError extends Error {
  constructor(code, status = 503) {
    super(MESSAGES[code]);
    this.name = 'NangoCredentialError';
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}
function fail(code, status) { throw new CredentialError(code, status); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
function identifier(value, max) { return text(value, max) && /^[A-Za-z0-9_.:-]+$/.test(value); }
function secret(value) { return typeof value === 'string' && value.length >= 16 && value.length <= 32_768 && /^[\x21-\x7e]+$/.test(value); }
function clock(now) {
  const at = now();
  if (!Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000) fail('NANGO_CONFIGURATION_INVALID');
  return at;
}
function bindingKey(tenant, profileId) { return JSON.stringify([tenant, profileId]); }

function parseBindings(input) {
  let rows = input;
  if (typeof rows === 'string') {
    if (Buffer.byteLength(rows) > 65_536) fail('NANGO_CONFIGURATION_INVALID');
    try { rows = JSON.parse(rows); } catch { fail('NANGO_CONFIGURATION_INVALID'); }
  }
  if (!Array.isArray(rows) || rows.length > 100) fail('NANGO_CONFIGURATION_INVALID');
  const localKeys = new Set(), remoteKeys = new Set(), profileIds = new Set();
  const keys = ['tenant', 'profileId', 'provider', 'system', 'credentialRef', 'integrationId', 'connectionId', 'expectedConnectionConfig'];
  return Object.freeze(rows.map(row => {
    if (!object(row) || Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k))) fail('NANGO_CONFIGURATION_INVALID');
    const provider = typeof row.provider === 'string' && Object.hasOwn(PROVIDERS, row.provider) ? PROVIDERS[row.provider] : null;
    if (!provider || !identifier(row.tenant, 120) || !identifier(row.profileId, 100) || !text(row.system, 120) ||
        !text(row.credentialRef, 120) || !/^WFM_BROKER_TOKEN_[A-Z0-9_]{3,100}$/.test(row.credentialRef) ||
        !identifier(row.integrationId, 200) || !identifier(row.connectionId, 200) ||
        row.connectionId === '.' || row.connectionId === '..') fail('NANGO_CONFIGURATION_INVALID');
    const config = row.expectedConnectionConfig;
    if (!object(config) || Object.keys(config).length !== provider.config.length ||
        provider.config.some(k => !Object.hasOwn(config, k) || !text(config[k], 253))) fail('NANGO_CONFIGURATION_INVALID');
    if (row.provider === 'netsuite' && !/^[A-Za-z0-9_-]+$/.test(config.accountId)) fail('NANGO_CONFIGURATION_INVALID');
    if (row.provider === 'successfactors' &&
        (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(config.apiServer) || !config.apiServer.includes('.'))) fail('NANGO_CONFIGURATION_INVALID');
    const local = bindingKey(row.tenant, row.profileId), remote = JSON.stringify([row.integrationId, row.connectionId]);
    if (localKeys.has(local) || remoteKeys.has(remote) || profileIds.has(row.profileId)) fail('NANGO_CONFIGURATION_INVALID');
    localKeys.add(local); remoteKeys.add(remote); profileIds.add(row.profileId);
    return Object.freeze({ ...row, expectedConnectionConfig: Object.freeze(Object.fromEntries(provider.config.map(k => [k, config[k]]))) });
  }));
}

function assertContext(context, bindings) {
  if (!object(context) || !identifier(context.tenant, 120) || !identifier(context.profileId, 100) ||
      !object(context.actor) || context.actor.tenant !== context.tenant) fail('NANGO_CONTEXT_REJECTED', 403);
  const bound = bindings.get(bindingKey(context.tenant, context.profileId));
  if (!bound || ['tenant', 'profileId', 'provider', 'system', 'credentialRef'].some(k => context[k] !== bound[k])) fail('NANGO_CONTEXT_REJECTED', 403);
  return bound;
}

function credentialFromConnection(doc, binding, now) {
  const provider = PROVIDERS[binding.provider];
  if (!object(doc) || doc.connection_id !== binding.connectionId || doc.provider_config_key !== binding.integrationId ||
      doc.provider !== provider.nango || !object(doc.tags) || doc.tags.vector_tenant_id !== binding.tenant ||
      doc.tags.vector_profile_id !== binding.profileId || !object(doc.connection_config) ||
      provider.config.some(k => doc.connection_config[k] !== binding.expectedConnectionConfig[k])) fail('NANGO_CONNECTION_MISMATCH');
  if (!Array.isArray(doc.errors) || doc.errors.length) fail('NANGO_CONNECTION_UNHEALTHY');
  const credentials = doc.credentials;
  if (!object(credentials) || credentials.type !== provider.type || !secret(credentials[provider.token])) fail('NANGO_CREDENTIAL_INVALID');
  const expiry = credentials.expires_at;
  // Do not fabricate an expiry from raw.expires_in or from the time of this read.
  if (typeof expiry !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(expiry)) fail('NANGO_CREDENTIAL_EXPIRY_INVALID');
  const expiresAt = Date.parse(expiry), current = clock(now);
  if (!Number.isFinite(expiresAt) || new Date(expiresAt).toISOString() !== expiry.replace(/Z$/, expiry.includes('.') ? 'Z' : '.000Z') ||
      expiresAt - current <= MIN_TTL_MS || expiresAt - current > MAX_TTL_MS) fail('NANGO_CREDENTIAL_EXPIRY_INVALID');
  return Object.freeze({ accessToken: credentials[provider.token], expiresAt: new Date(expiresAt).toISOString() });
}

function createNangoCredentialProvider({ bindings, apiKey, apiOrigin = NANGO_ORIGIN, fetchImpl = globalThis.fetch,
  now = Date.now, timeoutMs = 10_000, maxResponseBytes = 256 * 1024 } = {}) {
  if (apiOrigin !== NANGO_ORIGIN || !secret(apiKey) || typeof fetchImpl !== 'function' || typeof now !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 256 || maxResponseBytes > 1024 * 1024) fail('NANGO_CONFIGURATION_INVALID');
  const parsed = parseBindings(bindings);
  if (!parsed.length) fail('NANGO_CONFIGURATION_INVALID');
  const byContext = new Map(parsed.map(b => [bindingKey(b.tenant, b.profileId), b]));

  return async function credentialProvider(context) {
    const binding = assertContext(context, byContext);
    clock(now);
    const url = new URL('/connections/' + encodeURIComponent(binding.connectionId), NANGO_ORIGIN);
    url.searchParams.set('provider_config_key', binding.integrationId);
    url.searchParams.set('refresh_token', 'false');
    const controller = new AbortController();
    const deadline = performance.now() + timeoutMs;
    let reader, response, timer;
    function cancel() {
      controller.abort();
      try { const pending = reader ? reader.cancel() : response?.body?.cancel(); Promise.resolve(pending).catch(() => {}); } catch {}
    }
    function checkDeadline() { if (controller.signal.aborted || performance.now() >= deadline) fail('NANGO_REQUEST_TIMEOUT'); }
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => { cancel(); reject(new CredentialError('NANGO_REQUEST_TIMEOUT')); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        response = await fetchImpl(url.href, { method: 'GET', headers: { Accept: 'application/json', Authorization: 'Bearer ' + apiKey },
          redirect: 'error', signal: controller.signal });
        checkDeadline();
        if (response?.redirected || response?.url !== url.href || (response?.status >= 300 && response?.status < 400)) fail('NANGO_REDIRECT_REJECTED');
        if (response?.status !== 200) fail('NANGO_CREDENTIAL_UNAVAILABLE');
        const contentType = response.headers?.get?.('content-type');
        if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) fail('NANGO_RESPONSE_INVALID');
        const declared = response.headers?.get?.('content-length');
        if (declared !== null && declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > maxResponseBytes)) fail('NANGO_RESPONSE_TOO_LARGE');
        if (typeof response.body?.getReader !== 'function') fail('NANGO_RESPONSE_INVALID');
        reader = response.body.getReader();
        const chunks = []; let size = 0;
        for (;;) {
          checkDeadline();
          const { done, value } = await reader.read();
          checkDeadline();
          if (done) break;
          if (!(value instanceof Uint8Array)) fail('NANGO_RESPONSE_INVALID');
          size += value.byteLength;
          if (size > maxResponseBytes) fail('NANGO_RESPONSE_TOO_LARGE');
          chunks.push(Buffer.from(value));
        }
        let doc;
        try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
        catch { fail('NANGO_RESPONSE_INVALID'); }
        checkDeadline();
        return credentialFromConnection(doc, binding, now);
      })()]);
    } catch (error) {
      cancel();
      if (error instanceof CredentialError) throw error;
      fail('NANGO_TRANSPORT_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      try { reader?.releaseLock(); } catch {}
    }
  };
}

function createForMetadataProfiles({ profiles, env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const raw = env.WFM_NANGO_METADATA_BINDINGS_JSON;
  if (raw === undefined || raw === '') return null;
  const bindings = parseBindings(raw);
  if (!bindings.length) return null;
  if (!Array.isArray(profiles) || profiles.length !== bindings.length) fail('NANGO_CONFIGURATION_INVALID');
  // A callback replaces the broker's env-token branch. Require full coverage;
  // never invent token expiry for an unmapped legacy credential as a fallback.
  for (const binding of bindings) {
    const matches = profiles.filter(p => p.id === binding.profileId);
    if (matches.length !== 1) fail('NANGO_CONFIGURATION_INVALID');
    const p = matches[0];
    if (p.tenant !== binding.tenant || p.provider !== binding.provider || p.system !== binding.system ||
        p.credentialEnv !== binding.credentialRef) fail('NANGO_CONFIGURATION_INVALID');
    if (p.provider === 'netsuite') {
      const origin = 'https://' + binding.expectedConnectionConfig.accountId.toLowerCase().replaceAll('_', '-') + '.suitetalk.api.netsuite.com';
      if (p.accountId !== binding.expectedConnectionConfig.accountId || p.allowedOrigin !== origin || p.restOrigin !== origin) fail('NANGO_CONFIGURATION_INVALID');
    } else if (p.allowedOrigin !== 'https://' + binding.expectedConnectionConfig.apiServer) fail('NANGO_CONFIGURATION_INVALID');
  }
  return createNangoCredentialProvider({ bindings, apiKey: env.WFM_NANGO_API_KEY, fetchImpl, now });
}

module.exports = { createNangoCredentialProvider, createForMetadataProfiles };
