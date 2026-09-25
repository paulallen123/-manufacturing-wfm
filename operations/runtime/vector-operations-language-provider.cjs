'use strict';

const https = require('node:https');

const CONTRACT_VERSION = 'VECTOR_OPERATIONS_LANGUAGE_V1';
const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 3500;
const MAX_TRANSLATION_TEXT = 4000;
const ALLOWED_KINDS = new Set(['action','capability','capabilities','needs_parameters','unsupported']);

function compact(value, max = 240) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function normaliseLocale(value) {
  const raw = compact(value, 35).replace(/_/g, '-');
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(raw) ? raw : '';
}

function safeEndpoint(value) {
  let url;
  try { url = new URL(String(value || '')); }
  catch { throw new Error('Operations language endpoint is invalid.'); }
  if (url.protocol !== 'https:') throw new Error('Operations language endpoint must use HTTPS.');
  if (url.username || url.password) throw new Error('Operations language endpoint must not contain embedded credentials.');
  if (url.hash) throw new Error('Operations language endpoint must not contain a fragment.');
  return url;
}

function sanitiseAllowedCapabilities(value) {
  return Object.freeze(
    [...new Set((Array.isArray(value) ? value : [])
      .map(item => compact(item, 120))
      .filter(Boolean))]
      .slice(0, 50)
  );
}

function sanitiseInterpretation(value, allowedCapabilities) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Language provider interpretation is invalid.');
  }
  const kind = compact(value.kind, 40);
  if (!ALLOWED_KINDS.has(kind)) throw new Error('Language provider returned an unsupported interpretation kind.');

  const detectedLocale = normaliseLocale(value.detectedLocale);
  const capability = compact(value.capability, 120);
  const allowed = new Set(allowedCapabilities);

  if ((kind === 'action' || kind === 'capability' || kind === 'needs_parameters') && (!capability || !allowed.has(capability))) {
    throw new Error('Language provider returned an unregistered or unauthorised capability.');
  }

  if (kind === 'action') {
    const input = value.args && typeof value.args === 'object' && !Array.isArray(value.args) ? value.args : {};
    const args = {};
    if (Object.prototype.hasOwnProperty.call(input, 'date')) args.date = compact(input.date, 40);
    if (Object.prototype.hasOwnProperty.call(input, 'hours')) {
      const hours = Number(input.hours);
      if (Number.isFinite(hours)) args.hours = hours;
    }
    return Object.freeze({
      kind,
      capability,
      args: Object.freeze(args),
      ...(detectedLocale ? { detectedLocale } : {})
    });
  }

  if (kind === 'needs_parameters') {
    const missing = [...new Set((Array.isArray(value.missing) ? value.missing : [])
      .map(item => compact(item, 40))
      .filter(item => item === 'date' || item === 'hours'))];
    return Object.freeze({
      kind,
      capability,
      missing: Object.freeze(missing),
      ...(detectedLocale ? { detectedLocale } : {})
    });
  }

  return Object.freeze({
    kind,
    ...(capability ? { capability } : {}),
    ...(detectedLocale ? { detectedLocale } : {})
  });
}

function sanitiseTranslations(value, requestedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Language provider translations are invalid.');
  }
  const out = {};
  for (const key of requestedKeys) {
    const text = compact(value[key], MAX_TRANSLATION_TEXT);
    if (!text) throw new Error('Language provider omitted a required translation.');
    out[key] = text;
  }
  return Object.freeze(out);
}

function defaultTransport({ endpoint, token, body, timeoutMs }) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  const options = {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port || 443,
    path: endpoint.pathname + endpoint.search,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'content-length': String(payload.length),
      'user-agent': 'vector-operations-language-gateway/1',
      ...(token ? { authorization: 'Bearer ' + token } : {})
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = https.request(options, res => {
      let size = 0;
      const chunks = [];
      res.on('data', chunk => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Operations language provider response exceeded the safe limit.'));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        if (settled) return;
        const status = Number(res.statusCode || 0);
        if (status < 200 || status > 299) {
          return finish(reject, new Error('Operations language provider returned HTTP ' + status + '.'));
        }
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return finish(reject, new Error('Operations language provider returned invalid JSON.')); }
        finish(resolve, parsed);
      });
    });

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Operations language provider timed out.')));
    req.on('error', error => finish(reject, error));
    req.end(payload);
  });
}

function createVectorOperationsLanguageProvider(options = {}) {
  const rawUrl = options.url || process.env.WFM_OPERATIONS_BOT_LANGUAGE_URL || '';
  if (!rawUrl) return null;

  const endpoint = safeEndpoint(rawUrl);
  const token = compact(options.token || process.env.WFM_OPERATIONS_BOT_LANGUAGE_TOKEN || '', 4096);
  const timeoutMs = Math.max(500, Math.min(10000, Number(options.timeoutMs || process.env.WFM_OPERATIONS_BOT_LANGUAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)));
  const transport = typeof options.transport === 'function' ? options.transport : defaultTransport;

  async function call(mode, input) {
    const body = {
      contractVersion: CONTRACT_VERSION,
      mode,
      input
    };
    const response = await transport({ endpoint, token, body, timeoutMs });
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Operations language provider response is invalid.');
    if (response.contractVersion !== CONTRACT_VERSION) throw new Error('Operations language provider contract version mismatch.');
    if (response.mode !== mode) throw new Error('Operations language provider response mode mismatch.');
    return response;
  }

  async function interpret(input) {
    const message = compact(input && input.message, 2000);
    const locale = normaliseLocale(input && input.locale) || 'en-GB';
    const roleClass = compact(input && input.roleClass, 40);
    const allowedCapabilities = sanitiseAllowedCapabilities(input && input.allowedCapabilities);
    if (!message) throw new Error('Operations language interpretation requires a message.');
    if (!['employee','manager'].includes(roleClass)) throw new Error('Operations language interpretation requires a bounded role class.');
    if (!allowedCapabilities.length) return Object.freeze({ kind: 'unsupported', detectedLocale: locale });

    const response = await call('interpret', {
      message,
      locale,
      roleClass,
      allowedCapabilities
    });
    return sanitiseInterpretation(response.result, allowedCapabilities);
  }

  async function translateMap(input) {
    const targetLocale = normaliseLocale(input && input.targetLocale);
    if (!targetLocale) throw new Error('Operations language translation requires a valid target locale.');
    const source = input && input.texts && typeof input.texts === 'object' && !Array.isArray(input.texts) ? input.texts : {};
    const texts = {};
    const keys = Object.keys(source).filter(key => /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(key)).slice(0, 20);
    for (const key of keys) {
      const text = compact(source[key], MAX_TRANSLATION_TEXT);
      if (text) texts[key] = text;
    }
    if (!Object.keys(texts).length) return Object.freeze({});

    const response = await call('translate', {
      sourceLocale: 'en-GB',
      targetLocale,
      preserve: Object.freeze([
        'Vecta',
        'dates',
        'times',
        'numbers',
        'currency',
        'employee names',
        'site names',
        'capability meaning',
        'approval and confirmation meaning'
      ]),
      texts
    });
    return sanitiseTranslations(response.translations, Object.keys(texts));
  }

  return Object.freeze({
    contractVersion: CONTRACT_VERSION,
    endpointHost: endpoint.hostname,
    interpret,
    translateMap
  });
}

module.exports = Object.freeze({
  CONTRACT_VERSION,
  normaliseLocale,
  safeEndpoint,
  sanitiseInterpretation,
  sanitiseTranslations,
  createVectorOperationsLanguageProvider
});
