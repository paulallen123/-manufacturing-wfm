import test from 'node:test';
import assert from 'node:assert/strict';
import {assessMaintenanceMeterWindow} from './maintenance-meter-window.mjs';

const scope={tenantId:'tenant-synthetic',siteId:'site-a',assetId:'press-4',meterId:'run-hours',meterKind:'cumulative',sourceSystem:'cmms',unit:'h'};
const readings=[
  {...scope,recordId:'r1',revision:'1',observedAt:'2026-10-13T09:00:00Z',ingestedAt:'2026-10-13T09:10:00Z',value:100},
  {...scope,recordId:'r2',revision:'2',observedAt:'2026-10-13T11:00:00Z',ingestedAt:'2026-10-13T11:15:00Z',value:104}
];
const input={...scope,readings,asOf:'2026-10-13T12:00:00Z',maxAgeMs:2*60*60*1000};
const check=changes=>assessMaintenanceMeterWindow({...input,...changes});

test('reports an ordered source-bound cumulative delta without decision authority',()=>{
  const result=check({readings:[readings[1],readings[0]]});
  assert.equal(result.deltaCandidate,4);
  assert.equal(result.first.recordId,'r1');
  assert.equal(result.last.recordId,'r2');
  assert.equal(result.admissionStatus,'blocked');
  assert.equal(result.decisionAllowed,false);
  assert.equal(result.writeBackAllowed,false);
  assert.equal(result.blockedReason,'trusted-meter-source-admission-unavailable');
});

test('cross-tenant, site, asset, meter and unit readings never combine',()=>{
  for(const field of ['tenantId','siteId','assetId','meterId','meterKind','sourceSystem','unit']){
    const altered={...readings[1],[field]:'foreign'};
    assert.throws(()=>check({readings:[readings[0],altered]}),/differs from window scope/,field);
  }
});

test('a condition gauge cannot be misrepresented as cumulative meter consumption',()=>{
  assert.throws(()=>check({meterKind:'gauge'}),/cumulative meter/);
});

test('duplicate identity or source time and declining cumulative values require source review',()=>{
  assert.throws(()=>check({readings:[readings[0],{...readings[1],recordId:'r1'}]}),/duplicate source record/);
  assert.throws(()=>check({readings:[readings[0],{...readings[1],observedAt:readings[0].observedAt}]}),/conflicting meter observations/);
  assert.throws(()=>check({readings:[readings[0],{...readings[1],value:99}]}),/reset or replacement evidence/);
});

test('stale, future and impossible source times cannot become current condition evidence',()=>{
  assert.throws(()=>check({asOf:'2026-10-14T12:00:00Z'}),/stale/);
  assert.throws(()=>check({asOf:'2026-10-13T10:00:00Z'}),/future meter observation/);
  assert.throws(()=>check({readings:[readings[0],{...readings[1],observedAt:'2026-02-30T11:00:00Z'}]}),/ISO-8601 timestamp/);
});

test('ingestion time must be explicit and cannot precede the source observation',()=>{
  assert.throws(()=>check({readings:[readings[0],{...readings[1],ingestedAt:undefined}]}),/ingestedAt is required/);
  assert.throws(()=>check({readings:[readings[0],{...readings[1],ingestedAt:'2026-10-13T10:00:00Z'}]}),/ingestion before observation/);
});

test('malformed readings and age limits cannot create a meter delta',()=>{
  assert.throws(()=>check({readings:[readings[0],{...readings[1],value:Infinity}]}),/finite number/);
  assert.throws(()=>check({readings:[readings[0],{...readings[1],value:'104'}]}),/finite number/);
  assert.throws(()=>check({maxAgeMs:-1}),/positive and finite/);
});
