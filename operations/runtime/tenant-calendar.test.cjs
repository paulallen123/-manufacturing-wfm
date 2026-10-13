'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTenantCalendar,currentPeriod}=require('./tenant-calendar.cjs');

const periods=[
 {id:'sep',start:'2026-09-28',end:'2026-10-04'},
 {id:'oct',start:'2026-10-05',end:'2026-10-11'},
 {id:'next',start:'2026-10-12',end:'2026-10-18'}
];

test('currentPeriod returns only a period that contains the authoritative local date',()=>{
 assert.equal(currentPeriod(periods,'2026-10-06').id,'oct');
 assert.equal(currentPeriod(periods,'2026-10-19'),null);
 assert.equal(currentPeriod(periods,'2026-09-20'),null);
});

test('currentPeriod fails closed when payroll periods overlap the authoritative local date',()=>{
 assert.throws(()=>currentPeriod([...periods,{id:'overlap',start:'2026-10-06',end:'2026-10-07'}],'2026-10-06'),{code:'WFM_CURRENT_PERIOD_AMBIGUOUS'});
});

test('periodForState never falls back to latest historical payroll',()=>{
 const calendar=createTenantCalendar({env:{WFM_TENANT_TIMEZONE:'Europe/London'},now:()=>Date.parse('2026-10-20T08:00:00Z')});
 const result=calendar.periodForState({payrollControl:{periods}},{tenant:'northstar-demo',site:'Tamworth'});
 assert.equal(result.localDate,'2026-10-20');
 assert.equal(result.timeZone,'Europe/London');
 assert.equal(result.period,null);
 assert.deepEqual(result.historicalPeriods.map(row=>row.id),['next','oct','sep']);
});

test('calendar snapshot and freshness use one server-authoritative clock and timezone',()=>{
 const calendar=createTenantCalendar({env:{WFM_TENANT_TIMEZONE:'Europe/London',WFM_TODAY_MAX_AGE_MS:'900000'},now:()=>Date.parse('2026-10-06T04:30:00Z')});
 const snap=calendar.snapshot({tenant:'northstar-demo',site:'Tamworth'});
 assert.equal(snap.schemaVersion,'tenant-calendar-1');
 assert.equal(snap.localDate,'2026-10-06');
 assert.equal(snap.maxAgeMs,900000);
 assert.equal(calendar.freshness({asOf:'2026-10-06T04:20:00Z',timeZone:snap.timeZone,maxAgeMs:snap.maxAgeMs}).fresh,true);
 assert.deepEqual(calendar.freshness({asOf:'2026-10-06T04:00:00Z',timeZone:snap.timeZone,maxAgeMs:snap.maxAgeMs}).fresh,false);
});

test('site timezone lookup uses the normalized site identity',()=>{
 const calendar=createTenantCalendar({env:{
  WFM_TENANT_TIMEZONE:'Europe/London',
  WFM_SITE_TIMEZONES_JSON:JSON.stringify({Tamworth:'Australia/Sydney'})
 },now:()=>Date.parse('2026-10-06T14:30:00Z')});
 const exact=calendar.snapshot({tenant:'northstar-demo',site:'Tamworth'});
 const padded=calendar.snapshot({tenant:'northstar-demo',site:' Tamworth '});
 assert.deepEqual(padded,exact);
 assert.equal(padded.site,'Tamworth');
 assert.equal(padded.timeZone,'Australia/Sydney');
 assert.equal(padded.localDate,'2026-10-07');
});

