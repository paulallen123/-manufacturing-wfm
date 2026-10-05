'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {createOperationalPeriodRollover}=require('./operational-period-rollover.cjs');
test('rolls a date to its Monday-Sunday period idempotently and persists',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-period-')); const db=path.join(dir,'wfm.db');
 let s=createOperationalPeriodRollover({dbPath:db});
 const a=s.ensure({tenant:'northstar-demo',date:'2026-10-05',sourceDigest:'abc'});
 const b=s.ensure({tenant:'northstar-demo',date:'2026-10-09',sourceDigest:'abc'});
 assert.equal(a.period,'2026-10-05'); assert.equal(a.end_date,'2026-10-11'); assert.equal(b.period,a.period);
 assert.equal(s.list('northstar-demo').length,1); assert.equal(s.list('other').length,0); s.close();
 s=createOperationalPeriodRollover({dbPath:db}); assert.equal(s.list('northstar-demo')[0].period,'2026-10-05'); s.close();
});
test('rejects invalid dates',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vector-period-')); const s=createOperationalPeriodRollover({dbPath:path.join(dir,'wfm.db')});
 assert.throws(()=>s.ensure({tenant:'northstar-demo',date:'not-a-date'}),/valid date/); s.close();
});
