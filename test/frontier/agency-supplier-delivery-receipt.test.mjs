import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL,
  createHmacSha256ReceiptVerifier,
  createPostgresAgencySupplierDeliveryReceiptStore,
  reconcileAgencySupplierDeliveryReceipt,
} from '../../src/frontier/agency-supplier-delivery-receipt.mjs';

const DELIVERY_ID='a'.repeat(64);
const SECRET='0123456789abcdef0123456789abcdef';
const receivedAt='2026-09-18T14:40:00.000Z';

function signed(rawBody){return crypto.createHmac('sha256',SECRET).update(Buffer.from(rawBody)).digest('hex');}
function verifier(){return createHmacSha256ReceiptVerifier({providerKey:'mail-test',secret:SECRET,parseEvent:async({rawBody})=>JSON.parse(rawBody)});}
function event(overrides={}){return {providerEventId:'evt-1',deliveryId:DELIVERY_ID,providerMessageRef:'provider-1',attemptNumber:1,channel:'email',normalizedOutcome:'confirmed_sent',eventAt:'2026-09-18T14:39:30.000Z',...overrides};}
function raw(overrides={}){return JSON.stringify(event(overrides));}
function headers(body){return {'x-wfm-signature-sha256':signed(body)};}

function memoryStore(initial={}){
  const deliveries=new Map([[`T1:${DELIVERY_ID}`,{tenantId:'T1',deliveryId:DELIVERY_ID,siteId:'S1',requestId:'R1',agencyId:'A1',channel:'email',status:'unknown',attemptCount:1,providerMessageRef:null,createdAt:'2026-09-18T14:30:00.000Z',...initial}]]);
  const events=new Set();
  const records=[];
  return {
    deliveries,events,records,
    async reconcileOnce(record){
      const row=deliveries.get(`${record.tenantId}:${record.deliveryId}`);
      if(!row)return {result:'delivery_not_found'};
      if(row.channel!==record.channel)return {result:'channel_mismatch',priorStatus:row.status,status:row.status,...row};
      if(row.providerMessageRef&&record.providerMessageRef&&row.providerMessageRef!==record.providerMessageRef)return {result:'provider_message_ref_mismatch',priorStatus:row.status,status:row.status,...row};
      if(record.normalizedOutcome==='definitively_not_sent'&&record.attemptNumber!==row.attemptCount)return {result:'attempt_mismatch',priorStatus:row.status,status:row.status,...row};
      if(Date.parse(record.eventAt)<Date.parse(row.createdAt)-5*60*1000)return {result:'event_before_delivery',priorStatus:row.status,status:row.status,...row};
      const eventKey=`${record.tenantId}:${record.providerKey}:${record.providerEventId}`;
      if(events.has(eventKey))return {result:'duplicate_event',priorStatus:row.status,status:row.status,...row};
      events.add(eventKey);records.push(structuredClone(record));
      const priorStatus=row.status;
      if(record.normalizedOutcome==='confirmed_sent'&&['dispatching','unknown','not_sent'].includes(row.status))row.status='sent';
      else if(record.normalizedOutcome==='definitively_not_sent'&&row.status==='unknown')row.status='not_sent';
      if(!row.providerMessageRef&&record.providerMessageRef)row.providerMessageRef=record.providerMessageRef;
      return {result:'recorded',priorStatus,status:row.status,...row};
    },
  };
}

async function reconcile({body=raw(), hdrs=null, store=memoryStore(), v=verifier(), tenantId='T1', at=receivedAt}={}){
  return reconcileAgencySupplierDeliveryReceipt({tenantId,rawBody:body,headers:hdrs??headers(body),verifier:v,receiptStore:store,receivedAt:at});
}

test('authenticated confirmed_sent receipt resolves an unknown outcome without resending',async()=>{const store=memoryStore();const result=await reconcile({store});assert.equal(result.reconciled,true);assert.equal(result.status,'sent');assert.equal(result.priorStatus,'unknown');assert.equal(result.transitionApplied,true);assert.equal(store.deliveries.get(`T1:${DELIVERY_ID}`).status,'sent');assert.equal(store.records.length,1);});

