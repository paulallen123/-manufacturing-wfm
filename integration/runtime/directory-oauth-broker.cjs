'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

const PREFIX = '/api/integrations/autonomous';
const ENTRA_SCOPE = 'openid profile https://graph.microsoft.com/Application.Read.All';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function compact(value, max = 500) {
  return String(value ?? '').slice(0, max);
}

function exactSessionId(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('OAuth session ID is invalid.');
  }
  return value;
}

function safeHttpsOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('WFM_PUBLIC_ORIGIN must be an HTTPS origin without path, query or credentials.');
  }
  return url.origin;
}

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

function deriveVerifier(secret, sessionId) {
  return createHmac('sha256', secret).update('pkce|' + sessionId).digest('base64url');
}

function challengeFor(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function signState(secret, payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

function verifyState(secret, state, nowMs = Date.now()) {
  const [encoded, signature, extra] = String(state || '').split('.');
  if (!encoded || !signature || extra !== undefined) throw new Error('Invalid OAuth state.');
  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!secureEqual(signature, expected)) throw new Error('Invalid OAuth state.');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); }
  catch { throw new Error('Invalid OAuth state.'); }
  if (!payload || typeof payload !== 'object') throw new Error('Invalid OAuth state.');
  if (!payload.s || !payload.p || !Number.isFinite(Number(payload.e))) throw new Error('Invalid OAuth state.');
  if (Number(payload.e) < nowMs) throw new Error('OAuth state has expired.');
  return { sessionId: exactSessionId(payload.s), provider: compact(payload.p, 40), expiresAt: Number(payload.e) };
}

async function readTokenResponse(response, maxBytes = 128 * 1024) {
  if (!response || typeof response.status !== 'number') throw new Error('OAuth provider returned an invalid response.');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('OAuth provider response exceeded the safe size limit.');
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (response.status < 200 || response.status >= 300) {
    const providerCode = compact(body?.error, 100);
    throw new Error(providerCode ? 'OAuth token exchange failed: ' + providerCode : 'OAuth token exchange failed.');
  }
  const accessToken = String(body?.access_token || '');
  if (accessToken.length < 8) throw new Error('OAuth provider did not return an access token.');
  return { accessToken, scope: compact(body?.scope, 1000), expiresIn: Number(body?.expires_in || 0) || null };
}

function createDirectoryOAuthBroker(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const stateSecret = String(options.stateSecret || env.WFM_INTEGRATION_OAUTH_STATE_SECRET || '');
  const publicOriginRaw = options.publicOrigin || env.WFM_PUBLIC_ORIGIN || '';
  let publicOrigin = null;
  try { publicOrigin = safeHttpsOrigin(publicOriginRaw); } catch {}

  const entra = {
    clientId: compact(options.entraClientId || env.WFM_ENTRA_DISCOVERY_CLIENT_ID, 200),
    clientSecret: String(options.entraClientSecret || env.WFM_ENTRA_DISCOVERY_CLIENT_SECRET || '')
  };

  function stateReady() {
    return Boolean(publicOrigin && stateSecret.length >= 32);
  }

  function availability() {
    return [
      {
        key: 'ENTRA',
        label: 'Microsoft 365 / Entra',
        configured: stateReady() && Boolean(entra.clientId && entra.clientSecret),
        mode: 'oauth-readonly',
        permission: 'Application.Read.All',
        adminApprovalRequired: true,
        persistsProviderToken: false
      },
      {
        key: 'OKTA',
        label: 'Okta',
        configured: false,
        mode: 'adapter-ready',
        permission: 'okta.apps.read',
        adminApprovalRequired: true,
        persistsProviderToken: false,
        reason: 'Customer-specific Okta API integration registration is required before zero-engineer authorization can be enabled.'
      },
      {
        key: 'GOOGLE_WORKSPACE',
        label: 'Google Workspace',
        configured: false,
        mode: 'security-review',
        adminApprovalRequired: true,
        persistsProviderToken: false,
        reason: 'Automatic OAuth-app inventory requires admin.directory.user.security; this is intentionally disabled until a narrower discovery path is approved.'
      }
    ];
  }

  function buildAuthorization({ sessionId, provider }) {
    const normalizedProvider = compact(provider, 40).toUpperCase();
    if (normalizedProvider !== 'ENTRA') throw new Error('Automatic OAuth discovery is not enabled for this provider.');
    if (!stateReady() || !entra.clientId || !entra.clientSecret) throw new Error('Microsoft Entra discovery is not configured.');
    const exactSession = exactSessionId(sessionId);
    const expiresAt = now() + 10 * 60 * 1000;
    const state = signState(stateSecret, { s: exactSession, p: normalizedProvider, e: expiresAt });
    const verifier = deriveVerifier(stateSecret, exactSession);
    const redirectUri = publicOrigin + PREFIX + '/oauth/callback/entra';
    const url = new URL('https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize');
    url.searchParams.set('client_id', entra.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', ENTRA_SCOPE);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challengeFor(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'consent');
    return { authorizationUrl: url.toString(), expiresAt, redirectUri };
  }

  async function redeemAuthorizationCode({ provider, state, code }) {
    const normalizedProvider = compact(provider, 40).toUpperCase();
    if (normalizedProvider !== 'ENTRA') throw new Error('Automatic OAuth discovery is not enabled for this provider.');
    if (!stateReady() || !entra.clientId || !entra.clientSecret) throw new Error('Microsoft Entra discovery is not configured.');
    if (typeof fetchImpl !== 'function') throw new Error('OAuth token exchange is unavailable.');

    const verified = verifyState(stateSecret, state, now());
    if (verified.provider !== normalizedProvider) throw new Error('OAuth provider does not match the signed discovery state.');
    const redirectUri = publicOrigin + PREFIX + '/oauth/callback/entra';
    const verifier = deriveVerifier(stateSecret, verified.sessionId);
    const form = new URLSearchParams({
      client_id: entra.clientId,
      client_secret: entra.clientSecret,
      grant_type: 'authorization_code',
      code: compact(code, 4096),
      redirect_uri: redirectUri,
      scope: ENTRA_SCOPE,
      code_verifier: verifier
    });

    const response = await fetchImpl('https://login.microsoftonline.com/organizations/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      redirect: 'error'
    });
    const token = await readTokenResponse(response);
    return { ...verified, ...token };
  }

  return {
    availability,
    buildAuthorization,
    redeemAuthorizationCode,
    verifyState: state => verifyState(stateSecret, state, now())
  };
}

module.exports = {
  createDirectoryOAuthBroker,
  verifyState,
  signState,
  deriveVerifier,
  challengeFor,
  safeHttpsOrigin,
  ENTRA_SCOPE
};
