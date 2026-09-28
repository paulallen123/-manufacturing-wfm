import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPostgresAgencySupplierDeliveryStore,
  prepareAgencySupplierDelivery,
} from '../../src/frontier/agency-supplier-delivery.mjs';

function record() {
  const prepared = prepareAgencySupplierDelivery({
    tenantId:'T1', siteId:'S1', requestId:'R1', agencyId:'A1', channel:'email', destination:'ops@agency.example',
    portalUrl:'https://wfm.example/agency/respond?token=claim-test', responseDeadline:'2026-09-20T18:00:00Z', deliveryRevision:1,
    requestPack:{requestId:'R1', hirer:{name:'Factory Ltd'}, assignment:{roleName:'Line Operator', location:'Plant 1', startAt:'2026-09-21T06:00:00Z', endAt:'2026-09-21T14:00:00Z', count:4, fairWorkAgencyGangmasterLicenceRequired:false}},
    supplierEligibility:{version:'agency-supplier-compliance-v0.1.0', agencyId:'A1', eligible:true, failures:[], evidence:{licenceRequired:false}},
  });
  return {
    tenantId:prepared.delivery.tenantId,
    idempotencyKey:prepared.delivery.idempotencyKey,
    deliveryId:prepared.delivery.deliveryId,
    siteId:prepared.delivery.siteId,
    requestId:prepared.delivery.requestId,
    agencyId:prepared.delivery.agencyId,
    channel:prepared.delivery.channel,
    deliveryRevision:prepared.delivery.deliveryRevision,
    destinationFingerprint:prepared.audit.destinationFingerprint,
    portalFingerprint:prepared.audit.portalFingerprint,
    at:'2026-09-19T02:45:00Z',
  };
}

test('conflicting insert uses a new-statement snapshot to read the committed existing delivery', async () => {
  const calls = [];
  const responses = [
    { rows:[] },
    { rows:[{ status:'dispatching', attempt_count:1, claimed:false }] },
  ];
  const store = createPostgresAgencySupplierDeliveryStore({
    query:async (sql, values) => {
      calls.push({ sql, values });
      return responses.shift();
    },
  });

  const input = record();
  const result = await store.claimOnce(input);
  assert.deepEqual(result, { claimed:false, status:'dispatching', attemptCount:1 });
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /^\s*INSERT INTO wfm_agency_supplier_deliveries/);
  assert.match(calls[0].sql, /ON CONFLICT \(tenant_id, idempotency_key\) DO NOTHING/);
  assert.doesNotMatch(calls[0].sql, /UNION ALL/);
  assert.match(calls[1].sql, /^\s*SELECT status, attempt_count, false AS claimed/);
  assert.deepEqual(calls[1].values, [input.tenantId, input.idempotencyKey]);
});

test('claimOnce still fails closed if neither insert nor committed-row read returns a delivery', async () => {
  const store = createPostgresAgencySupplierDeliveryStore({ query:async () => ({ rows:[] }) });
  await assert.rejects(() => store.claimOnce(record()), /unexpected_delivery_store_result/);
});