test('HMAC verification fails closed for body tampering and bad signatures before store mutation',async()=>{const store=memoryStore();const body=raw();const tampered=body.replace('confirmed_sent','definitively_not_sent');const bad=await reconcile({body:tampered,hdrs:headers(body),store});assert.equal(bad.reconciled,false);assert.equal(bad.reason,'receipt_authentication_failed');assert.equal(store.records.length,0);const malformed=await reconcile({body,hdrs:{'x-wfm-signature-sha256':'00'},store});assert.equal(malformed.reason,'receipt_authentication_failed');assert.equal(store.records.length,0);const parsed=JSON.parse(body);const parsedResult=await verifier().verify({rawBody:parsed,headers:headers(body)});assert.equal(parsedResult.verified,false);});

test('missing verifier/store and verifier exceptions fail closed',async()=>{const body=raw();let r=await reconcileAgencySupplierDeliveryReceipt({tenantId:'T1',rawBody:body,headers:headers(body),receiptStore:memoryStore(),receivedAt});assert.equal(r.reason,'receipt_verifier_unavailable');r=await reconcileAgencySupplierDeliveryReceipt({tenantId:'T1',rawBody:body,headers:headers(body),verifier:verifier(),receivedAt});assert.equal(r.reason,'receipt_store_unavailable');r=await reconcile({body,v:{providerKey:'mail-test',verify:async()=>{throw new Error('bad verifier')}}});assert.equal(r.reason,'receipt_verification_failed');});

test('receipt scope mismatches and impossible event time fail before reconciliation',async()=>{let body=raw({channel:'sms'}),store=memoryStore();let r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reason,'receipt_channel_mismatch');assert.equal(store.records.length,0);body=raw({eventAt:'2026-09-18T14:46:00.000Z'});store=memoryStore();r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reconciled,false);assert.match(r.reason,/future/);assert.equal(store.records.length,0);body=raw({eventAt:'2026-09-18T14:20:00.000Z'});store=memoryStore();r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reason,'receipt_event_before_delivery');assert.equal(store.records.length,0);});

test('provider-message correlation mismatch fails closed',async()=>{const store=memoryStore({providerMessageRef:'provider-original'});const body=raw({providerMessageRef:'provider-other'});const r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reconciled,false);assert.equal(r.reason,'receipt_provider_message_ref_mismatch');assert.equal(store.records.length,0);assert.equal(store.deliveries.get(`T1:${DELIVERY_ID}`).status,'unknown');});

test('definitively_not_sent can make an unknown outcome retry-safe, but generic delivery_failed cannot',async()=>{let store=memoryStore();let body=raw({normalizedOutcome:'definitively_not_sent'});let r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.status,'not_sent');assert.equal(r.transitionApplied,true);store=memoryStore();body=raw({normalizedOutcome:'delivery_failed'});r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.status,'unknown');assert.equal(r.transitionApplied,false);});

test('positive provider proof supersedes a prior not_sent state to prevent a later duplicate retry',async()=>{const store=memoryStore({status:'not_sent'});const r=await reconcile({store});assert.equal(r.status,'sent');assert.equal(r.transitionApplied,true);});

test('negative receipt cannot make an actively dispatching send retryable',async()=>{const store=memoryStore({status:'dispatching'});const body=raw({normalizedOutcome:'definitively_not_sent'});const r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reconciled,true);assert.equal(r.status,'dispatching');assert.equal(r.transitionApplied,false);});

test('negative receipt for an earlier attempt cannot unlock retry for a newer unknown attempt',async()=>{const store=memoryStore({status:'unknown',attemptCount:2});const body=raw({normalizedOutcome:'definitively_not_sent',attemptNumber:1});const r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reconciled,false);assert.equal(r.reason,'receipt_attempt_mismatch');assert.equal(store.records.length,0);assert.equal(store.deliveries.get(`T1:${DELIVERY_ID}`).status,'unknown');});

