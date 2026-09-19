'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {providerReady,normalizeRecipients,sendResendReport,RESEND_ENDPOINT}=require('./vector-email-delivery.cjs');

test('provider readiness requires provider token and sender',()=>{
  assert.equal(providerReady({WFM_VECTOR_EMAIL_PROVIDER:'resend',WFM_VECTOR_RESEND_TOKEN:'12345678',WFM_VECTOR_EMAIL_FROM:'Vector <ops@example.com>'}),true);
  assert.equal(providerReady({WFM_VECTOR_EMAIL_PROVIDER:'resend'}),false);
});

test('recipient validation deduplicates safe addresses',()=>{
  assert.deepEqual(normalizeRecipients(['A@example.com','a@example.com']),['a@example.com']);
  assert.throws(()=>normalizeRecipients(['bad-address']),/valid recipients/);
});

test('Resend delivery uses fixed endpoint bearer auth and idempotency',async()=>{
  const seen={};
  const fetchImpl=async(url,options)=>{seen.url=String(url);seen.options=options;return {ok:true,status:200,async text(){return JSON.stringify({id:'email-123'});}};};
  const result=await sendResendReport({
    token:'re_test_secret',from:'Vector <vector@example.com>',to:'ops@example.com',
    subject:'Weekly operations',html:'<p>Report</p>',text:'Report',idempotencyKey:'vector-report/123',fetchImpl
  });
  assert.equal(seen.url,RESEND_ENDPOINT);
  assert.equal(seen.options.headers.Authorization,'Bearer re_test_secret');
  assert.equal(seen.options.headers['Idempotency-Key'],'vector-report/123');
  assert.equal(result.id,'email-123');
});

test('provider errors do not leak the token',async()=>{
  const fetchImpl=async()=>({ok:false,status:401,async text(){return JSON.stringify({message:'bad token'});}});
  await assert.rejects(()=>sendResendReport({
    token:'re_super_secret',from:'Vector <vector@example.com>',to:'ops@example.com',
    subject:'Report',text:'Report',idempotencyKey:'vector-report/fail',fetchImpl
  }),error=>{assert.equal(error.message.includes('re_super_secret'),false);assert.match(error.message,/HTTP 401/);return true;});
});
