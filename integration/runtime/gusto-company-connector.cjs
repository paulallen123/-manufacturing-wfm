'use strict';

const { createHash, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

const GUSTO_HOSTS = Object.freeze({ sandbox: 'https://api.gusto-demo.com', production: 'https://api.gusto.com' });
const CALLBACK_PATH = '/api/integrations/autonomous/oauth/callback/gusto';
const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_LEASE_MS = 30_000;
const EXPIRY_SKEW_MS = 60_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const API_VERSION = '2026-06-15';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_PROJECTION = Object.freeze([
  ['companies:read', 'organisation.read'],
  ['employees:read', 'people.read'],
  ['payrolls:read', 'payroll.read'],
  ['time_sheet:read', 'time.read']
]);

class GustoConnectorError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = 'GustoConnectorError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function fail(code, statusCode, message) {
  throw new GustoConnectorError(code, statusCode, message);
}

const isPhaseError = error =>
  ['SETUP_ONLY_REQUIRED', 'SETUP_MODE_BINDING_UNAVAILABLE'].includes(error?.code) &&
  [403, 503].includes(error?.statusCode);

function safeError(error) {
  if (isPhaseError(error)) return error;
  return error instanceof GustoConnectorError ? error
    : new GustoConnectorError('GUSTO_STORAGE_UNAVAILABLE', 503, 'Gusto credential storage is temporarily unavailable.');
}

function guardedSync(operation) {
  return (...args) => { try { return operation(...args); } catch (error) { throw safeError(error); } };
}

function guardedAsync(operation) {
  return async (...args) => { try { return await operation(...args); } catch (error) { throw safeError(error); } };
}

async function persistRotatedTokens(write) {
  for (let attempt = 0; ; attempt += 1) {
    try { return write(); }
    catch (error) {
      const sqliteCode = Number(error.errcode) & 255;
      if (error.code !== 'ERR_SQLITE_ERROR' || ![5, 6].includes(sqliteCode) || attempt >= 4) throw error;
      // Retry only SQLite BUSY/LOCKED, never the single-use OAuth token request.
      await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

function cleanText(value, max = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}

function readConfiguration(env) {
  const missingConfiguration = [];
  const clientId = env.WFM_GUSTO_CLIENT_ID;
  const clientSecret = env.WFM_GUSTO_CLIENT_SECRET;
  if (!cleanText(clientId, 512)) missingConfiguration.push('WFM_GUSTO_CLIENT_ID');
  if (!cleanText(clientSecret, 4096)) missingConfiguration.push('WFM_GUSTO_CLIENT_SECRET');
  let encryptionKey;
  const encodedKey = env.WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64;
  if (typeof encodedKey === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    const decoded = Buffer.from(encodedKey, 'base64');
    if (decoded.length === 32 && decoded.toString('base64') === encodedKey) encryptionKey = decoded;
  }
  if (!encryptionKey) missingConfiguration.push('WFM_GUSTO_TOKEN_ENCRYPTION_KEY_B64');
  let publicOrigin;
  try {
    const raw = env.WFM_PUBLIC_ORIGIN;
    if (!cleanText(raw, 2048) || /[?#\\]/.test(raw)) throw new Error();
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.pathname !== '/') throw new Error();
    publicOrigin = url.origin;
  } catch { missingConfiguration.push('WFM_PUBLIC_ORIGIN'); }
  const requestedEnvironment = env.WFM_GUSTO_ENVIRONMENT === undefined ? 'sandbox' : env.WFM_GUSTO_ENVIRONMENT;
  const environment = typeof requestedEnvironment === 'string' && Object.hasOwn(GUSTO_HOSTS, requestedEnvironment) ? requestedEnvironment : null;
  if (!environment) missingConfiguration.push('WFM_GUSTO_ENVIRONMENT');
  const clientIdHash = cleanText(clientId, 512) ? createHash('sha256').update(clientId).digest('hex') : null;
  return { clientId, clientIdHash, clientSecret, encryptionKey, publicOrigin, environment, missingConfiguration };
}

function binding(tenant, connectionId, sessionHash) {
  if (!cleanText(tenant, 200) || !cleanText(connectionId, 128) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(connectionId) || (sessionHash !== undefined && !cleanText(sessionHash))) {
    fail('GUSTO_INVALID_INPUT', 400, 'A valid tenant, connection, and browser session are required.');
  }
}

function validToken(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value);
}

function parseTokenResponse(response, at) {
  if (!validToken(response.access_token) || !validToken(response.refresh_token) ||
      typeof response.token_type !== 'string' || response.token_type.toLowerCase() !== 'bearer' ||
      !Number.isSafeInteger(response.expires_in) || response.expires_in <= 0 || response.expires_in > 365 * 24 * 60 * 60) {
    fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto returned an invalid credential response.');
  }
  return { accessToken: response.access_token, refreshToken: response.refresh_token, expiresAt: at + response.expires_in * 1000 };
}

function associatedData(row) {
  return Buffer.from(JSON.stringify(['gusto-company-v1', row.tenant, row.connection_id, row.environment, row.company_uuid, row.client_id_hash]));
}

function sealTokens(key, row, tokens) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(associatedData(row));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }), 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

function openTokens(key, row) {
  try {
    if (typeof row.encrypted_tokens !== 'string' || row.encrypted_tokens.length > 32_000) throw new Error();
    const [version, nonce, tag, ciphertext, extra] = row.encrypted_tokens.split('.');
    if (version !== 'v1' || extra !== undefined || !nonce || !tag || !ciphertext) throw new Error();
    const nonceBytes = Buffer.from(nonce, 'base64');
    const tagBytes = Buffer.from(tag, 'base64');
    if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonceBytes);
    decipher.setAAD(associatedData(row));
    decipher.setAuthTag(tagBytes);
    const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
    if (!validToken(parsed.accessToken) || !validToken(parsed.refreshToken)) throw new Error();
    return parsed;
  } catch { fail('GUSTO_CREDENTIALS_UNREADABLE', 503, 'Stored Gusto credentials cannot be opened with this deployment configuration.'); }
}

