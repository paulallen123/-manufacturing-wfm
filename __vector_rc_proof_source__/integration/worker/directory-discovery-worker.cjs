'use strict';

const { isIP } = require('node:net');

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function compact(value, max = 240) {
  return String(value ?? '').slice(0, max);
}

function requireAccessToken(value) {
  const token = String(value || '');
  if (token.length < 8) throw new Error('Directory discovery requires an OAuth access token.');
  return token;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (parts[0] === 10 || parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 0 || parts[0] === 255) return true;
  return false;
}

function assertSafeHttpsUrl(raw, { sameOrigin } = {}) {
  const url = new URL(String(raw));
  if (url.protocol !== 'https:') throw new Error('Directory discovery refuses non-HTTPS endpoints.');
  if (url.username || url.password) throw new Error('Directory discovery refuses credentials embedded in URLs.');
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Directory discovery refuses local endpoints.');
  }
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 && isPrivateIpv4(hostname)) throw new Error('Directory discovery refuses private IPv4 endpoints.');
  if (ipVersion === 6 && (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd'))) {
    throw new Error('Directory discovery refuses private IPv6 endpoints.');
  }
  if (sameOrigin && url.origin !== sameOrigin) throw new Error('Directory discovery pagination attempted to leave the authorized origin.');
  return url;
}

function parseNextLink(linkHeader, origin) {
  if (!linkHeader) return null;
  const links = String(linkHeader).split(',');
  for (const item of links) {
    const match = item.match(/<([^>]+)>\s*;\s*rel=(?:"next"|next)/i);
    if (!match) continue;
    return assertSafeHttpsUrl(match[1], { sameOrigin: origin }).toString();
  }
  return null;
}

