import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AGENCY_TWILIO_SMS_PROVIDER_KEY,
  createTwilioSmsSender,
  createTwilioSmsReceiptVerifier,
  twilioStatusCallbackUrl,
} from '../../src/frontier/agency-provider-twilio-sms.mjs';

const DELIVERY_ID = 'a'.repeat(64);
const ACCOUNT_SID = `AC${'1'.repeat(32)}`;
const MESSAGE_SID = `SM${'2'.repeat(32)}`;
const AUTH_TOKEN = 'test-auth-token-32-characters-long!';
const CALLBACK_BASE = 'https://wfm.example/providers/twilio/sms-status';
const RECEIVED_AT = '2026-09-18T17:20:00.000Z';

function headers(signature = 'valid') {
  return {'content-type':'application/x-www-form-urlencoded; charset=utf-8','x-twilio-signature':signature};
}

function form(overrides = {}) {
  return new URLSearchParams({
    AccountSid: ACCOUNT_SID,
    MessageSid: MESSAGE_SID,
    MessageStatus: 'delivered',
    ErrorCode: '',
    ...overrides,
  }).toString();
}

function fixtureTwilioSignature(authToken, url, params) {
  const suffix = Object.keys(params).sort().map(key => `${key}${params[key]}`).join('');
  return crypto.createHmac('sha1', authToken).update(`${url}${suffix}`).digest('base64');
}