test('a negative receipt never downgrades an already sent delivery into a retryable state',async()=>{const store=memoryStore({status:'sent',providerMessageRef:'provider-1'});const body=raw({normalizedOutcome:'definitively_not_sent'});const r=await reconcile({body,hdrs:headers(body),store});assert.equal(r.reconciled,true);assert.equal(r.status,'sent');assert.equal(r.transitionApplied,false);});

test('1,000 concurrent copies of the same authenticated provider event are idempotent',async()=>{const store=memoryStore();const body=raw();const results=await Promise.all(Array.from({length:1000},()=>reconcile({body,hdrs:headers(body),store})));assert.equal(store.records.length,1);assert.equal(store.events.size,1);assert.equal(results.filter(x=>x.reconciled).length,1000);assert.equal(results.filter(x=>x.reason===null).length,1);assert.equal(results.filter(x=>x.reason==='duplicate_event').length,999);assert.equal(store.deliveries.get(`T1:${DELIVERY_ID}`).status,'sent');});

test('receipt audit keeps raw webhook, routing address, portal link and worker data out of persistent evidence',async()=>{const store=memoryStore();const sensitive='{"providerEventId":"evt-private","deliveryId":"'+DELIVERY_ID+'","providerMessageRef":"provider-1","channel":"email","normalizedOutcome":"confirmed_sent","eventAt":"2026-09-18T14:39:30Z","destination":"worker@example.test","portalUrl":"https://wfm.example/?token=secret","workerName":"Jane Person"}';const r=await reconcile({body:sensitive,hdrs:headers(sensitive),store});const audit=JSON.stringify(r);const persisted=JSON.stringify(store.records);assert.ok(!audit.includes('worker@example.test'));assert.ok(!audit.includes('token=secret'));assert.ok(!audit.includes('Jane Person'));assert.ok(!persisted.includes('worker@example.test'));assert.ok(!persisted.includes('token=secret'));assert.ok(!persisted.includes('Jane Person'));assert.equal(r.containsRawReceipt,false);assert.equal(r.eventFingerprint.length,16);});

test('PostgreSQL contract atomically deduplicates provider events and only permits conservative delivery-state transitions',async()=>{assert.match(AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL,/PRIMARY KEY \(tenant_id, provider_key, provider_event_id\)/);assert.match(AGENCY_SUPPLIER_DELIVERY_RECEIPT_DDL,/FOREIGN KEY \(tenant_id, delivery_id\)/);const calls=[];const store=createPostgresAgencySupplierDeliveryReceiptStore({query:async(sql,values)=>{calls.push({sql,values});return {rows:[{result:'recorded',prior_status:'unknown',status:'sent',attempt_count:1,provider_message_ref:'provider-1',site_id:'S1',request_id:'R1',agency_id:'A1',channel:'email'}]};}});const result=await store.reconcileOnce({tenantId:'T1',providerKey:'mail-test',providerEventId:'evt-1',deliveryId:DELIVERY_ID,providerMessageRef:'provider-1',channel:'email',normalizedOutcome:'confirmed_sent',eventAt:'2026-09-18T14:39:30Z',receivedAt,eventFingerprint:'0123456789abcdef'});assert.equal(result.status,'sent');assert.match(calls[0].sql,/ON CONFLICT \(tenant_id, provider_key, provider_event_id\) DO NOTHING/);assert.match(calls[0].sql,/confirmed_sent/);assert.match(calls[0].sql,/definitively_not_sent/);assert.match(calls[0].sql,/provider_message_ref IS NULL/);assert.match(calls[0].sql,/FOR UPDATE/);});

test('10,000-way replay stress still records one receipt event and one state transition',async()=>{const store=memoryStore();const body=raw();const hdrs=headers(body);const results=await Promise.all(Array.from({length:10000},()=>reconcile({body,hdrs,store})));assert.equal(store.records.length,1);assert.equal(results.filter(x=>x.reason===null&&x.transitionApplied).length,1);assert.equal(results.filter(x=>x.reason==='duplicate_event').length,9999);assert.equal(results.filter(x=>!x.reconciled).length,0);});
