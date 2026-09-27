import test from 'node:test';
import assert from 'node:assert/strict';
import {createShiftTimeAuthority} from './shift-time-authority.mjs';

const policy=(overrides={})=>({
  provider:'planday',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-planday-1',
  sourcePortalId:'portal-100',
  siteId:'leeds-factory',
  departmentId:'department-assembly',
  apiOrigin:'https://openapi.planday.com',
  apiVersion:'schedule-v1',
  resource:'shifts',
  schemaFingerprint:'sha256:planday-shift-v1',
  queryFingerprint:'sha256:leeds-assembly-shifts-v1',
  timeZone:'Europe/London',
  maxWindowSeconds:604800,
  maxClockSkewSeconds:60,
  maxShiftSeconds:86400,
  maxRecords:100,
  ...overrides
});

const record=(overrides={})=>({
  shiftId:'shift-100',
  employeeId:'employee-100',
  localStart:'2026-09-27T08:00:00',
  localEnd:'2026-09-27T16:00:00',
  utcStart:'2026-09-27T07:00:00Z',
  utcEnd:'2026-09-27T15:00:00Z',
  startOffsetMinutes:60,
  endOffsetMinutes:60,
  sourceVersion:'2026-09-27T00:10:00Z#1',
  payloadDigest:'sha256:shift-100-v1',
  ...overrides
});

const batch=(overrides={})=>({
  provider:'planday',
  wfmTenantId:'tenant-uk-1',
  connectionId:'connection-planday-1',
  sourcePortalId:'portal-100',
  siteId:'leeds-factory',
  departmentId:'department-assembly',
  apiOrigin:'https://openapi.planday.com',
  apiVersion:'schedule-v1',
  resource:'shifts',
  schemaFingerprint:'sha256:planday-shift-v1',
  queryFingerprint:'sha256:leeds-assembly-shifts-v1',
  timeZone:'Europe/London',
  windowStart:'2026-09-27T00:00:00Z',
  windowEnd:'2026-09-28T00:00:00Z',
  observedAt:'2026-09-28T00:00:30Z',
  complete:true,
  paginationComplete:true,
  records:[record()],
  ...overrides
});

test('admits an exact-scope shift batch only as reconciliation evidence',()=>{
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch());
  assert.equal(decision.shiftTimeReconciliationCandidate,true);
  assert.equal(decision.checkpointAdvanceAllowed,false);
  assert.equal(decision.deletionAuthority,false);
  assert.equal(decision.writeBackAuthority,false);
  assert.equal(decision.payrollAuthority,false);
  assert.equal(decision.attendanceAuthority,false);
  assert.equal(decision.uniqueRecordCount,1);
  assert.match(decision.checkpointNamespace,/^shift-time:[a-f0-9]{64}$/);
});

test('rejects portal, site, department, endpoint, version, resource, query and schema drift',()=>{
  for(const [field,value] of [
    ['sourcePortalId','portal-other'],['siteId','other-site'],['departmentId','other-department'],
    ['apiOrigin','https://other.example.com'],['apiVersion','schedule-v2'],['resource','punchclock'],
    ['schemaFingerprint','sha256:changed'],['queryFingerprint','sha256:changed-query'],
    ['timeZone','Europe/Paris']
  ]) assert.throws(
    ()=>createShiftTimeAuthority(policy()).admitBatch(batch({[field]:value})),
    /approved authority/
  );
});

test('preserves local wall time, UTC instant, IANA zone and offset together',()=>{
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch());
  assert.equal(decision.records[0].localStart,'2026-09-27T08:00:00');
  assert.equal(decision.records[0].localEnd,'2026-09-27T16:00:00');
  assert.equal(decision.records[0].utcStart,'2026-09-27T07:00:00.000Z');
  assert.equal(decision.records[0].utcEnd,'2026-09-27T15:00:00.000Z');
  assert.equal(decision.records[0].timeZone,'Europe/London');
  assert.equal(decision.records[0].startOffsetMinutes,60);
  assert.equal(decision.records[0].endOffsetMinutes,60);
});

test('accepts the repeated autumn wall hour only when its explicit offset selects the real instant',()=>{
  const first=record({
    shiftId:'shift-dst-first',localStart:'2026-10-25T01:30:00',localEnd:'2026-10-25T01:45:00',
    utcStart:'2026-10-25T00:30:00Z',utcEnd:'2026-10-25T00:45:00Z',
    startOffsetMinutes:60,endOffsetMinutes:60,payloadDigest:'sha256:first'
  });
  const second=record({
    shiftId:'shift-dst-second',localStart:'2026-10-25T01:30:00',localEnd:'2026-10-25T01:45:00',
    utcStart:'2026-10-25T01:30:00Z',utcEnd:'2026-10-25T01:45:00Z',
    startOffsetMinutes:0,endOffsetMinutes:0,payloadDigest:'sha256:second'
  });
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch({
    windowStart:'2026-10-25T00:00:00Z',windowEnd:'2026-10-26T00:00:00Z',
    observedAt:'2026-10-26T00:00:30Z',records:[first,second]
  }));
  assert.equal(decision.uniqueRecordCount,2);
  assert.deepEqual(decision.records.map(item=>item.startOffsetMinutes),[60,0]);
});