function fixtureValidateRequest(authToken, signature, url, params) {
  const expected = Buffer.from(fixtureTwilioSignature(authToken, url, params));
  const actual = Buffer.from(String(signature));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function acceptingValidateRequest(onValidate = null) {
  return async (authToken, signature, url, params) => {
    onValidate?.(authToken, signature, url, params);
    return signature === 'valid';
  };
}

function makeVerifier(overrides = {}) {
  return createTwilioSmsReceiptVerifier({
    validateRequest:acceptingValidateRequest(),
    authToken:AUTH_TOKEN,
    statusCallbackBaseUrl:CALLBACK_BASE,
    deliveryId:DELIVERY_ID,
    expectedAccountSid:ACCOUNT_SID,
    ...overrides,
  });
}

test('status callback URL is canonical HTTPS and delivery-scoped', () => {
  const url = twilioStatusCallbackUrl(`${CALLBACK_BASE}/`, DELIVERY_ID.toUpperCase());
  assert.equal(url, `${CALLBACK_BASE}/${DELIVERY_ID}`);
  assert.throws(() => twilioStatusCallbackUrl('http://wfm.example/status', DELIVERY_ID), /https/);
  assert.throws(() => twilioStatusCallbackUrl(`${CALLBACK_BASE}?x=1`, DELIVERY_ID), /query string/);
  assert.throws(() => twilioStatusCallbackUrl(CALLBACK_BASE, 'not-a-digest'), /64 character hex/);
});

test('sender uses the Twilio SDK seam and treats provider acceptance as unknown until callback proof', async () => {
  const calls = [];
  const sender = createTwilioSmsSender({
    messages:{create:async input => { calls.push(input); return {sid:MESSAGE_SID,status:'queued'}; }},
    statusCallbackBaseUrl:CALLBACK_BASE,
    messagingServiceSid:`MG${'3'.repeat(32)}`,
  });
  const result = await sender.send({
    channel:'sms',destination:'+447700900123',deliveryId:DELIVERY_ID,
    message:'4 line operators requested. Respond using the secure request link.',
    portalUrl:'https://wfm.example/agency/respond?token=secret-value',
  });
  assert.deepEqual(result,{status:'unknown',providerMessageRef:MESSAGE_SID});
  assert.equal(calls.length,1);
  assert.equal(calls[0].to,'+447700900123');
  assert.equal(calls[0].statusCallback,`${CALLBACK_BASE}/${DELIVERY_ID}`);
  assert.match(calls[0].body,/secure request link/);
  assert.match(calls[0].body,/https:\/\/wfm\.example\/agency\/respond\?token=secret-value/);
  assert.equal(calls[0].messagingServiceSid,`MG${'3'.repeat(32)}`);
  assert.ok(!JSON.stringify(result).includes('+447700900123'));
  assert.ok(!JSON.stringify(result).includes('secret-value'));
});

test('sender fails closed for wrong channel, unsafe destination, callback URL, oversized content or malformed provider response', async () => {
  const create = async () => ({sid:MESSAGE_SID});
  const sender = createTwilioSmsSender({messages:{create},statusCallbackBaseUrl:CALLBACK_BASE,from:'+447700900999'});
  await assert.rejects(() => sender.send({channel:'email',destination:'+447700900123',deliveryId:DELIVERY_ID,message:'x',portalUrl:'https://wfm.example/r'}), /only supports sms/);
  await assert.rejects(() => sender.send({channel:'sms',destination:'07700900123',deliveryId:DELIVERY_ID,message:'x',portalUrl:'https://wfm.example/r'}), /E\.164/);
  await assert.rejects(() => sender.send({channel:'sms',destination:'+447700900123',deliveryId:DELIVERY_ID,message:'x',portalUrl:'http://wfm.example/r'}), /https/);
  await assert.rejects(() => sender.send({channel:'sms',destination:'+447700900123',deliveryId:DELIVERY_ID,message:'x'.repeat(1201),portalUrl:'https://wfm.example/r'}), /message is too long/);
  const malformed = createTwilioSmsSender({messages:{create:async()=>({sid:'bad'})},statusCallbackBaseUrl:CALLBACK_BASE,from:'+447700900999'});
  await assert.rejects(() => malformed.send({channel:'sms',destination:'+447700900123',deliveryId:DELIVERY_ID,message:'x',portalUrl:'https://wfm.example/r'}), /valid MessageSid/);
});

test('receipt verifier calls the official twilio-node validateRequest seam with token, signature, full URL and all form fields', async () => {
  let observed;
  const verifier = makeVerifier({validateRequest:acceptingValidateRequest((authToken,signature,url,params)=>{observed={authToken,signature,url,params};})});
  const raw = form({FutureTwilioField:'preserved-for-signature'});
  const result = await verifier.verify({rawBody:raw,headers:headers(),receivedAt:RECEIVED_AT});
  assert.equal(result.verified,true);
  assert.equal(observed.authToken,AUTH_TOKEN);
  assert.equal(observed.url,`${CALLBACK_BASE}/${DELIVERY_ID}`);
  assert.equal(observed.signature,'valid');
  assert.equal(observed.params.FutureTwilioField,'preserved-for-signature');
  assert.equal(result.event.providerKey,AGENCY_TWILIO_SMS_PROVIDER_KEY);
  assert.equal(result.event.providerMessageRef,MESSAGE_SID);
  assert.equal(result.event.deliveryId,DELIVERY_ID);
  assert.equal(result.event.normalizedOutcome,'confirmed_sent');
  assert.equal(result.event.eventAt,RECEIVED_AT);
});

test('documented Twilio HMAC-SHA1 fixture proves canonical URL and every form field are signature-bound', async () => {
  const callbackUrl = `${CALLBACK_BASE}/${DELIVERY_ID}`;
  const raw = form({FutureTwilioField:'signed-too'});
  const params = Object.fromEntries(new URLSearchParams(raw));
  const signature = fixtureTwilioSignature(AUTH_TOKEN, callbackUrl, params);
  const verifier = makeVerifier({validateRequest:fixtureValidateRequest});
  const valid = await verifier.verify({rawBody:raw,headers:headers(signature),receivedAt:RECEIVED_AT});
  assert.equal(valid.verified,true);
  const tampered = raw.replace('delivered','failed');
  const invalid = await verifier.verify({rawBody:tampered,headers:headers(signature),receivedAt:RECEIVED_AT});
  assert.equal(invalid.verified,false);
});

test('invalid signature, wrong account or wrong content type fail before a trusted event exists', async () => {
  const verifier = makeVerifier();
  assert.deepEqual(await verifier.verify({rawBody:form(),headers:headers('bad'),receivedAt:RECEIVED_AT}),{verified:false,event:null});
  assert.deepEqual(await verifier.verify({rawBody:form({AccountSid:`AC${'9'.repeat(32)}`}),headers:headers(),receivedAt:RECEIVED_AT}),{verified:false,event:null});
  assert.deepEqual(await verifier.verify({rawBody:form(),headers:{...headers(),'content-type':'application/json'},receivedAt:RECEIVED_AT}),{verified:false,event:null});
});

test('duplicate form keys are rejected instead of being ambiguously canonicalized for signature validation', async () => {
  let validations=0;
  const verifier = makeVerifier({validateRequest:acceptingValidateRequest(()=>validations++)});
  await assert.rejects(() => verifier.verify({rawBody:`${form()}&MessageStatus=failed`,headers:headers(),receivedAt:RECEIVED_AT}),/duplicate parameters/);
  assert.equal(validations,0);
});

test('negative Twilio terminal statuses never create automatic retry authority', async () => {
  const verifier = makeVerifier();
  for (const status of ['failed','undelivered','canceled']) {
    const result = await verifier.verify({rawBody:form({MessageStatus:status,ErrorCode:'30003'}),headers:headers(),receivedAt:RECEIVED_AT});
    assert.equal(result.verified,true);
    assert.equal(result.event.normalizedOutcome,'delivery_failed');
    assert.equal(result.event.attemptNumber,null);
  }
});

test('non-terminal and future signed statuses remain informational rather than silently gaining state-transition meaning', async () => {
  const verifier = makeVerifier();
  for (const status of ['accepted','queued','sending','brand_new_future_status']) {
    const result = await verifier.verify({rawBody:form({MessageStatus:status}),headers:headers(),receivedAt:RECEIVED_AT});
    assert.equal(result.event.normalizedOutcome,'informational');
  }
});

test('provider event id is deterministic for callback replay and changes when state changes', async () => {
  const verifier = makeVerifier();
  const first = await verifier.verify({rawBody:form({MessageStatus:'sent'}),headers:headers(),receivedAt:RECEIVED_AT});
  const replay = await verifier.verify({rawBody:form({MessageStatus:'sent'}),headers:headers(),receivedAt:'2026-09-18T17:21:00Z'});
  const delivered = await verifier.verify({rawBody:form({MessageStatus:'delivered'}),headers:headers(),receivedAt:'2026-09-18T17:22:00Z'});
  assert.equal(first.event.providerEventId,replay.event.providerEventId);
  assert.notEqual(first.event.providerEventId,delivered.event.providerEventId);
});

test('10,000 callback replays converge to one deterministic provider event identity', async () => {
  const verifier = makeVerifier();
  const results = await Promise.all(Array.from({length:10000},()=>verifier.verify({rawBody:form({MessageStatus:'delivered'}),headers:headers(),receivedAt:RECEIVED_AT})));
  assert.equal(new Set(results.map(x=>x.event.providerEventId)).size,1);
  assert.ok(results.every(x=>x.verified && x.event.normalizedOutcome==='confirmed_sent'));
});
