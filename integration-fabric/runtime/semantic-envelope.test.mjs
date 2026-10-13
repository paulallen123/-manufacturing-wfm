import test from 'node:test';
import assert from 'node:assert/strict';
import {createSemanticEnvelope} from './semantic-envelope.mjs';

test('preserves source-local timestamp and timezone while deriving comparable ingestion latency',()=>{
  const e=createSemanticEnvelope({
    sourceSystem:'evocon-oee',sourceRecordId:'shift-1',sourceEntityType:'production-output',
    sourceObservedAt:'2026-10-25T01:30:00+01:00',ingestedAt:'2026-10-25T01:35:00+00:00',
    sourceTimezone:'Europe/London',locale:'en-GB',authority:'operational-evidence',confidence:0.95
  });
  assert.equal(e.source.observedAt,'2026-10-25T01:30:00+01:00');
  assert.equal(e.source.timezone,'Europe/London');
  assert.equal(e.ingestion.lateByMs,3900000);
  assert.equal(e.provenance.confidence,0.95);
});

test('requires explicit unit conversion evidence instead of silently equating different units',()=>{
  assert.throws(()=>createSemanticEnvelope({
    sourceSystem:'mes',sourceRecordId:'q1',sourceObservedAt:'2026-09-20T12:00:00Z',sourceUnit:'lb',canonicalUnit:'kg'
  }),/unitConversion is required/);
  const e=createSemanticEnvelope({
    sourceSystem:'mes',sourceRecordId:'q1',sourceObservedAt:'2026-09-20T12:00:00Z',sourceUnit:'lb',canonicalUnit:'kg',
    unitConversion:{method:'UCUM-reviewed-factor',factor:0.45359237}
  });
  assert.equal(e.normalization.unit.canonicalUnit,'kg');
});

test('requires dated FX evidence for cross-currency normalisation',()=>{
  assert.throws(()=>createSemanticEnvelope({
    sourceSystem:'erp',sourceRecordId:'cost-1',sourceObservedAt:'2026-09-20T12:00:00Z',sourceCurrency:'EUR',canonicalCurrency:'GBP'
  }),/fx conversion evidence is required/);
  const e=createSemanticEnvelope({
    sourceSystem:'erp',sourceRecordId:'cost-1',sourceObservedAt:'2026-09-20T12:00:00Z',sourceCurrency:'EUR',canonicalCurrency:'GBP',
    fx:{method:'customer-approved-daily-rate',rate:0.86,rateAsOf:'2026-09-20T00:00:00Z',source:'erp-finance-rate-table'}
  });
  assert.equal(e.normalization.currency.rate,0.86);
  assert.equal(e.normalization.currency.source,'erp-finance-rate-table');
});

test('marks late/stale recovered source data without rewriting source event time',()=>{
  const e=createSemanticEnvelope({
    sourceSystem:'oee',sourceRecordId:'recovered-1',sourceObservedAt:'2026-09-20T08:00:00Z',ingestedAt:'2026-09-20T10:00:00Z',
    staleAfterMs:30*60*1000,authority:'operational-evidence'
  });
  assert.equal(e.source.observedAt,'2026-09-20T08:00:00Z');
  assert.equal(e.ingestion.stale,true);
  assert.equal(e.ingestion.lateByMs,2*60*60*1000);
});

test('preserves recommendation-action-outcome windows and competing changes for causal analysis',()=>{
  const e=createSemanticEnvelope({
    sourceSystem:'wfm-recommendation-engine',sourceRecordId:'outcome-77',sourceObservedAt:'2026-09-20T14:00:00Z',authority:'derived',
    intervention:{
      recommendationId:'rec-77',recommendationAt:'2026-09-20T09:00:00Z',actionId:'redeploy-12',actionEffectiveAt:'2026-09-20T09:30:00Z',
      baselineStart:'2026-09-20T06:00:00Z',baselineEnd:'2026-09-20T09:00:00Z',outcomeStart:'2026-09-20T09:30:00Z',outcomeEnd:'2026-09-20T13:30:00Z',
      competingChanges:['maintenance-completed:asset-4','product-changeover:sku-8']
    }
  });
  assert.equal(e.intervention.recommendationId,'rec-77');
  assert.equal(e.intervention.competingChanges.length,2);
});

test('rejects impossible and ambiguous source observation timestamps',()=>{
  for(const sourceObservedAt of ['2026-02-30T12:00:00Z','2026-13-01T12:00:00Z','2026-09-20T24:00:00Z','2026-09-20T12:00:00+24:00','2026-09-20','2026-09-20T12:00:00',1726833600000]){
    assert.throws(()=>createSemanticEnvelope({sourceSystem:'mes',sourceRecordId:'bad-time',sourceObservedAt}),/ISO-8601 timestamp/,String(sourceObservedAt));
  }
});

test('accepts a real leap day with an explicit source-local offset',()=>{
  const e=createSemanticEnvelope({sourceSystem:'mes',sourceRecordId:'leap-day',sourceObservedAt:'2024-02-29T23:59:59.123+01:00'});
  assert.equal(e.source.observedAt,'2024-02-29T23:59:59.123+01:00');
});

test('applies the same calendar validation to ingestion, effective, FX and intervention times',()=>{
  const base={sourceSystem:'mes',sourceRecordId:'event-1',sourceObservedAt:'2026-09-20T12:00:00Z'};
  for(const input of [
    {ingestedAt:'2026-02-30T12:00:00Z'},
    {effectiveFrom:'2026-02-30T12:00:00Z'},
    {sourceCurrency:'EUR',canonicalCurrency:'GBP',fx:{method:'approved',rate:0.9,rateAsOf:'2026-02-30T00:00:00Z',source:'finance'}},
    {intervention:{recommendationId:'rec-1',recommendationAt:'2026-02-30T12:00:00Z',actionEffectiveAt:'2026-09-20T12:00:00Z',baselineStart:'2026-09-19T12:00:00Z',baselineEnd:'2026-09-19T13:00:00Z',outcomeStart:'2026-09-20T12:00:00Z',outcomeEnd:'2026-09-20T13:00:00Z'}}
  ]) assert.throws(()=>createSemanticEnvelope({...base,...input}),/ISO-8601 timestamp/);
});
