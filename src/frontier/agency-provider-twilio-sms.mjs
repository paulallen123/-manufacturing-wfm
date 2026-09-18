import crypto from 'node:crypto';

export const AGENCY_TWILIO_SMS_PROVIDER_VERSION = 'agency-twilio-sms-provider-v0.1.1';
export const AGENCY_TWILIO_SMS_PROVIDER_KEY = 'twilio_sms';

const TWILIO_SID = /^SM[0-9A-Za-z]{32}$/;
const TWILIO_ACCOUNT_SID = /^AC[0-9A-Za-z]{32}$/;
const TWILIO_MESSAGING_SERVICE_SID = /^MG[0-9A-Za-z]{32}$/;
const DELIVERY_ID = /^[a-f0-9]{64}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

function cleanString(value, name, max = 200) {
  if (typeof value !== 'string') throw new TypeError(`${name} is required`);
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new TypeError(`${name} contains control characters`);
  const clean = value.trim();
  if (!clean) throw new TypeError(`${name} is required`);
  if (clean.length > max) throw new TypeError(`${name} is too long`);
  return clean;
}

function optionalString(value, name, max = 200) {
  if (value === undefined || value === null || value === '') return null;
  return cleanString(String(value), name, max);
}

function requireIso(value, name) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${name} must be a valid timestamp`);
  return new Date(parsed).toISOString();
}

function headerValue(headers, wanted) {
  const key = wanted.toLowerCase();
  if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.get(key) ?? '';
  for (const [name, value] of Object.entries(headers || {})) {
    if (String(name).toLowerCase() === key) return Array.isArray(value) ? value.join(',') : String(value ?? '');
  }
  return '';
}

function assertHttpsUrl(value, name, {allowQuery = false} = {}) {
  const raw = cleanString(value, name, 2048);
  let url;
  try { url = new URL(raw); } catch { throw new TypeError(`${name} must be a valid URL`); }
  if (url.protocol !== 'https:') throw new TypeError(`${name} must use https`);
  if (url.username || url.password) throw new TypeError(`${name} must not contain userinfo`);
  if (url.hash) throw new TypeError(`${name} must not contain a fragment`);
  if (!allowQuery && url.search) throw new TypeError(`${name} must not contain a query string`);
  return url;
}

function normalizeDeliveryId(value) {
  const deliveryId = cleanString(value, 'deliveryId', 64).toLowerCase();
  if (!DELIVERY_ID.test(deliveryId)) throw new TypeError('deliveryId must be a 64 character hex digest');
  return deliveryId;
}

export function twilioStatusCallbackUrl(statusCallbackBaseUrl, deliveryId) {
  const base = assertHttpsUrl(statusCallbackBaseUrl, 'statusCallbackBaseUrl');
  const id = normalizeDeliveryId(deliveryId);
  const path = base.pathname.endsWith('/') ? base.pathname.slice(0, -1) : base.pathname;
  base.pathname = `${path}/${id}`;
  return base.toString();
}

function parseFormBody(rawBody) {
  let text;
  if (typeof rawBody === 'string') text = rawBody;
  else if (Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array) text = Buffer.from(rawBody).toString('utf8');
  else throw new TypeError('Twilio callback rawBody must be original form bytes or text');
  if (!text || Buffer.byteLength(text, 'utf8') > 65536) throw new TypeError('Twilio callback body is empty or too large');

  const params = new URLSearchParams(text);
  const out = Object.create(null);
  for (const [key, value] of params.entries()) {
    if (Object.hasOwn(out, key)) throw new TypeError('Twilio callback contains duplicate parameters');
    out[key] = value;
  }
  return out;
}

function normalizeTwilioStatus(status) {
  const value = cleanString(status, 'MessageStatus', 40).toLowerCase();
  if (['sent', 'delivered', 'read'].includes(value)) return 'confirmed_sent';
  if (['failed', 'undelivered', 'canceled'].includes(value)) return 'delivery_failed';
  return 'informational';
}

function providerEventId({messageSid, messageStatus, errorCode}) {
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({messageSid, messageStatus, errorCode: errorCode ?? null}))
    .digest('hex');
  return `twilio:${digest}`;
}

export function createTwilioSmsSender({messages, statusCallbackBaseUrl, from = null, messagingServiceSid = null} = {}) {
  if (!messages || typeof messages.create !== 'function') throw new TypeError('Twilio messages.create client is required');
  const callbackBase = assertHttpsUrl(statusCallbackBaseUrl, 'statusCallbackBaseUrl').toString();
  const senderFrom = from === null ? null : cleanString(from, 'from', 100);
  const serviceSid = messagingServiceSid === null ? null : cleanString(messagingServiceSid, 'messagingServiceSid', 100);
  if (serviceSid !== null && !TWILIO_MESSAGING_SERVICE_SID.test(serviceSid)) throw new TypeError('messagingServiceSid must be a valid Twilio Messaging Service SID');
  if ((senderFrom === null) === (serviceSid === null)) throw new TypeError('exactly one of from or messagingServiceSid is required');

  return Object.freeze({
    providerKey: AGENCY_TWILIO_SMS_PROVIDER_KEY,
    channel: 'sms',
    version: AGENCY_TWILIO_SMS_PROVIDER_VERSION,
    async send(payload = {}) {
      if (payload.channel !== 'sms') throw new TypeError('Twilio SMS sender only supports sms channel');
      const destination = cleanString(payload.destination, 'destination', 32);
      if (!E164.test(destination)) throw new TypeError('destination must be E.164');
      const deliveryId = normalizeDeliveryId(payload.deliveryId);
      const portalUrl = assertHttpsUrl(payload.portalUrl, 'portalUrl', {allowQuery: true}).toString();
      const message = cleanString(payload.message, 'message', 1200);
      const body = `${message}\n${portalUrl}`;
      if (body.length > 1600) throw new TypeError('Twilio SMS body exceeds 1600 characters');

      const request = {
        to: destination,
        body,
        statusCallback: twilioStatusCallbackUrl(callbackBase, deliveryId),
      };
      if (senderFrom !== null) request.from = senderFrom;
      else request.messagingServiceSid = serviceSid;

      const result = await messages.create(request);
      const sid = optionalString(result?.sid, 'Twilio MessageSid', 64);
      if (!sid || !TWILIO_SID.test(sid)) throw new Error('Twilio create did not return a valid MessageSid');

      // A successful REST create only proves provider acceptance/queueing, not carrier delivery.
      // Keep the WFM delivery state conservative until an authenticated status callback confirms sent/delivered/read.
      return {status: 'unknown', providerMessageRef: sid};
    },
  });
}

export function createTwilioSmsReceiptVerifier({validateRequest, authToken, statusCallbackBaseUrl, deliveryId, expectedAccountSid} = {}) {
  // twilio-node exports validateRequest(authToken, twilioHeader, fullUrl, params).
  // Inject the official helper rather than reproducing Twilio's production signature algorithm here.
  if (typeof validateRequest !== 'function') throw new TypeError('Twilio validateRequest function is required');
  const token = cleanString(authToken, 'authToken', 200);
  if (token.length < 16) throw new TypeError('authToken is unexpectedly short');
  const id = normalizeDeliveryId(deliveryId);
  const callbackUrl = twilioStatusCallbackUrl(statusCallbackBaseUrl, id);
  const accountSid = cleanString(expectedAccountSid, 'expectedAccountSid', 64);
  if (!TWILIO_ACCOUNT_SID.test(accountSid)) throw new TypeError('expectedAccountSid must be a valid Twilio AccountSid');

  return Object.freeze({
    providerKey: AGENCY_TWILIO_SMS_PROVIDER_KEY,
    channel: 'sms',
    version: AGENCY_TWILIO_SMS_PROVIDER_VERSION,
    callbackUrl,
    async verify({rawBody, headers = {}, receivedAt} = {}) {
      const contentType = headerValue(headers, 'content-type').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/x-www-form-urlencoded') return {verified: false, event: null};
      const signature = headerValue(headers, 'x-twilio-signature').trim();
      if (!signature) return {verified: false, event: null};

      const params = parseFormBody(rawBody);
      let valid = false;
      try { valid = await validateRequest(token, signature, callbackUrl, params); } catch { return {verified: false, event: null}; }
      if (valid !== true) return {verified: false, event: null};

      if (params.AccountSid !== accountSid) return {verified: false, event: null};
      const messageSid = cleanString(params.MessageSid, 'MessageSid', 64);
      if (!TWILIO_SID.test(messageSid)) throw new TypeError('MessageSid is invalid');
      const messageStatus = cleanString(params.MessageStatus, 'MessageStatus', 40).toLowerCase();
      const errorCode = optionalString(params.ErrorCode, 'ErrorCode', 40);
      const eventAt = requireIso(receivedAt, 'receivedAt');

      return {
        verified: true,
        event: {
          providerKey: AGENCY_TWILIO_SMS_PROVIDER_KEY,
          providerEventId: providerEventId({messageSid, messageStatus, errorCode}),
          deliveryId: id,
          providerMessageRef: messageSid,
          attemptNumber: null,
          channel: 'sms',
          normalizedOutcome: normalizeTwilioStatus(messageStatus),
          eventAt,
        },
      };
    },
  });
}
