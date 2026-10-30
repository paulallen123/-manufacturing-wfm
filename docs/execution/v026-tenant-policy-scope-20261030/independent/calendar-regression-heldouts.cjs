'use strict';
// Existing calendar-consumer regression evidence only; no new V026 API contract.
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=process.env.V026_SOURCE_ROOT;
assert.ok(root,'V026_SOURCE_ROOT is required');
const {createTenantCalendar}=require(path.join(root,'operations/runtime/tenant-calendar.cjs'));
function snapshot(iso,site='plant-london'){
 return createTenantCalendar({env:{WFM_TENANT_TIMEZONE:'UTC',WFM_SITE_TIMEZONES_JSON:JSON.stringify({'plant-london':'Europe/London','plant-india':'Asia/Kolkata'})},now:()=>Date.parse(iso)}).snapshot({tenant:'synthetic-tenant',site});
}
test('existing London calendar skips the spring missing hour using UTC instants',()=>{
 const before=snapshot('2026-03-29T00:59:59Z'),after=snapshot('2026-03-29T01:00:00Z');
 assert.equal(before.localTime,'00:59:59');
 assert.equal(after.localTime,'02:00:00');
 assert.equal(after.localDate,'2026-03-29');
 assert.equal(after.timeZone,'Europe/London');
});
test('existing London calendar keeps distinct UTC instants through autumn repeated local hour',()=>{
 const summer=snapshot('2026-10-25T00:30:00Z'),winter=snapshot('2026-10-25T01:30:00Z');
 assert.equal(summer.localTime,'01:30:00');assert.equal(winter.localTime,'01:30:00');
 assert.notEqual(summer.asOf,winter.asOf);
 assert.equal(summer.localDate,'2026-10-25');assert.equal(winter.localDate,'2026-10-25');
});
test('existing site timezone lookup preserves fractional-hour local date rollover and JSON output',()=>{
 const result=snapshot('2026-06-01T20:00:00Z','plant-india');
 assert.equal(result.timeZone,'Asia/Kolkata');
 assert.equal(result.localDate,'2026-06-02');assert.equal(result.localTime,'01:30:00');
 assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});