function safeMetadata(row, authorizationRef = true) {
  const result = {
    connectionId: row.connection_id,
    companyUuid: row.company_uuid,
    companyName: row.company_name,
    environment: row.environment,
    grantedScopes: JSON.parse(row.granted_scopes),
    verifiedAt: row.verified_at
  };
  if (authorizationRef) result.authorizationRef = 'managed://gusto/' + row.connection_id;
  return result;
}

function createGustoCompanyConnector({ db, env = process.env, fetchImpl = globalThis.fetch, now = Date.now, assertEffect = () => {} }) {
  if (!db || typeof db.prepare !== 'function' || typeof db.exec !== 'function') throw new TypeError('A SQLite connection is required.');
  const config = readConfiguration(env);
  db.exec(`CREATE TABLE IF NOT EXISTS gusto_oauth_states (
    state_hash TEXT PRIMARY KEY,
    tenant TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    session_hash TEXT NOT NULL,
    company_uuid TEXT NOT NULL,
    environment TEXT NOT NULL,
    client_id_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS gusto_company_credentials (
    tenant TEXT NOT NULL,
    connection_id TEXT NOT NULL,
    environment TEXT NOT NULL,
    company_uuid TEXT NOT NULL,
    client_id_hash TEXT NOT NULL,
    company_name TEXT NOT NULL,
    granted_scopes TEXT NOT NULL,
    encrypted_tokens TEXT NOT NULL,
    token_expires_at INTEGER NOT NULL,
    credential_version INTEGER NOT NULL DEFAULT 1,
    verified_version INTEGER,
    verified_at TEXT,
    refresh_lease_id TEXT,
    refresh_lease_until INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (tenant, connection_id)
  );`);

  function availability() {
    return { configured: config.missingConfiguration.length === 0, environment: config.environment,
      missingConfiguration: [...config.missingConfiguration] };
  }

  function requireConfigured() {
    if (config.missingConfiguration.length) fail('GUSTO_NOT_CONFIGURED', 503, 'Gusto is not configured for this deployment.');
  }

  function beginAuthorization({ tenant, connectionId, sessionHash, expectedCompanyUuid } = {}) {
    requireConfigured();
    binding(tenant, connectionId, sessionHash);
    if (!cleanText(sessionHash) || typeof expectedCompanyUuid !== 'string' || !UUID.test(expectedCompanyUuid)) {
      fail('GUSTO_INVALID_INPUT', 400, 'A browser session and expected Gusto company UUID are required.');
    }
    const createdAt = now();
    const expiresAt = createdAt + STATE_TTL_MS;
    const state = randomBytes(32).toString('base64url');
    const stateHash = createHash('sha256').update(state).digest('hex');
    assertEffect(tenant);
    db.prepare('DELETE FROM gusto_oauth_states WHERE expires_at <= ?').run(createdAt);
    db.prepare(`INSERT INTO gusto_oauth_states
      (state_hash, tenant, connection_id, session_hash, company_uuid, environment, client_id_hash, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(stateHash, tenant, connectionId, sessionHash, expectedCompanyUuid.toLowerCase(), config.environment, config.clientIdHash, createdAt, expiresAt);
    const authorization = new URL('/oauth/authorize', GUSTO_HOSTS[config.environment]);
    authorization.searchParams.set('client_id', config.clientId);
    authorization.searchParams.set('redirect_uri', config.publicOrigin + CALLBACK_PATH);
    authorization.searchParams.set('response_type', 'code');
    authorization.searchParams.set('state', state);
    // Registered App Integrations scopes are assigned in Gusto's Developer Portal.
    // Its OAuth documentation does not define an authorization scope/PKCE parameter.
    return { authorizationUrl: authorization.toString(), expiresAt: new Date(expiresAt).toISOString(), environment: config.environment };
  }

  async function requestJson(path, { accessToken, body, operation = 'read', tenant } = {}) {
    const base = GUSTO_HOSTS[config.environment];
    // Every caller uses a constant path or a validated UUID; no provider-supplied URL is followed.
    const target = new URL(path, base);
    if (target.origin !== base || target.username || target.password || target.search || target.hash) {
      fail('GUSTO_INVALID_INPUT', 400, 'The Gusto request target is invalid.');
    }
    const controller = new AbortController();
    let reader;
    let timer;
    const cancelReader = () => { if (reader) reader.cancel().catch(() => {}); };
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new GustoConnectorError('GUSTO_PROVIDER_TIMEOUT', 504, 'Gusto did not respond within the request deadline.'));
        controller.abort();
        cancelReader();
      }, REQUEST_TIMEOUT_MS);
    });
    const request = async () => {
      assertEffect(tenant);
      const headers = { Accept: 'application/json', 'X-Gusto-API-Version': API_VERSION };
      if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
      if (body) headers['Content-Type'] = 'application/json';
      const response = await fetchImpl(target.href, {
        method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error', signal: controller.signal
      });
      if (response?.body?.getReader) reader = response.body.getReader();
      if (response?.redirected || (response?.status >= 300 && response.status < 400) ||
          (response?.url && new URL(response.url).origin !== base)) {
        fail('GUSTO_PROVIDER_REDIRECT', 502, 'Gusto returned an unexpected redirect.');
      }
      const status = response?.status;
      if ((status === 400 || status === 401) && operation === 'refresh') fail('GUSTO_REAUTHORIZATION_REQUIRED', 401, 'Gusto rejected the stored refresh credential. Authorize this company again.');
      if (status === 401) fail('GUSTO_UNAUTHORIZED', 401, 'Gusto rejected the current authorization.');
      if (status === 403) fail('GUSTO_FORBIDDEN', 403, 'Gusto denied this connection the requested read access.');
      if (status === 429) fail('GUSTO_RATE_LIMITED', 429, 'Gusto is temporarily limiting requests.');
      if (status === 400 && operation === 'authorization') fail('GUSTO_AUTHORIZATION_REJECTED', 400, 'Gusto rejected the authorization code. Start authorization again.');
      if (!Number.isInteger(status) || status < 200 || status >= 300) fail('GUSTO_PROVIDER_UNAVAILABLE', 502, 'Gusto could not complete the request.');
      const declared = response.headers?.get?.('content-length');
      if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
        fail('GUSTO_RESPONSE_TOO_LARGE', 502, 'Gusto returned a response exceeding the connector limit.');
      }
      if (!reader) fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto returned an invalid response.');
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) fail('GUSTO_RESPONSE_TOO_LARGE', 502, 'Gusto returned a response exceeding the connector limit.');
        chunks.push(Buffer.from(value));
      }
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
      catch { fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto returned an invalid JSON response.'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto returned an invalid response.');
      return parsed;
    };
    try { return await Promise.race([request(), timeout]); }
    catch (error) {
      cancelReader();
      if (isPhaseError(error)) throw error;
      if (error instanceof GustoConnectorError) throw error;
      fail('GUSTO_PROVIDER_UNAVAILABLE', 502, 'Gusto could not complete the request.');
    } finally { clearTimeout(timer); }
  }

  async function verifyCompany(accessToken, companyUuid, tenant) {
    const info = await requestJson('/v1/token_info', { accessToken, tenant });
    if (info.resource?.type !== 'Company' || typeof info.resource.uuid !== 'string' || !UUID.test(info.resource.uuid)) {
      fail('GUSTO_TOKEN_SUBJECT_INVALID', 403, 'Gusto authorization must belong to a company.');
    }
    if (info.resource.uuid.toLowerCase() !== companyUuid) fail('GUSTO_COMPANY_MISMATCH', 403, 'The authorized Gusto company does not match the expected company.');
    if (typeof info.scope !== 'string' || info.scope.length > 16_384) fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto did not return valid granted scopes.');
    const scopes = new Set(info.scope.split(/\s+/).filter(Boolean));
    if (!scopes.has('companies:read')) fail('GUSTO_SCOPE_REQUIRED', 403, 'Gusto company read access is required to verify this connection.');
    const company = await requestJson('/v1/companies/' + companyUuid, { accessToken, tenant });
    if (typeof company.uuid !== 'string' || !UUID.test(company.uuid) || company.uuid.toLowerCase() !== companyUuid) {
      fail('GUSTO_COMPANY_MISMATCH', 403, 'The Gusto company response does not match the expected company.');
    }
    if (!cleanText(company.name, 512)) fail('GUSTO_INVALID_PROVIDER_RESPONSE', 502, 'Gusto did not return a valid company name.');
    return { companyName: company.name, grantedScopes: SCOPE_PROJECTION.filter(([scope]) => scopes.has(scope)).map(([, canonical]) => canonical) };
  }

  function credential(tenant, connectionId) {
    return db.prepare('SELECT * FROM gusto_company_credentials WHERE tenant = ? AND connection_id = ?').get(tenant, connectionId);
  }

  function requireEnvironment(row) {
    if (row.environment !== config.environment) fail('GUSTO_ENVIRONMENT_MISMATCH', 409, 'This Gusto connection belongs to a different deployment environment.');
  }

  function requireCredentialContext(row) {
    requireEnvironment(row);
    if (row.client_id_hash !== config.clientIdHash) fail('GUSTO_CLIENT_MISMATCH', 409, 'This Gusto connection was authorized for a different registered application. Authorize it again.');
  }

  async function completeAuthorization({ tenant, sessionHash, state, code, providerError, expectedCompanyUuid } = {}) {
    requireConfigured();
    if (!cleanText(tenant, 200) || !cleanText(sessionHash) || typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      fail('GUSTO_INVALID_STATE', 400, 'The Gusto authorization state is invalid or expired.');
    }
    const at = now();
    assertEffect(tenant);
    // A single SQLite statement claims the state before any network operation.
    const claimed = db.prepare(`UPDATE gusto_oauth_states SET consumed_at = ?
      WHERE state_hash = ? AND tenant = ? AND session_hash = ? AND environment = ? AND client_id_hash = ?
        AND consumed_at IS NULL AND expires_at > ? RETURNING *`)
      .get(at, createHash('sha256').update(state).digest('hex'), tenant, sessionHash, config.environment, config.clientIdHash, at);
    if (!claimed) fail('GUSTO_INVALID_STATE', 400, 'The Gusto authorization state is invalid or expired.');
    if (expectedCompanyUuid !== undefined) {
      if (typeof expectedCompanyUuid !== 'string' || !UUID.test(expectedCompanyUuid)) fail('GUSTO_INVALID_INPUT', 400, 'A valid expected Gusto company UUID is required.');
      if (expectedCompanyUuid.toLowerCase() !== claimed.company_uuid) fail('GUSTO_COMPANY_MISMATCH', 403, 'The expected Gusto company changed after authorization began. Start authorization again.');
    }
    if (providerError !== undefined && providerError !== null && providerError !== '') fail('GUSTO_OAUTH_DENIED', 400, 'Gusto authorization was declined. Start authorization again.');
    if (!cleanText(code, 4096)) fail('GUSTO_INVALID_INPUT', 400, 'A valid Gusto authorization code is required.');
    const tokens = parseTokenResponse(await requestJson('/oauth/token', { tenant, operation: 'authorization', body: {
      client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.publicOrigin + CALLBACK_PATH,
      code, grant_type: 'authorization_code'
    } }), now());
    const verified = await verifyCompany(tokens.accessToken, claimed.company_uuid, tenant);
    const verifiedAt = new Date(now()).toISOString();
    const encrypted = sealTokens(config.encryptionKey, claimed, tokens);
    assertEffect(tenant);
    const stored = db.prepare(`INSERT INTO gusto_company_credentials
      (tenant, connection_id, environment, company_uuid, client_id_hash, company_name, granted_scopes, encrypted_tokens, token_expires_at,
        credential_version, verified_version, verified_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
      ON CONFLICT (tenant, connection_id) DO UPDATE SET
        client_id_hash = excluded.client_id_hash, company_name = excluded.company_name,
        granted_scopes = excluded.granted_scopes, encrypted_tokens = excluded.encrypted_tokens,
        token_expires_at = excluded.token_expires_at, credential_version = gusto_company_credentials.credential_version + 1,
        verified_version = gusto_company_credentials.credential_version + 1, verified_at = excluded.verified_at,
        refresh_lease_id = NULL, refresh_lease_until = NULL, updated_at = excluded.updated_at
      WHERE gusto_company_credentials.company_uuid = excluded.company_uuid
        AND gusto_company_credentials.environment = excluded.environment
      RETURNING *`).get(tenant, claimed.connection_id, config.environment, claimed.company_uuid, config.clientIdHash, verified.companyName,
        JSON.stringify(verified.grantedScopes), encrypted, tokens.expiresAt, verifiedAt, now());
    if (!stored) {
      const existing = credential(tenant, claimed.connection_id);
      if (existing) requireEnvironment(existing);
      fail('GUSTO_COMPANY_MISMATCH', 403, 'This connection is already bound to a different Gusto company.');
    }
    return safeMetadata(stored);
  }

  function getConnectionStatus({ tenant, connectionId } = {}) {
    if (config.missingConfiguration.length) return null;
    binding(tenant, connectionId);
    const row = credential(tenant, connectionId);
    if (!row || row.environment !== config.environment || row.client_id_hash !== config.clientIdHash || !row.verified_at || row.verified_version !== row.credential_version) return null;
    try {
      openTokens(config.encryptionKey, row);
      return safeMetadata(row, false);
    } catch { return null; }
  }

  async function refreshCredentials(row) {
    assertEffect(row.tenant);
    const at = now();
    const leaseId = randomBytes(16).toString('hex');
    const claimed = db.prepare(`UPDATE gusto_company_credentials SET refresh_lease_id = ?, refresh_lease_until = ?
      WHERE tenant = ? AND connection_id = ? AND credential_version = ?
        AND (refresh_lease_until IS NULL OR refresh_lease_until <= ?) RETURNING *`)
      .get(leaseId, at + REFRESH_LEASE_MS, row.tenant, row.connection_id, row.credential_version, at);
    if (!claimed) {
      const latest = credential(row.tenant, row.connection_id);
      if (latest) {
        requireCredentialContext(latest);
        if (latest.credential_version !== row.credential_version && latest.token_expires_at > now() + EXPIRY_SKEW_MS) return latest;
      }
      fail('GUSTO_REFRESH_IN_PROGRESS', 409, 'Gusto credentials are already being refreshed. Retry verification shortly.');
    }
    try {
      requireCredentialContext(claimed);
      const prior = openTokens(config.encryptionKey, claimed);
      const tokens = parseTokenResponse(await requestJson('/oauth/token', { tenant: row.tenant, operation: 'refresh', body: {
        client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.publicOrigin + CALLBACK_PATH,
        refresh_token: prior.refreshToken, grant_type: 'refresh_token'
      } }), now());
      // Refresh tokens are single-use. Save the replacement before subsequent reads,
      // retaining an unverified version until company verification succeeds.
      const encrypted = sealTokens(config.encryptionKey, claimed, tokens);
      const rotated = await persistRotatedTokens(() => { assertEffect(row.tenant); return db.prepare(`UPDATE gusto_company_credentials SET encrypted_tokens = ?, token_expires_at = ?,
        credential_version = credential_version + 1, verified_version = NULL, refresh_lease_id = NULL,
        refresh_lease_until = NULL, updated_at = ?
        WHERE tenant = ? AND connection_id = ? AND credential_version = ? AND refresh_lease_id = ? RETURNING *`)
        .get(encrypted, tokens.expiresAt, now(), row.tenant, row.connection_id, row.credential_version, leaseId); });
      if (!rotated) fail('GUSTO_REFRESH_CONFLICT', 409, 'Gusto credentials changed during refresh. Retry verification.');
      return rotated;
    } finally {
      try {
        db.prepare(`UPDATE gusto_company_credentials SET refresh_lease_id = NULL, refresh_lease_until = NULL
          WHERE tenant = ? AND connection_id = ? AND credential_version = ? AND refresh_lease_id = ?`)
          .run(row.tenant, row.connection_id, row.credential_version, leaseId);
      } catch {
        // A storage outage must not replace the original failure. The lease expires.
      }
    }
  }

  async function verifyConnection({ tenant, connectionId } = {}) {
    requireConfigured();
    binding(tenant, connectionId);
    assertEffect(tenant);
    let row = credential(tenant, connectionId);
    if (!row) fail('GUSTO_CONNECTION_NOT_FOUND', 404, 'No stored Gusto authorization exists for this connection.');
    requireCredentialContext(row);
    try {
      openTokens(config.encryptionKey, row);
      let refreshed = false;
      if (row.token_expires_at <= now() + EXPIRY_SKEW_MS) {
        row = await refreshCredentials(row);
        refreshed = true;
      }
      let verified;
      try { verified = await verifyCompany(openTokens(config.encryptionKey, row).accessToken, row.company_uuid, tenant); }
      catch (error) {
        if (error.code !== 'GUSTO_UNAUTHORIZED' || refreshed) throw error;
        row = await refreshCredentials(row);
        verified = await verifyCompany(openTokens(config.encryptionKey, row).accessToken, row.company_uuid, tenant);
      }
      assertEffect(tenant);
      const saved = db.prepare(`UPDATE gusto_company_credentials SET company_name = ?, granted_scopes = ?,
        verified_version = credential_version, verified_at = ?, updated_at = ?
        WHERE tenant = ? AND connection_id = ? AND credential_version = ? RETURNING *`)
        .get(verified.companyName, JSON.stringify(verified.grantedScopes), new Date(now()).toISOString(), now(), tenant, connectionId, row.credential_version);
      if (!saved) fail('GUSTO_REFRESH_CONFLICT', 409, 'Gusto credentials changed during verification. Retry verification.');
      return safeMetadata(saved);
    } catch (error) {
      if (['GUSTO_REAUTHORIZATION_REQUIRED', 'GUSTO_UNAUTHORIZED', 'GUSTO_FORBIDDEN', 'GUSTO_COMPANY_MISMATCH', 'GUSTO_TOKEN_SUBJECT_INVALID', 'GUSTO_SCOPE_REQUIRED'].includes(error.code)) {
        assertEffect(tenant);
        const invalidated = db.prepare(`UPDATE gusto_company_credentials SET verified_version = NULL
          WHERE tenant = ? AND connection_id = ? AND credential_version = ?`)
          .run(tenant, connectionId, row.credential_version);
        if (!invalidated.changes) fail('GUSTO_REFRESH_CONFLICT', 409, 'Gusto credentials changed during verification. Retry verification.');
      }
      throw error;
    }
  }

  return { availability, beginAuthorization: guardedSync(beginAuthorization),
    completeAuthorization: guardedAsync(completeAuthorization), verifyConnection: guardedAsync(verifyConnection),
    getConnectionStatus: guardedSync(getConnectionStatus) };
}

module.exports = { createGustoCompanyConnector };
