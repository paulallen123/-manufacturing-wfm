import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createAgencySupplierDeliveryReceiptTrust,
  decideAgencySupplierDeliveryReceipt,
  reconcileAgencySupplierDeliveryReceipt,
  AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_DDL,
} from '../../src/frontier/agency-supplier-delivery-reconciliation.mjs';

const now = '2026-09-18T14:30:00.000Z';
const baseDelivery = () => ({
  tenantId:'tenant-a', idempotencyKey:'a'.repeat(64), deliveryId:'b'.repeat(64), siteId:'site-1',
  requestId:'req-1', agencyId:'agency-1', channel:'email', status:'unknown', attemptCount:1,
  providerMessageRef:'msg-1', createdAt:'2026-09-18T14:00:00.000Z', updatedAt:'2026-09-18T14:01:00.000Z',
});
const baseEvidence = (status='sent') => ({
  tenantId:'tenant-a', idempotencyKey:'a'.repeat(64), deliveryId:'b'.repeat(64), siteId:'site-1',
  requestId:'req-1', agencyId:'agency-1', channel:'email', status, providerMessageRef:'msg-1',
  observedAt:'2026-09-18T14:10:00.000Z', verificationDigest:crypto.createHash('sha256').update(`verified:${status}`).digest('hex'),
});

const trust = createAgencySupplierDeliveryReceiptTrust({
  async verifyCallback(raw){ return raw?.signature === 'valid' ? {verified:true,evidence:raw.evidence} : {verified:false}; },
  async verifyLookup(raw){ return raw?.providerSession === 'trusted' ? {verified:true,evidence:raw.evidence} : {verified:false}; },
});

let passed = 0;
async function test(name, fn){
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}:`, error); process.exitCode = 1; }
}

await test('forged plain evidence cannot authorise reconciliation', async()=>{
  const forged = Object.freeze({...baseEvidence('sent'), source:'provider_callback'});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence:forged, trust, now});
  assert.equal(decision.action,'reject'); assert.equal(decision.reason,'untrusted_receipt_evidence');
});

await test('verified callback resolves unknown to sent without resend authority', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:baseEvidence('sent')});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence, trust, now});
  assert.equal(decision.action,'apply'); assert.equal(decision.status,'sent');
  assert.match(decision.authorityBoundary,/no_supplier_resend/);
  assert.ok(!JSON.stringify(decision).includes('signature'));
});

await test('cloned verification object loses provenance', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:baseEvidence('sent')});
  const clone = structuredClone(evidence);
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence:clone, trust, now});
  assert.equal(decision.reason,'untrusted_receipt_evidence');
});

await test('verified provider lookup can resolve unknown to not_sent but does not trigger resend', async()=>{
  const evidence = await trust.verifyLookup({providerSession:'trusted', evidence:baseEvidence('not_sent')});
  let row = baseDelivery(); let writes = 0;
  const store = {
    async getDelivery(){ return structuredClone(row); },
    async applyReceipt({decision}){ writes += 1; row = {...row,status:decision.status,providerMessageRef:decision.providerMessageRef,updatedAt:now}; return structuredClone(row); },
  };
  const result = await reconcileAgencySupplierDeliveryReceipt({tenantId:row.tenantId,idempotencyKey:row.idempotencyKey,store,trust,evidence,now});
  assert.equal(result.reconciled,true); assert.equal(result.status,'not_sent'); assert.equal(result.retrySafe,true);
  assert.equal(result.resendTriggered,false); assert.equal(writes,1);
});

await test('duplicate verified receipt is idempotent and causes no second write', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:baseEvidence('sent')});
  let row = baseDelivery(); let writes = 0;
  const store = {
    async getDelivery(){ return structuredClone(row); },
    async applyReceipt({decision}){ writes += 1; row={...row,status:decision.status}; return structuredClone(row); },
  };
  const first = await reconcileAgencySupplierDeliveryReceipt({tenantId:row.tenantId,idempotencyKey:row.idempotencyKey,store,trust,evidence,now});
  const second = await reconcileAgencySupplierDeliveryReceipt({tenantId:row.tenantId,idempotencyKey:row.idempotencyKey,store,trust,evidence,now});
  assert.equal(first.reconciled,true); assert.equal(second.duplicateSuppressed,true); assert.equal(writes,1);
});

await test('conflicting terminal receipt never downgrades sent', async()=>{
  const evidence = await trust.verifyLookup({providerSession:'trusted', evidence:baseEvidence('not_sent')});
  const row={...baseDelivery(),status:'sent'}; let writes=0;
  const store={async getDelivery(){return row;}, async applyReceipt(){writes+=1; return null;}};
  const result=await reconcileAgencySupplierDeliveryReceipt({tenantId:row.tenantId,idempotencyKey:row.idempotencyKey,store,trust,evidence,now});
  assert.equal(result.reconciled,false); assert.equal(result.reviewRequired,true); assert.equal(result.reason,'conflicting_terminal_receipt'); assert.equal(writes,0);
});

await test('scope mismatch is rejected', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:{...baseEvidence('sent'),agencyId:'agency-other'}});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence, trust, now});
  assert.equal(decision.action,'reject'); assert.equal(decision.reason,'receipt_agencyId_mismatch');
});

await test('provider message reference mismatch is rejected', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:{...baseEvidence('sent'),providerMessageRef:'msg-other'}});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence, trust, now});
  assert.equal(decision.reason,'receipt_provider_message_ref_mismatch');
});

await test('receipt that predates dispatch is rejected', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:{...baseEvidence('sent'),observedAt:'2026-09-18T13:00:00.000Z'}});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence, trust, now});
  assert.equal(decision.reason,'receipt_predates_delivery');
});

await test('far-future receipt is rejected', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:{...baseEvidence('sent'),observedAt:'2026-09-18T15:30:00.000Z'}});
  const decision = decideAgencySupplierDeliveryReceipt({delivery:baseDelivery(), evidence, trust, now});
  assert.equal(decision.reason,'receipt_from_future');
});

await test('concurrent conflicting receipt fails closed after lost update race', async()=>{
  const evidence = await trust.verifyCallback({signature:'valid', evidence:baseEvidence('sent')});
  let reads=0;
  const store={
    async getDelivery(){ reads+=1; return reads===1?baseDelivery():{...baseDelivery(),status:'not_sent'}; },
    async applyReceipt(){ return null; },
  };
  const result=await reconcileAgencySupplierDeliveryReceipt({tenantId:'tenant-a',idempotencyKey:'a'.repeat(64),store,trust,evidence,now});
  assert.equal(result.reconciled,false); assert.equal(result.reviewRequired,true); assert.equal(result.reason,'concurrent_receipt_conflict');
});

await test('audit schema is append-only and does not require raw destination or callback body', async()=>{
  assert.match(AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_DDL,/BEFORE UPDATE OR DELETE/);
  assert.ok(!/destination/i.test(AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_DDL));
  assert.ok(!/raw_body|secret|token/i.test(AGENCY_SUPPLIER_DELIVERY_RECONCILIATION_DDL));
});

if (process.exitCode) process.exit(process.exitCode);
console.log(`PASS ${passed}/12 agency supplier delivery reconciliation checks`);