test('rejects nonexistent spring-forward wall time and wrong offsets',()=>{
  const authority=createShiftTimeAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({
    windowStart:'2026-03-29T00:00:00Z',windowEnd:'2026-03-30T00:00:00Z',
    observedAt:'2026-03-30T00:00:30Z',
    records:[record({localStart:'2026-03-29T01:30:00',localEnd:'2026-03-29T03:00:00',utcStart:'2026-03-29T01:30:00Z',utcEnd:'2026-03-29T02:00:00Z',startOffsetMinutes:0,endOffsetMinutes:60})]
  })),/localStart.*time zone/i);
  assert.throws(()=>authority.admitBatch(batch({records:[record({startOffsetMinutes:0})]})),/startOffsetMinutes.*time zone/i);
});

test('uses elapsed UTC time across DST rather than subtracting local wall clocks',()=>{
  const overnight=record({
    shiftId:'shift-dst-overnight',localStart:'2026-10-24T22:00:00',localEnd:'2026-10-25T06:00:00',
    utcStart:'2026-10-24T21:00:00Z',utcEnd:'2026-10-25T06:00:00Z',
    startOffsetMinutes:60,endOffsetMinutes:0,payloadDigest:'sha256:overnight'
  });
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch({
    windowStart:'2026-10-24T00:00:00Z',windowEnd:'2026-10-26T00:00:00Z',
    observedAt:'2026-10-26T00:00:30Z',records:[overnight]
  }));
  assert.equal(decision.records[0].elapsedSeconds,32400);
});

test('detects employee shift overlaps without dropping either source record',()=>{
  const overlapping=record({
    shiftId:'shift-101',localStart:'2026-09-27T15:30:00',localEnd:'2026-09-27T18:00:00',
    utcStart:'2026-09-27T14:30:00Z',utcEnd:'2026-09-27T17:00:00Z',
    payloadDigest:'sha256:shift-101'
  });
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch({records:[record(),overlapping]}));
  assert.equal(decision.uniqueRecordCount,2);
  assert.equal(decision.overlapFree,false);
  assert.deepEqual(decision.overlapConflicts,[{employeeId:'employee-100',firstShiftId:'shift-100',secondShiftId:'shift-101',overlapSeconds:1800}]);
  assert.equal(decision.payrollAuthority,false);
});

test('keeps the same employee ID isolated across portals and connections',()=>{
  const one=createShiftTimeAuthority(policy()).admitBatch(batch());
  const two=createShiftTimeAuthority(policy({connectionId:'connection-planday-2',sourcePortalId:'portal-200'})).admitBatch(batch({connectionId:'connection-planday-2',sourcePortalId:'portal-200'}));
  assert.notEqual(one.checkpointNamespace,two.checkpointNamespace);
  assert.notEqual(one.records[0].scopedEmployeeFingerprint,two.records[0].scopedEmployeeFingerprint);
});

test('collapses exact source-version replays but quarantines conflicts',()=>{
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch({records:[record(),{...record()}]}));
  assert.equal(decision.uniqueRecordCount,1);
  assert.equal(decision.exactReplayCount,1);
  assert.throws(()=>createShiftTimeAuthority(policy()).admitBatch(batch({records:[record(),record({payloadDigest:'sha256:conflict'})]})),/conflicting duplicate/i);
});

test('requires complete bounded windows, pagination and intersecting shifts',()=>{
  const authority=createShiftTimeAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({complete:false})),/incomplete/i);
  assert.throws(()=>authority.admitBatch(batch({paginationComplete:false})),/pagination.*incomplete/i);
  assert.throws(()=>authority.admitBatch(batch({windowStart:'2026-09-20T23:59:59Z'})),/window.*limit/i);
  assert.throws(()=>authority.admitBatch(batch({records:[record({utcStart:'2026-09-28T01:00:00Z',utcEnd:'2026-09-28T02:00:00Z',localStart:'2026-09-28T02:00:00',localEnd:'2026-09-28T03:00:00'})]})),/outside.*window/i);
});

test('rejects reversed or overlong shifts and impossible observation chronology',()=>{
  const authority=createShiftTimeAuthority(policy());
  assert.throws(()=>authority.admitBatch(batch({records:[record({utcEnd:'2026-09-27T06:00:00Z',localEnd:'2026-09-27T07:00:00'})]})),/end.*after start/i);
  assert.throws(()=>createShiftTimeAuthority(policy({maxShiftSeconds:3600})).admitBatch(batch()),/shift.*limit/i);
  assert.throws(()=>authority.admitBatch(batch({observedAt:'2026-09-27T23:58:59Z'})),/observation.*clock-skew/i);
});

test('rejects secrets, executable evidence and invalid origins or zones',()=>{
  const secret=batch();
  secret.records[0].accessToken='do-not-store';
  assert.throws(()=>createShiftTimeAuthority(policy()).admitBatch(secret),/secret|credential/i);
  const executable=batch();
  Object.defineProperty(executable.records[0],'employeeId',{enumerable:true,get(){throw new Error('executed');}});
  assert.throws(()=>createShiftTimeAuthority(policy()).admitBatch(executable),/executable|hidden/i);
  for(const apiOrigin of ['http://openapi.planday.com','https://*.planday.com','https://openapi.planday.com/schedule']){
    assert.throws(()=>createShiftTimeAuthority(policy({apiOrigin})),/exact HTTPS origin/);
  }
  assert.throws(()=>createShiftTimeAuthority(policy({timeZone:'Mars/Olympus'})),/IANA time zone/i);
});

test('returns deeply immutable evidence',()=>{
  const decision=createShiftTimeAuthority(policy()).admitBatch(batch());
  assert.equal(Object.isFrozen(decision),true);
  assert.equal(Object.isFrozen(decision.records),true);
  assert.equal(Object.isFrozen(decision.records[0]),true);
  assert.throws(()=>decision.records.push({}),TypeError);
});