async function fetchJson(url, {
  accessToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  sameOrigin,
  headers = {}
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available.');
  const safeUrl = assertSafeHttpsUrl(url, { sameOrigin });
  const token = requireAccessToken(accessToken);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(safeUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...headers
      },
      signal: controller.signal,
      redirect: 'error'
    });
    if (!response || typeof response.status !== 'number') throw new Error('Directory provider returned an invalid HTTP response.');
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Directory provider request failed with HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers?.get?.('content-length') || 0);
    if (contentLength > maxResponseBytes) throw new Error('Directory provider response exceeded the safe size limit.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new Error('Directory provider response exceeded the safe size limit.');
    let body;
    try { body = text ? JSON.parse(text) : {}; }
    catch { throw new Error('Directory provider returned invalid JSON.'); }
    return { body, headers: response.headers, url: safeUrl.toString() };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Directory provider request timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function appEvidence({ id, appId, displayName, publisher, homepageUrl, loginUrl, identifier, sourceMetadata }) {
  return {
    id: compact(id, 180),
    appId: compact(appId, 180),
    displayName: compact(displayName, 200),
    publisher: compact(publisher, 200),
    homepageUrl: compact(homepageUrl, 400),
    loginUrl: compact(loginUrl, 400),
    identifier: compact(identifier, 220),
    sourceMetadata: sourceMetadata && typeof sourceMetadata === 'object' ? sourceMetadata : {}
  };
}

async function discoverEntra({ accessToken, fetchImpl, maxPages = 20 } = {}) {
  const origin = 'https://graph.microsoft.com';
  let next = `${origin}/v1.0/servicePrincipals?$top=999`;
  const apps = [];
  let pages = 0;
  while (next && pages < Math.min(Math.max(Number(maxPages) || 1, 1), 50)) {
    const response = await fetchJson(next, { accessToken, fetchImpl, sameOrigin: origin });
    const values = Array.isArray(response.body?.value) ? response.body.value : [];
    for (const item of values) {
      if (String(item?.['@odata.type'] || '').includes('agentIdentityBlueprintPrincipal')) continue;
      apps.push(appEvidence({
        id: item?.id,
        appId: item?.appId,
        displayName: item?.displayName,
        publisher: item?.publisherName,
        homepageUrl: item?.homepage,
        loginUrl: item?.loginUrl,
        identifier: Array.isArray(item?.servicePrincipalNames) ? item.servicePrincipalNames[0] : '',
        sourceMetadata: {
          servicePrincipalType: compact(item?.servicePrincipalType, 80),
          accountEnabled: item?.accountEnabled !== false
        }
      }));
    }
    const candidate = response.body?.['@odata.nextLink'];
    next = candidate ? assertSafeHttpsUrl(candidate, { sameOrigin: origin }).toString() : null;
    pages++;
  }
  return { provider: 'ENTRA', apps, pages, truncated: Boolean(next) };
}

async function discoverOkta({ baseUrl, accessToken, fetchImpl, maxPages = 20 } = {}) {
  const base = assertSafeHttpsUrl(baseUrl);
  const origin = base.origin;
  let next = new URL('/api/v1/apps?limit=200&useOptimization=true', origin).toString();
  const apps = [];
  let pages = 0;
  while (next && pages < Math.min(Math.max(Number(maxPages) || 1, 1), 50)) {
    const response = await fetchJson(next, { accessToken, fetchImpl, sameOrigin: origin });
    const values = Array.isArray(response.body) ? response.body : [];
    for (const item of values) {
      apps.push(appEvidence({
        id: item?.id,
        appId: item?.id,
        displayName: item?.label || item?.name,
        publisher: 'Okta catalog',
        homepageUrl: item?._links?.appLinks?.[0]?.href || item?._links?.self?.href,
        loginUrl: item?._links?.appLinks?.[0]?.href,
        identifier: item?.name,
        sourceMetadata: {
          status: compact(item?.status, 40),
          signOnMode: compact(item?.signOnMode, 80)
        }
      }));
    }
    next = parseNextLink(response.headers?.get?.('link'), origin);
    pages++;
  }
  return { provider: 'OKTA', apps, pages, truncated: Boolean(next) };
}

async function listGoogleUsers({ accessToken, fetchImpl, maxUsers }) {
  const origin = 'https://admin.googleapis.com';
  let pageToken = '';
  const users = [];
  while (users.length < maxUsers) {
    const url = new URL('/admin/directory/v1/users', origin);
    url.searchParams.set('customer', 'my_customer');
    url.searchParams.set('maxResults', String(Math.min(100, maxUsers - users.length)));
    url.searchParams.set('orderBy', 'email');
    url.searchParams.set('projection', 'basic');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchJson(url, { accessToken, fetchImpl, sameOrigin: origin });
    const values = Array.isArray(response.body?.users) ? response.body.users : [];
    for (const user of values) {
      if (user?.id) users.push(compact(user.id, 180));
      if (users.length >= maxUsers) break;
    }
    pageToken = compact(response.body?.nextPageToken, 600);
    if (!pageToken || values.length === 0) break;
  }
  return users;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function discoverGoogleWorkspace({
  accessToken,
  fetchImpl,
  maxUsers = 100,
  concurrency = 5
} = {}) {
  const cappedUsers = Math.min(Math.max(Number(maxUsers) || 1, 1), 500);
  const cappedConcurrency = Math.min(Math.max(Number(concurrency) || 1, 1), 10);
  const origin = 'https://admin.googleapis.com';
  const users = await listGoogleUsers({ accessToken, fetchImpl, maxUsers: cappedUsers });
  const tokenLists = await mapWithConcurrency(users, cappedConcurrency, async userId => {
    const url = `${origin}/admin/directory/v1/users/${encodeURIComponent(userId)}/tokens`;
    const response = await fetchJson(url, { accessToken, fetchImpl, sameOrigin: origin });
    return Array.isArray(response.body?.items) ? response.body.items : [];
  });
  const deduped = new Map();
  for (const tokens of tokenLists) {
    for (const token of tokens) {
      const clientId = compact(token?.clientId, 200);
      if (!clientId) continue;
      const current = deduped.get(clientId) || {
        id: clientId,
        appId: clientId,
        displayName: compact(token?.displayText, 200) || `Google OAuth app ${clientId.slice(0, 8)}`,
        publisher: 'Google Workspace OAuth grant',
        homepageUrl: '',
        loginUrl: '',
        identifier: clientId,
        sourceMetadata: { userGrantCount: 0, scopes: new Set(), nativeApp: Boolean(token?.nativeApp), anonymous: Boolean(token?.anonymous) }
      };
      current.sourceMetadata.userGrantCount += 1;
      for (const scope of Array.isArray(token?.scopes) ? token.scopes : []) current.sourceMetadata.scopes.add(compact(scope, 240));
      deduped.set(clientId, current);
    }
  }
  const apps = [...deduped.values()].map(item => appEvidence({
    ...item,
    sourceMetadata: {
      userGrantCount: item.sourceMetadata.userGrantCount,
      scopes: [...item.sourceMetadata.scopes].slice(0, 100),
      nativeApp: item.sourceMetadata.nativeApp,
      anonymous: item.sourceMetadata.anonymous
    }
  }));
  return {
    provider: 'GOOGLE_WORKSPACE',
    apps,
    usersInspected: users.length,
    truncatedUsers: users.length >= cappedUsers
  };
}

async function discoverDirectorySystems(options = {}) {
  const provider = String(options.provider || '').toUpperCase();
  if (provider === 'ENTRA') return discoverEntra(options);
  if (provider === 'OKTA') return discoverOkta(options);
  if (provider === 'GOOGLE_WORKSPACE') return discoverGoogleWorkspace(options);
  throw new Error('Unsupported directory discovery provider.');
}

module.exports = {
  discoverDirectorySystems,
  discoverEntra,
  discoverOkta,
  discoverGoogleWorkspace,
  assertSafeHttpsUrl,
  parseNextLink,
  fetchJson
};
